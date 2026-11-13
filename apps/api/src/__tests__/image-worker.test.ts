import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { newDb, DataType } from 'pg-mem';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { DbPoolLike, query, setPool } from '../db/pool.js';
import { runAllMigrationsUp } from '../db/migrator.js';
import { setRedis } from '../lib/redis.js';
import {
  enqueueProductImagesForSync,
  isAllowedImageHost,
  normalizeImageUrl,
} from '../engines/iqre.js';
import { parseImageDimensions, runImageWorkerOnce } from '../queues/image-worker.js';
import { persistCachedMediaFile } from '../routes/media.js';
import { reconcileListings } from '../services/reconciliation.service.js';

function makePngBuffer(width: number, height: number): Buffer {
  const buf = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  buf[24] = 8;
  buf[25] = 6;
  return buf;
}

function makeJpegBuffer(width: number, height: number): Buffer {
  const buf = Buffer.alloc(24);
  buf[0] = 0xff;
  buf[1] = 0xd8;
  buf[2] = 0xff;
  buf[3] = 0xc0;
  buf.writeUInt16BE(11, 4);
  buf[6] = 8;
  buf.writeUInt16BE(height, 7);
  buf.writeUInt16BE(width, 9);
  buf[22] = 0xff;
  buf[23] = 0xd9;
  return buf;
}

describe('pipeline de sincronização e cache de imagens (IQRE + Worker + Nuvemshop)', () => {
  const app = createApp();
  let poolInstance: DbPoolLike;
  let tmpMediaDir = '';

  beforeAll(async () => {
    tmpMediaDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'hub-media-test-'));
    process.env.MEDIA_STORAGE_DIR = tmpMediaDir;

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
    setRedis({ ping: async () => 'PONG', quit: async () => 'OK' });
    await runAllMigrationsUp({ stripPartitionClauseForMemDb: true });
  });

  afterAll(async () => {
    delete process.env.MEDIA_STORAGE_DIR;
    if (tmpMediaDir) {
      await fs.promises.rm(tmpMediaDir, { recursive: true, force: true }).catch(() => undefined);
    }
    if (poolInstance) await poolInstance.end();
    setPool(null);
  });

  it('normaliza URLs pré-assinadas do S3 do Bling sem duplicar e bloqueia SSRF local', () => {
    const s3Url1 =
      'https://orgbling.s3.amazonaws.com/bucket/foto1?AWSAccessKeyId=AKIA1&Expires=1795146201&Signature=abc%3D';
    const s3Url2 =
      'https://orgbling.s3.amazonaws.com/bucket/foto1?AWSAccessKeyId=AKIA1&Expires=1799999999&Signature=xyz%3D';

    expect(isAllowedImageHost(s3Url1, 'bling')).toBe(true);
    expect(isAllowedImageHost('https://acdn-us.mitiendanube.com/stores/1/img.jpg', 'nuvemshop')).toBe(true);
    expect(isAllowedImageHost('http://127.0.0.1:8080/secret.png', 'bling')).toBe(false);
    expect(isAllowedImageHost('https://169.254.169.254/meta', 'erp')).toBe(false);

    expect(normalizeImageUrl(s3Url1)).toBe('https://orgbling.s3.amazonaws.com/bucket/foto1');
    expect(normalizeImageUrl(s3Url2)).toBe('https://orgbling.s3.amazonaws.com/bucket/foto1');
  });

  it('lê dimensões binárias PNG/JPEG, processa a fila IQRE promovendo capa e serve /api/media/:sha256', async () => {
    const png800 = makePngBuffer(800, 800);
    const jpg600 = makeJpegBuffer(600, 500);
    expect(parseImageDimensions(png800)).toEqual({ width: 800, height: 800, format: 'png' });
    expect(parseImageDimensions(jpg600)).toEqual({ width: 600, height: 500, format: 'jpeg' });

    const created = await query<{ id: string }>(
      `INSERT INTO master_products (erp_id, erp_sku, name, bling_tipo, product_format)
       VALUES ('erp-img-w1', 'SKU-IMG-W1', 'Disjuntor Foto S3', 'P', 'S')
       RETURNING id`
    );
    const productId = created.rows[0]!.id;
    await query(
      `INSERT INTO product_variants (master_product_id, erp_sku, is_default, price)
       VALUES ($1, 'SKU-IMG-W1', true, 50)`,
      [productId]
    );

    const s3Signed =
      'https://orgbling.s3.amazonaws.com/0e6e/foto-s3?AWSAccessKeyId=AKIA&Expires=1795146201&Signature=sig1';
    await enqueueProductImagesForSync(productId, [{ source_url: s3Signed, source_platform: 'bling' }]);

    const sha = crypto.createHash('sha256').update(png800).digest('hex');
    await persistCachedMediaFile(sha, 'png', png800);

    const run = await runImageWorkerOnce(async () => ({
      buffer: png800,
      width: 800,
      height: 800,
      format: 'png',
      averageHash: 'f0f0f0f0f0f0f0f0',
    }));

    expect(run).toEqual({ claimed: 1, fetched: 1, finalized: 1 });

    const saved = await query<{ is_cover_eligible: boolean; sha256_hash: string }>(
      `SELECT is_cover_eligible, sha256_hash FROM product_images WHERE master_product_id = $1`,
      [productId]
    );
    expect(saved.rows[0]).toEqual({ is_cover_eligible: true, sha256_hash: sha });

    const mediaRes = await request(app).get(`/api/media/${sha}.png`);
    expect(mediaRes.status).toBe(200);
    expect(mediaRes.headers['content-type']).toContain('image/png');
  });

  it('enfileira automaticamente imagens da Nuvemshop na reconciliação quando o produto não tem foto no HUB', async () => {
    const created = await query<{ id: string }>(
      `INSERT INTO master_products (erp_id, erp_sku, name, bling_tipo, product_format)
       VALUES ('erp-ns-img', 'SKU-NS-IMG', 'Relé Sem Foto no Bling', 'P', 'S')
       RETURNING id`
    );
    const prodId = created.rows[0]!.id;
    await query(
      `INSERT INTO product_variants (master_product_id, erp_sku, is_default, price, stock)
       VALUES ($1, 'SKU-NS-IMG', true, 120, 3)`,
      [prodId]
    );

    await reconcileListings(
      async (channel) =>
        channel === 'nuvemshop'
          ? {
              externalId: 'NS-777',
              title: 'Relé Sem Foto no Bling',
              price: 120,
              stock: 3,
              images: ['https://acdn-us.mitiendanube.com/stores/006/667/412/products/rele-1024.jpg'],
              status: 'Ativo',
              signals: ['sku', 'title'],
            }
          : null,
      { sku: 'SKU-NS-IMG' }
    );

    const queued = await query<{ source_platform: string; source_url: string }>(
      `SELECT source_platform, source_url FROM image_processing_queue WHERE master_product_id = $1`,
      [prodId]
    );
    expect(queued.rows).toEqual([
      {
        source_platform: 'nuvemshop',
        source_url: 'https://acdn-us.mitiendanube.com/stores/006/667/412/products/rele-1024.jpg',
      },
    ]);
  });
});
