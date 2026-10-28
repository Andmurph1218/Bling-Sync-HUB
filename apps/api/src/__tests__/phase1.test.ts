import crypto from 'node:crypto';
import { newDb, DataType } from 'pg-mem';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { DbPoolLike, query, setPool } from '../db/pool.js';
import {
  ALL_MIGRATIONS,
  runAllMigrationsDown,
  runAllMigrationsUp,
} from '../db/migrator.js';
import {
  buildMonthlyPartitionsSql,
  PARTITIONED_TABLES,
} from '../db/migrations/1729080000012_partitions-and-seeds.js';
import { createUser } from '../auth/service.js';

describe('Fase 1 — Schema Completo (Migrations 1 a 12 sobem e descem, Seeds, Índices Parciais e Constraints)', () => {
  let poolInstance: DbPoolLike;

  beforeAll(() => {
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
  });

  afterAll(async () => {
    if (poolInstance) {
      await poolInstance.end();
    }
    setPool(null);
  });

  it('1. Sobe as 13 migrations em ordem e popula os seeds iniciais (eixos, aliases, limites, DLM, depósitos e lojas)', async () => {
    const applied = await runAllMigrationsUp({ stripPartitionClauseForMemDb: true });
    expect(applied).toHaveLength(13);
    expect(ALL_MIGRATIONS).toHaveLength(13);

    const axesCount = await query<{ count: number }>(
      `SELECT count(*)::int AS count FROM attribute_axes`
    );
    expect(axesCount.rows[0]?.count).toBe(5);

    const aliasesCount = await query<{ count: number }>(
      `SELECT count(*)::int AS count FROM attribute_value_aliases`
    );
    expect(aliasesCount.rows[0]?.count).toBe(4);

    const limitsCount = await query<{ count: number }>(
      `SELECT count(*)::int AS count FROM platform_image_limits`
    );
    expect(limitsCount.rows[0]?.count).toBe(3);

    const dlmPolicies = await query<{ count: number }>(
      `SELECT count(*)::int AS count FROM dlm_retention_policies`
    );
    expect(dlmPolicies.rows[0]?.count).toBe(17);

    const syncOwners = await query<{ platform: string; stock_price: string; content: string }>(
      `SELECT platform, stock_price, content FROM channel_sync_owners ORDER BY platform ASC`
    );
    expect(syncOwners.rows).toEqual([
      { platform: 'mercadolivre', stock_price: 'bling_native', content: 'hub' },
      { platform: 'nuvemshop', stock_price: 'bling_native', content: 'hub' },
    ]);

    const stores = await query<{ platform: string; bling_loja_id: string }>(
      `SELECT platform, bling_loja_id FROM channel_stores ORDER BY platform ASC`
    );
    expect(stores.rows).toEqual([
      { platform: 'mercadolivre', bling_loja_id: '204501' },
      { platform: 'nuvemshop', bling_loja_id: '204502' },
    ]);
  });

  it('2. Garante constraints críticas: uq_one_default_variant, push_jobs_active (pending vs locked) e dupla confirmação de NCM por usuários distintos', async () => {
    const prodRes = await query<{ id: string }>(
      `INSERT INTO master_products (bling_id, bling_sku, name, bling_tipo, bling_formato)
       VALUES ('100101', 'GAR-INOX-500-PT', 'Garrafa Térmica Inox', 'P', 'S')
       RETURNING id`
    );
    const masterId = prodRes.rows[0]!.id;

    const varRes = await query<{ id: string }>(
      `INSERT INTO product_variants (master_product_id, bling_sku, is_default, bling_formato, price)
       VALUES ($1, 'GAR-INOX-500-PT', true, 'S', 89.90)
       RETURNING id`,
      [masterId]
    );
    const variantId = varRes.rows[0]!.id;

    // Segunda variante is_default para o mesmo produto deve falhar no índice uq_one_default_variant
    await expect(
      query(
        `INSERT INTO product_variants (master_product_id, bling_sku, is_default, bling_formato, price)
         VALUES ($1, 'GAR-INOX-500-PT-DUP', true, 'S', 89.90)`,
        [masterId]
      )
    ).rejects.toThrow();

    // Índice único parcial push_jobs_active: impede dois jobs pending iguais, mas permite quando o primeiro está locked
    const firstJob = await query<{ id: string }>(
      `INSERT INTO push_jobs (master_product_id, variant_id, platform, job_kind, status)
       VALUES ($1, $2, 'mercadolivre', 'STOCK_PRICE', 'pending')
       RETURNING id`,
      [masterId, variantId]
    );

    await expect(
      query(
        `INSERT INTO push_jobs (master_product_id, variant_id, platform, job_kind, status)
         VALUES ($1, $2, 'mercadolivre', 'STOCK_PRICE', 'pending')`,
        [masterId, variantId]
      )
    ).rejects.toThrow();

    // Passa o primeiro job para locked -> agora uma nova janela pending pode nascer
    await query(`UPDATE push_jobs SET status = 'locked' WHERE id = $1`, [
      firstJob.rows[0]!.id,
    ]);

    const secondWindowJob = await query<{ id: string }>(
      `INSERT INTO push_jobs (master_product_id, variant_id, platform, job_kind, status)
       VALUES ($1, $2, 'mercadolivre', 'STOCK_PRICE', 'pending')
       RETURNING id`,
      [masterId, variantId]
    );
    expect(secondWindowJob.rows[0]?.id).toBeDefined();

    // Dupla confirmação de NCM: o segundo revisor não pode ser igual ao primeiro e exige nota de TIPI
    const reviewer1 = await createUser({
      email: 'fiscal1@blingsync.local',
      name: 'Fiscal Um',
      password: 'Password!Fiscal1',
      roles: ['fiscal_approver'],
    });
    const reviewer2 = await createUser({
      email: 'fiscal2@blingsync.local',
      name: 'Fiscal Dois',
      password: 'Password!Fiscal2',
      roles: ['fiscal_approver'],
    });

    await expect(
      query(
        `INSERT INTO ncm_manual_suggestions (
           master_product_id, proposed_ncm, source_platform, status,
           first_review_by, second_review_by, tipi_consultation_note, expires_at
         ) VALUES ($1, '9617.00.10', 'mercadolivre', 'approved', $2, $2, 'Nota TIPI cap 96', now() + interval '15 days')`,
        [masterId, reviewer1.id]
      )
    ).rejects.toThrow();

    const validNcmApproval = await query<{ id: string }>(
      `INSERT INTO ncm_manual_suggestions (
         master_product_id, proposed_ncm, source_platform, status,
         first_review_by, second_review_by, tipi_consultation_note, expires_at
       ) VALUES ($1, '9617.00.10', 'mercadolivre', 'approved', $2, $3, 'Nota TIPI cap 96 validada', now() + interval '15 days')
       RETURNING id`,
      [masterId, reviewer1.id, reviewer2.id]
    );
    expect(validNcmApproval.rows[0]?.id).toBeDefined();
  });

  it('3. Gera exatamente 14 partições mensais (-12m a +2m) para cada uma das 5 tabelas particionadas do PostgreSQL 16', () => {
    const { upSql, downSql } = buildMonthlyPartitionsSql(
      new Date('2026-10-01T00:00:00Z')
    );
    const createLines = upSql.split('\n').filter(Boolean);
    const dropLines = downSql.split('\n').filter(Boolean);

    expect(PARTITIONED_TABLES).toHaveLength(5);
    expect(createLines).toHaveLength(14 * 5);
    expect(dropLines).toHaveLength(14 * 5);
    expect(upSql).toContain('PARTITION OF sync_logs FOR VALUES FROM');
    expect(upSql).toContain('PARTITION OF quality_history FOR VALUES FROM');
    expect(upSql).toContain('PARTITION OF push_execution_logs FOR VALUES FROM');
    expect(upSql).toContain('PARTITION OF channel_readiness_history FOR VALUES FROM');
    expect(upSql).toContain('PARTITION OF identity_resolution_logs FOR VALUES FROM');
  });

  it('4. Garante idempotência no up e desce todas as 13 migrations (down) removendo todas as tabelas de domínio', async () => {
    // Reexecutar up quando todas as 13 já subiram deve ser no-op (idempotente)
    const noopUp = await runAllMigrationsUp({ stripPartitionClauseForMemDb: true });
    expect(noopUp).toHaveLength(0);

    // Desce todas as 13 migrations na ordem inversa (13 -> 1)
    const reverted = await runAllMigrationsDown({ stripPartitionClauseForMemDb: true });
    expect(reverted).toHaveLength(13);

    const remaining = await query<{ count: number }>(
      `SELECT count(*)::int AS count FROM pgmigrations`
    );
    expect(remaining.rows[0]?.count).toBe(0);

    const tablesLeft = await query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name <> 'pgmigrations'`
    );
    expect(tablesLeft.rows).toHaveLength(0);

    // Reexecutar down quando já desceu tudo deve ser no-op (idempotente)
    const noopDown = await runAllMigrationsDown({ stripPartitionClauseForMemDb: true });
    expect(noopDown).toHaveLength(0);
  });
});
