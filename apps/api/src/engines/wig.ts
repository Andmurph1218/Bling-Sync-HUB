/**
 * Motor WIG — Webhook Idempotency Guard (Seções 4, 8.9, 9.5, 10.2, 10.4, 10.5 e 14 do Plano Mestre)
 *
 * Regras travadas:
 * - Ordem estrita do controller:
 *   1. Ler o raw body.
 *   2. Validar HMAC com comparação de tempo constante (crypto.timingSafeEqual). Assinatura inválida responde 401 e NÃO persiste.
 *   3. Inserir webhook_events com SHA-256 completo (64 hex). Chave: source:event_type:resource_id:content_hash.
 *      Conflito de chave responde 200 e para.
 *   4. Enfileirar no BullMQ / fila persistida.
 *   5. Só então responder 200.
 * - Restart depois do 200 NÃO perde o evento, porque o INSERT em webhook_events já aconteceu antes do 200.
 * - Worker source = bling:
 *   1. Lock do recurso por 60 s (lock vencido não segura a fila; segundo evento concorrente aguarda com atraso de 2 s).
 *   2. Detecção de eco via hub_writes (reason = 'echo').
 *   3. Ordem pelo event_timestamp do Bling com tolerância de 1 s (reason = 'stale_watermark').
 *   4. Conteúdo idêntico ao último processado fica ignored (reason = 'identical_content').
 *   5. detectChanges, agregação (pending_product_changes), watermark e sync_logs com a mesma idempotency_key.
 *   6. Liberar lock no finally.
 * - Worker source = mercadolivre | nuvemshop: segue fluxo 10.5 (eco de push_job_steps, UPtin, divergência de preço/estoque sem gravar no ERP, channel_deleted).
 */

import crypto from 'node:crypto';
import { PoolClient } from 'pg';
import { query, withTransaction } from '../db/pool.js';
import { applyMlUptinMigration } from '../contracts/mappers.js';
import { MlUptinMigrationNotification } from '../contracts/fixtures/mercadolivre.fixtures.js';

export type WebhookSource = 'bling' | 'mercadolivre' | 'nuvemshop';

export function computeContentSha256(rawBody: Buffer | string): string {
  const buf = typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody;
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export function buildWebhookIdempotencyKey(
  source: WebhookSource,
  eventType: string,
  resourceId: string,
  contentHash64: string
): string {
  return `${source}:${eventType}:${resourceId}:${contentHash64}`;
}

/**
 * Valida HMAC-SHA256 em tempo constante (crypto.timingSafeEqual) sobre o raw body.
 * Aceita assinaturas tanto em formato hex puro quanto prefixadas com 'sha256='.
 */
export function verifyWebhookHmacConstantTime(
  rawBody: Buffer | string,
  signatureHeader: string | undefined | null,
  secret: string
): boolean {
  if (!signatureHeader || !secret) {
    return false;
  }

  const normalizedSig = signatureHeader
    .trim()
    .replace(/^sha256=/i, '')
    .toLowerCase();

  if (!/^[0-9a-f]{64}$/.test(normalizedSig)) {
    return false;
  }

  const rawBuf = typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody;
  const expectedHex = crypto
    .createHmac('sha256', secret)
    .update(rawBuf)
    .digest('hex')
    .toLowerCase();

  const actualBytes = Buffer.from(normalizedSig, 'hex');
  const expectedBytes = Buffer.from(expectedHex, 'hex');

  if (actualBytes.length !== expectedBytes.length) {
    return false;
  }

  return crypto.timingSafeEqual(actualBytes, expectedBytes);
}

export function extractWebhookMetadata(
  source: WebhookSource,
  parsedPayload: Record<string, unknown>
): {
  eventType: string;
  resourceId: string;
  eventTimestamp: Date;
} {
  if (source === 'bling') {
    const eventType = String(parsedPayload.event ?? 'unknown');
    const data = (parsedPayload.data ?? {}) as Record<string, unknown>;
    const prodObj = data.produto as Record<string, unknown> | undefined;
    const resourceId = String(prodObj?.id ?? data.id ?? 'unknown');
    const rawDate = parsedPayload.date ? String(parsedPayload.date) : null;
    const eventTimestamp = rawDate ? new Date(rawDate) : new Date();
    return { eventType, resourceId, eventTimestamp };
  }

  if (source === 'nuvemshop') {
    const eventType = String(parsedPayload.event ?? 'product/updated');
    const resourceId = String(parsedPayload.id ?? 'unknown');
    return { eventType, resourceId, eventTimestamp: new Date() };
  }

  // mercadolivre
  const eventType = String(parsedPayload.topic ?? 'items');
  const rawResource = String(parsedPayload.resource ?? '');
  const resourceId =
    rawResource.split('/').filter(Boolean).pop() ??
    String(parsedPayload.id ?? 'unknown');
  return { eventType, resourceId, eventTimestamp: new Date() };
}

export interface WebhookQueueDispatcher {
  enqueue(webhookEventId: string, idempotencyKey: string): Promise<void>;
}

export interface IngestWebhookOutcome {
  httpStatus: 200 | 401;
  accepted: boolean;
  duplicate: boolean;
  webhookEventId: string | null;
  idempotencyKey: string | null;
}

/**
 * Controller WIG (Seção 8.9):
 * 1. Lê raw body
 * 2. Valida HMAC em tempo constante -> 401 sem persistir se inválido
 * 3. INSERT em webhook_events com SHA-256 de 64 chars -> 200 imediato se conflito de idempotency_key
 * 4. Enfileira no BullMQ
 * 5. Só então retorna 200
 */
export async function ingestWebhookController(input: {
  source: WebhookSource;
  rawBody: Buffer | string;
  signatureHeader: string | undefined;
  secret: string;
  queueDispatcher?: WebhookQueueDispatcher;
}): Promise<IngestWebhookOutcome> {
  // Passo 1 & 2: validar HMAC sobre o raw body com comparação de tempo constante
  const hmacValid = verifyWebhookHmacConstantTime(
    input.rawBody,
    input.signatureHeader,
    input.secret
  );

  if (!hmacValid) {
    return {
      httpStatus: 401,
      accepted: false,
      duplicate: false,
      webhookEventId: null,
      idempotencyKey: null,
    };
  }

  const rawText =
    typeof input.rawBody === 'string'
      ? input.rawBody
      : input.rawBody.toString('utf8');
  const parsed = JSON.parse(rawText) as Record<string, unknown>;
  const contentHash = computeContentSha256(input.rawBody);
  const { eventType, resourceId, eventTimestamp } = extractWebhookMetadata(
    input.source,
    parsed
  );
  const idempotencyKey = buildWebhookIdempotencyKey(
    input.source,
    eventType,
    resourceId,
    contentHash
  );

  // Passo 3: Inserir em webhook_events ANTES de responder 200 (conflito responde 200 e para)
  const insertResult = await withTransaction(async (client: PoolClient) => {
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM webhook_events WHERE idempotency_key = $1`,
      [idempotencyKey]
    );

    if (existing.rowCount && existing.rowCount > 0) {
      return {
        duplicate: true,
        webhookEventId: existing.rows[0]!.id,
      };
    }

    const ins = await client.query<{ id: string }>(
      `INSERT INTO webhook_events (
         source, event_type, resource_id, content_hash, idempotency_key,
         event_timestamp, raw_payload, status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'received')
       RETURNING id`,
      [
        input.source,
        eventType,
        resourceId,
        contentHash,
        idempotencyKey,
        eventTimestamp.toISOString(),
        JSON.stringify(parsed),
      ]
    );

    return {
      duplicate: false,
      webhookEventId: ins.rows[0]!.id,
    };
  });

  if (insertResult.duplicate) {
    return {
      httpStatus: 200,
      accepted: true,
      duplicate: true,
      webhookEventId: insertResult.webhookEventId,
      idempotencyKey,
    };
  }

  // Passo 4: Enfileirar no BullMQ (se o processo reiniciar antes ou depois daqui, a linha já está gravada no PostgreSQL!)
  if (input.queueDispatcher) {
    await input.queueDispatcher.enqueue(insertResult.webhookEventId, idempotencyKey);
    await query(
      `UPDATE webhook_events SET status = 'queued' WHERE id = $1`,
      [insertResult.webhookEventId]
    );
  }

  // Passo 5: Responder 200
  return {
    httpStatus: 200,
    accepted: true,
    duplicate: false,
    webhookEventId: insertResult.webhookEventId,
    idempotencyKey,
  };
}

/**
 * Adquire lock de recurso por 60 segundos (Seção 8.9 Passo 1 do Worker):
 * - Lock vencido (expires_at <= now()) não segura a fila e é substituído.
 * - Se outro worker detém lock válido, retorna acquired = false e retryDelayMs = 2000 (2 s).
 */
export async function acquireResourceLock(
  lockKey: string,
  workerId: string,
  ttlSeconds = 60
): Promise<{ acquired: boolean; retryDelayMs: number }> {
  return withTransaction(async (client: PoolClient) => {
    const existingRes = await client.query<{
      locked_by: string;
      expires_at: Date | string;
    }>(
      `SELECT locked_by, expires_at FROM resource_locks WHERE lock_key = $1 FOR UPDATE`,
      [lockKey]
    );

    const now = Date.now();
    const newExpiresAt = new Date(now + ttlSeconds * 1000).toISOString();
    const existing = existingRes.rows[0];

    if (existing) {
      const expMs =
        existing.expires_at instanceof Date
          ? existing.expires_at.getTime()
          : new Date(existing.expires_at).getTime();

      if (expMs > now && existing.locked_by !== workerId) {
        return { acquired: false, retryDelayMs: 2000 };
      }

      await client.query(
        `UPDATE resource_locks
         SET locked_by = $2, locked_at = now(), expires_at = $3
         WHERE lock_key = $1`,
        [lockKey, workerId, newExpiresAt]
      );
      return { acquired: true, retryDelayMs: 0 };
    }

    await client.query(
      `INSERT INTO resource_locks (lock_key, locked_by, locked_at, expires_at)
       VALUES ($1, $2, now(), $3)`,
      [lockKey, workerId, newExpiresAt]
    );
    return { acquired: true, retryDelayMs: 0 };
  });
}

export async function releaseResourceLock(
  lockKey: string,
  workerId: string
): Promise<void> {
  await query(
    `DELETE FROM resource_locks WHERE lock_key = $1 AND locked_by = $2`,
    [lockKey, workerId]
  );
}

export interface ProcessWebhookWorkerResult {
  webhookEventId: string;
  idempotencyKey: string;
  outcome:
    | 'processed'
    | 'ignored_echo'
    | 'ignored_stale_watermark'
    | 'ignored_identical_content'
    | 'ignored_service'
    | 'delayed_lock_busy';
  retryDelayMs?: number;
  changedFields: string[];
}

function classifyFieldPriority(field: string): 'P1' | 'P2' | 'P3' | 'P4' {
  if (field === 'price' || field === 'stock' || field === 'virtual_stock') return 'P1';
  if (field === 'ean' || field === 'name' || field === 'situacao') return 'P2';
  if (
    field === 'brand' ||
    field === 'marca' ||
    field === 'pesoLiquido' ||
    field === 'dimensoes' ||
    field === 'description'
  ) {
    return 'P3';
  }
  return 'P4';
}

/**
 * Worker WIG que processa um evento persistido em webhook_events (Seções 8.9, 10.2 e 10.5).
 */
export async function processWebhookEventById(
  webhookEventId: string,
  workerId = 'wig-worker-1'
): Promise<ProcessWebhookWorkerResult> {
  const evtRes = await query<{
    id: string;
    source: WebhookSource;
    event_type: string;
    resource_id: string;
    content_hash: string;
    idempotency_key: string;
    event_timestamp: Date | string | null;
    raw_payload: Record<string, unknown>;
    status: string;
  }>(
    `SELECT id, source, event_type, resource_id, content_hash, idempotency_key,
            event_timestamp, raw_payload, status
     FROM webhook_events
     WHERE id = $1`,
    [webhookEventId]
  );

  const evt = evtRes.rows[0];
  if (!evt) {
    throw new Error(`webhook_event ${webhookEventId} não encontrado`);
  }

  const lockKey = `${evt.source}:${evt.resource_id}`;
  const lock = await acquireResourceLock(lockKey, workerId, 60);
  if (!lock.acquired) {
    return {
      webhookEventId: evt.id,
      idempotencyKey: evt.idempotency_key,
      outcome: 'delayed_lock_busy',
      retryDelayMs: lock.retryDelayMs,
      changedFields: [],
    };
  }

  try {
    if (evt.source === 'bling') {
      return await processBlingWebhookInsideLock(evt);
    }
    return await processChannelWebhookInsideLock(evt);
  } finally {
    await releaseResourceLock(lockKey, workerId);
  }
}

async function markWebhookIgnored(
  client: PoolClient,
  evt: {
    id: string;
    source: WebhookSource;
    idempotency_key: string;
  },
  reason: 'echo' | 'stale_watermark' | 'identical_content' | 'service' | 'duplicate',
  productId: string | null = null
): Promise<void> {
  await client.query(
    `UPDATE webhook_events
     SET status = 'ignored',
         ignore_reason = $2,
         processed_at = now()
     WHERE id = $1`,
    [evt.id, reason]
  );

  await client.query(
    `INSERT INTO sync_logs (
       product_id, platform, direction, status, error_detail, idempotency_key, webhook_event_id
     ) VALUES ($1, $2, 'inbound_webhook', 'ignored', $3, $4, $5)`,
    [productId, evt.source, reason, evt.idempotency_key, evt.id]
  );
}

async function processBlingWebhookInsideLock(evt: {
  id: string;
  source: WebhookSource;
  event_type: string;
  resource_id: string;
  content_hash: string;
  idempotency_key: string;
  event_timestamp: Date | string | null;
  raw_payload: Record<string, unknown>;
}): Promise<ProcessWebhookWorkerResult> {
  return withTransaction(async (client: PoolClient) => {
    const payload = evt.raw_payload;
    const data = (payload.data ?? {}) as Record<string, unknown>;
    const eventTime = evt.event_timestamp
      ? evt.event_timestamp instanceof Date
        ? evt.event_timestamp
        : new Date(evt.event_timestamp)
      : new Date();

    // 1. Serviço (tipo != 'P') fica ignored (motivo 'service'); se existia como 'P', vai a 'inactive' (Seção 10.3)
    if (data.tipo && data.tipo !== 'P') {
      await client.query(
        `UPDATE master_products
         SET catalog_status = 'inactive', status_changed_at = now(), updated_at = now()
         WHERE bling_id = $1`,
        [evt.resource_id]
      );
      await markWebhookIgnored(client, evt, 'service');
      return {
        webhookEventId: evt.id,
        idempotencyKey: evt.idempotency_key,
        outcome: 'ignored_service',
        changedFields: [],
      };
    }

    // 2. Verifica se é eco de escrita feita pelo próprio hub em hub_writes (Seção 4 e 8.9)
    const candidateFields = Object.keys(data).filter(
      (k) => k !== 'id' && k !== 'codigo' && k !== 'tipo' && k !== 'produto'
    );

    if (evt.event_type === 'product.updated' && candidateFields.length > 0) {
      const hubWritesRes = await client.query<{ changed_fields: string[] }>(
        `SELECT changed_fields
         FROM hub_writes
         WHERE bling_id = $1
         ORDER BY written_at DESC
         LIMIT 5`,
        [evt.resource_id]
      );

      const isEchoFromHubWrite = hubWritesRes.rows.some((hw) =>
        candidateFields.every((cf) => hw.changed_fields.includes(cf))
      );

      if (isEchoFromHubWrite) {
        await markWebhookIgnored(client, evt, 'echo');
        return {
          webhookEventId: evt.id,
          idempotencyKey: evt.idempotency_key,
          outcome: 'ignored_echo',
          changedFields: [],
        };
      }
    }

    // 3. Verifica watermark por recurso/campo com tolerância de 1 s e hash de conteúdo idêntico (Seção 8.9)
    const resourceType =
      evt.event_type.startsWith('stock') || evt.event_type.startsWith('virtual_stock')
        ? 'bling_stock'
        : 'bling_product';
    const fieldName = evt.event_type;
    const valueHash = computeContentSha256(JSON.stringify(data));

    const wmRes = await client.query<{
      last_event_at: Date | string;
      last_value_hash: string | null;
    }>(
      `SELECT last_event_at, last_value_hash
       FROM field_watermarks
       WHERE resource_type = $1 AND resource_id = $2 AND field_name = $3
       FOR UPDATE`,
      [resourceType, evt.resource_id, fieldName]
    );

    const wm = wmRes.rows[0];
    if (wm) {
      const lastEventMs =
        wm.last_event_at instanceof Date
          ? wm.last_event_at.getTime()
          : new Date(wm.last_event_at).getTime();

      // Tolerância de 1 segundo (1000 ms)
      if (eventTime.getTime() < lastEventMs - 1000) {
        await markWebhookIgnored(client, evt, 'stale_watermark');
        return {
          webhookEventId: evt.id,
          idempotencyKey: evt.idempotency_key,
          outcome: 'ignored_stale_watermark',
          changedFields: [],
        };
      }

      if (wm.last_value_hash === valueHash) {
        await markWebhookIgnored(client, evt, 'identical_content');
        return {
          webhookEventId: evt.id,
          idempotencyKey: evt.idempotency_key,
          outcome: 'ignored_identical_content',
          changedFields: [],
        };
      }

      await client.query(
        `UPDATE field_watermarks
         SET last_event_at = $4, last_value_hash = $5, updated_at = now()
         WHERE resource_type = $1 AND resource_id = $2 AND field_name = $3`,
        [resourceType, evt.resource_id, fieldName, eventTime.toISOString(), valueHash]
      );
    } else {
      await client.query(
        `INSERT INTO field_watermarks (
           resource_type, resource_id, field_name, last_event_at, last_value_hash
         ) VALUES ($1, $2, $3, $4, $5)`,
        [resourceType, evt.resource_id, fieldName, eventTime.toISOString(), valueHash]
      );
    }

    // 4. Localiza ou faz upsert do master_product pelo bling_id (updated que chega antes do created faz upsert - Seção 10.2)
    let masterProductId: string | null = null;
    const prodRes = await client.query<{ id: string }>(
      `SELECT id FROM master_products WHERE bling_id = $1 FOR UPDATE`,
      [evt.resource_id]
    );

    if (prodRes.rows[0]) {
      masterProductId = prodRes.rows[0].id;
    } else if (
      evt.event_type === 'product.created' ||
      evt.event_type === 'product.updated'
    ) {
      const sku = String(data.codigo ?? `BLING-${evt.resource_id}`);
      const name = data.nome ? String(data.nome) : null;
      const insProd = await client.query<{ id: string }>(
        `INSERT INTO master_products (
           bling_id, bling_sku, name, bling_tipo, bling_formato, last_bling_snapshot, last_bling_sync
         ) VALUES ($1, $2, $3, 'P', 'S', $4, now())
         RETURNING id`,
        [evt.resource_id, sku, name, JSON.stringify(data)]
      );
      masterProductId = insProd.rows[0]!.id;

      await client.query(
        `INSERT INTO product_variants (master_product_id, bling_sku, is_default, bling_formato, price, stock)
         VALUES ($1, $2, true, 'S', $3, NULL)`,
        [masterProductId, sku, data.preco ? Number(data.preco) : 0]
      );
    }

    const changedFields =
      evt.event_type.startsWith('stock') || evt.event_type.startsWith('virtual_stock')
        ? ['stock']
        : candidateFields.length > 0
        ? candidateFields
        : [evt.event_type];

    // Se houver master_product e variantes ativas, registra mudança pendente para agregação do APE
    if (masterProductId) {
      // NUNCA copia estoque.saldoVirtualTotal em evento product (Seção 10.2)
      await client.query(
        `UPDATE master_products
         SET last_bling_snapshot = $2, last_bling_sync = now(), updated_at = now()
         WHERE id = $1`,
        [masterProductId, JSON.stringify(data)]
      );

      const varsRes = await client.query<{ id: string }>(
        `SELECT id FROM product_variants
         WHERE master_product_id = $1 AND variant_status <> 'discontinued'`,
        [masterProductId]
      );

      const isStockOrPriceOnly = changedFields.every(
        (f) => f === 'stock' || f === 'virtual_stock' || f === 'preco' || f === 'price'
      );
      const jobKind = isStockOrPriceOnly ? 'STOCK_PRICE' : 'CONTENT';
      const priority = classifyFieldPriority(changedFields[0] ?? 'other');

      for (const v of varsRes.rows) {
        for (const platform of ['mercadolivre', 'nuvemshop'] as const) {
          await client.query(
            `INSERT INTO pending_product_changes (
               master_product_id, variant_id, platform, job_kind, priority, changed_fields
             ) VALUES ($1, $2, $3, $4, $5, $6)`,
            [masterProductId, v.id, platform, jobKind, priority, changedFields]
          );
        }
      }
    }

    await client.query(
      `UPDATE webhook_events
       SET status = 'processed', processed_at = now()
       WHERE id = $1`,
      [evt.id]
    );

    await client.query(
      `INSERT INTO sync_logs (
         product_id, platform, direction, field_group, fields_changed,
         status, idempotency_key, webhook_event_id
       ) VALUES ($1, 'bling', 'inbound_webhook', $2, $3, 'processed', $4, $5)`,
      [
        masterProductId,
        resourceType,
        JSON.stringify(changedFields),
        evt.idempotency_key,
        evt.id,
      ]
    );

    return {
      webhookEventId: evt.id,
      idempotencyKey: evt.idempotency_key,
      outcome: 'processed',
      changedFields,
    };
  });
}

/**
 * Worker de Webhook de Mercado Livre e Nuvemshop (Seção 10.5):
 * - Não lê o evento como mudança do Bling e nunca escreve o valor do canal no ERP.
 * - Detecta eco de push_job_steps concluído -> ignored (motivo 'echo').
 * - Trata migração UPtin e exclusão de anúncio no canal (channel_deleted).
 */
async function processChannelWebhookInsideLock(evt: {
  id: string;
  source: WebhookSource;
  event_type: string;
  resource_id: string;
  content_hash: string;
  idempotency_key: string;
  raw_payload: Record<string, unknown>;
}): Promise<ProcessWebhookWorkerResult> {
  return withTransaction(async (client: PoolClient) => {
    const payload = evt.raw_payload;

    // 1. Verifica se é eco de um push_job_steps concluído recentemente para a mesma plataforma
    if (payload.echo_push_job_step_id) {
      const stepRes = await client.query<{ id: string }>(
        `SELECT id FROM push_job_steps
         WHERE id = $1 AND status = 'completed'`,
        [String(payload.echo_push_job_step_id)]
      );
      if (stepRes.rowCount && stepRes.rowCount > 0) {
        await markWebhookIgnored(client, evt, 'echo');
        return {
          webhookEventId: evt.id,
          idempotencyKey: evt.idempotency_key,
          outcome: 'ignored_echo',
          changedFields: [],
        };
      }
    }

    // 2. Migração UPtin no Mercado Livre (Seção 10.5)
    if (evt.source === 'mercadolivre' && payload.migration) {
      const notif = payload as unknown as MlUptinMigrationNotification;
      const oldLinkRes = await client.query<{
        id: string;
        master_product_id: string;
        match_confidence: number | null;
      }>(
        `SELECT id, master_product_id, match_confidence
         FROM platform_links
         WHERE platform = 'mercadolivre' AND platform_product_id = $1
         FOR UPDATE`,
        [notif.migration.old_item_id]
      );

      const oldLink = oldLinkRes.rows[0];
      if (oldLink) {
        const oldVarLink = await client.query<{ id: string; variant_id: string }>(
          `SELECT id, variant_id FROM platform_variant_links
           WHERE platform = 'mercadolivre'
             AND platform_product_id = $1
             AND platform_variant_id = $2
           FOR UPDATE`,
          [notif.migration.old_item_id, notif.migration.old_variation_id]
        );

        const mappedUptin = applyMlUptinMigration(
          {
            master_product_id: oldLink.master_product_id,
            variant_id: oldVarLink.rows[0]?.variant_id ?? '',
            match_confidence: oldLink.match_confidence ?? 95,
          },
          notif
        );

        await client.query(
          `UPDATE platform_links
           SET platform_product_id = $2,
               ml_model = 'user_product',
               family_id = $2,
               family_name = $3,
               family_confidence = $4,
               last_synced_at = now()
           WHERE id = $1`,
          [
            oldLink.id,
            mappedUptin.family_id,
            mappedUptin.family_name,
            mappedUptin.family_confidence,
          ]
        );
      }
    }

    // 3. Anúncio apagado no canal -> platform_links.sync_status = 'channel_deleted' e remove extra_ml/extra_ns (Seção 10.5)
    if (
      evt.event_type === 'product/deleted' ||
      payload.status === 'closed' ||
      payload.deleted === true
    ) {
      const linkRes = await client.query<{ id: string; master_product_id: string }>(
        `UPDATE platform_links
         SET sync_status = 'channel_deleted', last_synced_at = now()
         WHERE platform = $1 AND platform_product_id = $2
         RETURNING id, master_product_id`,
        [evt.source, evt.resource_id]
      );

      if (linkRes.rows[0]) {
        const extraCode = evt.source === 'mercadolivre' ? 'extra_ml' : 'extra_ns';
        await client.query(
          `DELETE FROM variant_matrix_analysis
           WHERE master_product_id = $1 AND status = $2`,
          [linkRes.rows[0].master_product_id, extraCode]
        );
      }
    }

    await client.query(
      `UPDATE webhook_events
       SET status = 'processed', processed_at = now()
       WHERE id = $1`,
      [evt.id]
    );

    await client.query(
      `INSERT INTO sync_logs (
         platform, direction, status, idempotency_key, webhook_event_id
       ) VALUES ($1, 'inbound_channel_webhook', 'processed', $2, $3)`,
      [evt.source, evt.idempotency_key, evt.id]
    );

    return {
      webhookEventId: evt.id,
      idempotencyKey: evt.idempotency_key,
      outcome: 'processed',
      changedFields: [],
    };
  });
}

/**
 * Recuperação pós-restart (Critério de saída da Fase 8 — "Restart depois do 200 não perde evento"):
 * Busca todos os eventos em webhook_events cujo status ainda é 'received' ou 'queued'
 * (porque o processo reiniciou logo após o HTTP 200 ou durante o enfileiramento) e os processa.
 */
export async function recoverAndProcessPendingWebhooks(
  workerId = 'wig-recovery-worker'
): Promise<ProcessWebhookWorkerResult[]> {
  const pendingRes = await query<{ id: string }>(
    `SELECT id
     FROM webhook_events
     WHERE status IN ('received', 'queued')
     ORDER BY created_at ASC`
  );

  const results: ProcessWebhookWorkerResult[] = [];
  for (const row of pendingRes.rows) {
    const res = await processWebhookEventById(row.id, workerId);
    results.push(res);
  }
  return results;
}
