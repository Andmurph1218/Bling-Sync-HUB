import crypto from 'node:crypto';
import request from 'supertest';
import { newDb, DataType } from 'pg-mem';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { DbPoolLike, query, setPool } from '../db/pool.js';
import { runAllMigrationsUp } from '../db/migrator.js';
import {
  acquireResourceLock,
  processWebhookEventById,
  recoverAndProcessPendingWebhooks,
  releaseResourceLock,
} from '../engines/wig.js';

function signHmacSha256(rawPayload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(rawPayload, 'utf8').digest('hex');
}

describe('Fase 8 — Guarda de Idempotência de Webhook WIG (HMAC Constante, INSERT antes do 200, Restart sem Perda, Eco, Watermark e Lock 60s)', () => {
  const app = createApp();
  let poolInstance: DbPoolLike;
  const blingSecret = 'bling_dev_webhook_secret';
  const nsSecret = 'ns_dev_webhook_secret';

  beforeAll(async () => {
    const mem = newDb();

    mem.public.registerFunction({
      name: 'gen_random_uuid',
      returns: DataType.uuid,
      impure: true,
      implementation: () => crypto.randomUUID(),
    });

    mem.public.registerFunction({
      name: 'trim',
      args: [DataType.text],
      returns: DataType.text,
      implementation: (val: string) => (val ? val.trim() : ''),
    });

    mem.public.registerFunction({
      name: 'length',
      args: [DataType.text],
      returns: DataType.integer,
      implementation: (val: string) => (val ? val.length : 0),
    });

    const pgAdapter = mem.adapters.createPg();
    poolInstance = new pgAdapter.Pool() as unknown as DbPoolLike;
    setPool(poolInstance);

    await runAllMigrationsUp({ stripPartitionClauseForMemDb: true });
  });

  afterAll(async () => {
    if (poolInstance) {
      await poolInstance.end();
    }
    setPool(null);
  });

  it('1. Critério de saída: Assinatura inválida responde 401 sem persistir; assinatura válida grava SHA-256 antes do 200 e restart depois do 200 NÃO perde o evento', async () => {
    const rawBody = JSON.stringify({
      eventId: 'evt-wig-restart-01',
      date: '2026-10-16T15:00:00Z',
      version: 'v1',
      event: 'product.updated',
      companyId: 'bling-01',
      data: {
        id: 800101,
        codigo: 'GAR-WIG-800',
        nome: 'Garrafa WIG Persistente',
        preco: 119.9,
        tipo: 'P',
        situacao: 'A',
      },
    });

    // 1A: HMAC inválido -> 401 e zero linhas gravadas em webhook_events
    const badRes = await request(app)
      .post('/webhooks/bling')
      .set('Content-Type', 'application/json')
      .set('X-Bling-Signature-256', '0'.repeat(64))
      .send(rawBody);

    expect(badRes.status).toBe(401);

    const countAfterBad = await query<{ count: number }>(
      `SELECT count(*)::int AS count FROM webhook_events WHERE resource_id = '800101'`
    );
    expect(countAfterBad.rows[0]?.count).toBe(0);

    // 1B: HMAC válido -> INSERT síncrono com SHA-256 de 64 chars ANTES do HTTP 200
    const validSig = signHmacSha256(rawBody, blingSecret);
    const okRes = await request(app)
      .post('/webhooks/bling')
      .set('Content-Type', 'application/json')
      .set('X-Bling-Signature-256', `sha256=${validSig}`)
      .send(rawBody);

    expect(okRes.status).toBe(200);
    expect(okRes.body.status).toBe('accepted');
    const eventId = okRes.body.webhookEventId as string;
    expect(eventId).toBeDefined();

    // Verifica que o evento já está persistido no PostgreSQL imediatamente após o HTTP 200
    const persistedBeforeWorker = await query<{
      content_hash: string;
      status: string;
    }>(`SELECT content_hash, status FROM webhook_events WHERE id = $1`, [eventId]);

    expect(persistedBeforeWorker.rows).toHaveLength(1);
    expect(persistedBeforeWorker.rows[0]?.content_hash).toHaveLength(64);
    expect(persistedBeforeWorker.rows[0]?.status).toBe('received');

    // Reenvio idêntico (duplicata de webhook) responde 200 com status = 'duplicate_ignored' sem criar nova linha
    const dupRes = await request(app)
      .post('/webhooks/bling')
      .set('Content-Type', 'application/json')
      .set('X-Bling-Signature-256', validSig)
      .send(rawBody);
    expect(dupRes.status).toBe(200);
    expect(dupRes.body.status).toBe('duplicate_ignored');
    expect(dupRes.body.webhookEventId).toBe(eventId);

    // Simula restart do processo logo após o HTTP 200: recoverAndProcessPendingWebhooks recupera o evento persistido e o processa!
    const recovered = await recoverAndProcessPendingWebhooks('worker-after-restart');
    expect(recovered).toHaveLength(1);
    expect(recovered[0]?.webhookEventId).toBe(eventId);
    expect(recovered[0]?.outcome).toBe('processed');

    // Confirma que o produto foi criado via upsert, stock da variante nasceu NULL e sync_logs gravou a mesma idempotency_key
    const prodCheck = await query<{ id: string; bling_sku: string }>(
      `SELECT id, bling_sku FROM master_products WHERE bling_id = '800101'`
    );
    expect(prodCheck.rows[0]?.bling_sku).toBe('GAR-WIG-800');

    const varCheck = await query<{ stock: number | null }>(
      `SELECT stock FROM product_variants WHERE master_product_id = $1`,
      [prodCheck.rows[0]!.id]
    );
    expect(varCheck.rows[0]?.stock).toBeNull();

    const syncLogCheck = await query<{ idempotency_key: string; status: string }>(
      `SELECT idempotency_key, status FROM sync_logs WHERE webhook_event_id = $1`,
      [eventId]
    );
    expect(syncLogCheck.rows).toEqual([
      {
        idempotency_key: okRes.body.idempotencyKey,
        status: 'processed',
      },
    ]);
  });

  it('2. WIG: Eco de escrita do hub (hub_writes), evento fora de ordem mais antigo que o watermark (> 1s) e conteúdo idêntico ficam ignored', async () => {
    // Registra uma escrita feita pelo próprio hub em hub_writes para o produto 800101 alterando 'marca'
    await query(
      `INSERT INTO hub_writes (bling_id, request_id, changed_fields)
       VALUES ('800101', $1, ARRAY['marca'])`,
      [crypto.randomUUID()]
    );

    // Webhook do Bling que apenas repete a mudança em 'marca' -> deve ficar ignored (motivo 'echo')
    const echoRaw = JSON.stringify({
      eventId: 'evt-wig-echo-02',
      date: '2026-10-16T15:01:00Z',
      version: 'v1',
      event: 'product.updated',
      companyId: 'bling-01',
      data: {
        id: 800101,
        codigo: 'GAR-WIG-800',
        marca: 'ThermoHub',
        tipo: 'P',
      },
    });

    const echoIngest = await request(app)
      .post('/webhooks/bling')
      .set('X-Bling-Signature-256', signHmacSha256(echoRaw, blingSecret))
      .send(echoRaw);
    expect(echoIngest.status).toBe(200);

    const echoWorker = await processWebhookEventById(echoIngest.body.webhookEventId);
    expect(echoWorker.outcome).toBe('ignored_echo');

    // Evento atrasado (timestamp 2026-10-16T14:50:00Z, anterior ao watermark 15:00:00Z além da tolerância de 1s) -> ignored_stale_watermark
    const staleRaw = JSON.stringify({
      eventId: 'evt-wig-stale-03',
      date: '2026-10-16T14:50:00Z',
      version: 'v1',
      event: 'product.updated',
      companyId: 'bling-01',
      data: {
        id: 800101,
        codigo: 'GAR-WIG-800',
        nome: 'Nome Antigo Fora de Ordem',
        preco: 99.9,
        tipo: 'P',
        situacao: 'A',
      },
    });

    const staleIngest = await request(app)
      .post('/webhooks/bling')
      .set('X-Bling-Signature-256', signHmacSha256(staleRaw, blingSecret))
      .send(staleRaw);
    const staleWorker = await processWebhookEventById(staleIngest.body.webhookEventId);
    expect(staleWorker.outcome).toBe('ignored_stale_watermark');

    // Evento com timestamp mais novo (15:02:00Z), porém com data idêntica ao evento das 15:00:00Z -> ignored_identical_content
    const identicalRaw = JSON.stringify({
      eventId: 'evt-wig-identical-04',
      date: '2026-10-16T15:02:00Z',
      version: 'v1',
      event: 'product.updated',
      companyId: 'bling-01',
      data: {
        id: 800101,
        codigo: 'GAR-WIG-800',
        nome: 'Garrafa WIG Persistente',
        preco: 119.9,
        tipo: 'P',
        situacao: 'A',
      },
    });

    const identIngest = await request(app)
      .post('/webhooks/bling')
      .set('X-Bling-Signature-256', signHmacSha256(identicalRaw, blingSecret))
      .send(identicalRaw);
    const identWorker = await processWebhookEventById(identIngest.body.webhookEventId);
    expect(identWorker.outcome).toBe('ignored_identical_content');
  });

  it('3. WIG: Lock de 60s atrasa segundo evento concorrente em 2s, lock vencido não segura a fila e webhook de canal (Nuvemshop) marca channel_deleted sem apagar o Bling', async () => {
    // Worker A adquire o lock para bling:800101
    const lockA = await acquireResourceLock('bling:800101', 'worker-A', 60);
    expect(lockA.acquired).toBe(true);

    // Worker B tenta adquirir o mesmo lock enquanto válido -> recebe acquired = false e retryDelayMs = 2000 (2s)
    const lockB = await acquireResourceLock('bling:800101', 'worker-B', 60);
    expect(lockB.acquired).toBe(false);
    expect(lockB.retryDelayMs).toBe(2000);

    // Simula expiração do lock de worker-A (expires_at no passado) -> worker-B agora assume o lock sem travar a fila!
    await query(
      `UPDATE resource_locks SET expires_at = now() - interval '5 seconds' WHERE lock_key = 'bling:800101'`
    );
    const lockBAfterExpiry = await acquireResourceLock('bling:800101', 'worker-B', 60);
    expect(lockBAfterExpiry.acquired).toBe(true);
    await releaseResourceLock('bling:800101', 'worker-B');

    // Webhook Nuvemshop product/deleted (assinado com x-linkedstore-hmac-sha256):
    // marca platform_links.sync_status = 'channel_deleted' e preserva o produto no Bling
    const prodRes = await query<{ id: string }>(
      `SELECT id FROM master_products WHERE bling_id = '800101'`
    );
    const masterId = prodRes.rows[0]!.id;

    await query(
      `INSERT INTO platform_links (
         master_product_id, platform, platform_product_id, match_method, match_confidence, sync_status
       ) VALUES ($1, 'nuvemshop', '991122', 'auto_multi_signal', 95, 'linked')`,
      [masterId]
    );

    const nsDeletedRaw = JSON.stringify({
      store_id: 441100,
      event: 'product/deleted',
      id: 991122,
    });

    const nsIngest = await request(app)
      .post('/webhooks/nuvemshop')
      .set('x-linkedstore-hmac-sha256', signHmacSha256(nsDeletedRaw, nsSecret))
      .send(nsDeletedRaw);
    expect(nsIngest.status).toBe(200);

    const nsWorker = await processWebhookEventById(nsIngest.body.webhookEventId);
    expect(nsWorker.outcome).toBe('processed');

    const linkAfter = await query<{ sync_status: string }>(
      `SELECT sync_status FROM platform_links WHERE platform = 'nuvemshop' AND platform_product_id = '991122'`
    );
    expect(linkAfter.rows[0]?.sync_status).toBe('channel_deleted');

    // O cadastro local do Bling permanece active
    const prodStillActive = await query<{ catalog_status: string }>(
      `SELECT catalog_status FROM master_products WHERE id = $1`,
      [masterId]
    );
    expect(prodStillActive.rows[0]?.catalog_status).toBe('active');
  });
});
