import type { MigrationBuilder } from 'node-pg-migrate';

export const PARTITIONED_TABLES = [
  'identity_resolution_logs',
  'quality_history',
  'push_execution_logs',
  'sync_logs',
  'channel_readiness_history',
] as const;

export function buildMonthlyPartitionsSql(referenceDate: Date = new Date('2026-10-01T00:00:00Z')): {
  upSql: string;
  downSql: string;
} {
  const upStatements: string[] = [];
  const downStatements: string[] = [];

  const baseYear = referenceDate.getUTCFullYear();
  const baseMonth = referenceDate.getUTCMonth();

  // 14 partições mensais: de 12 meses atrás (-12) até 2 meses à frente (+1, totalizando 14 meses)
  for (let offset = -12; offset <= 1; offset++) {
    const start = new Date(Date.UTC(baseYear, baseMonth + offset, 1, 0, 0, 0));
    const end = new Date(Date.UTC(baseYear, baseMonth + offset + 1, 1, 0, 0, 0));
    const yyyy = start.getUTCFullYear();
    const mm = String(start.getUTCMonth() + 1).padStart(2, '0');
    const fromIso = start.toISOString();
    const toIso = end.toISOString();

    for (const table of PARTITIONED_TABLES) {
      const partName = `${table}_y${yyyy}m${mm}`;
      upStatements.push(
        `CREATE TABLE IF NOT EXISTS ${partName} PARTITION OF ${table} FOR VALUES FROM ('${fromIso}') TO ('${toIso}');`
      );
      downStatements.push(`DROP TABLE IF EXISTS ${partName};`);
    }
  }

  return {
    upSql: upStatements.join('\n'),
    downSql: downStatements.reverse().join('\n'),
  };
}

export const SEEDS_UP_SQL = `
INSERT INTO attribute_axes (canonical_name, display_name, bling_key, ml_attribute_id, ns_option_name, sort_order)
VALUES
  ('cor', 'Cor', 'Cor', 'COLOR', 'Cor', 1),
  ('tamanho', 'Tamanho', 'Tamanho', 'SIZE', 'Tamanho', 2),
  ('voltagem', 'Voltagem', 'Voltagem', 'VOLTAGE', 'Voltagem', 3),
  ('peso', 'Peso', 'Peso', 'WEIGHT', 'Peso', 4),
  ('apresentacao', 'Apresentação', 'Apresentacao', 'PRESENTATION', 'Apresentação', 5)
ON CONFLICT (canonical_name) DO NOTHING;

INSERT INTO attribute_value_aliases (axis_id, canonical_value, aliases, sort_order)
SELECT id, 'P', ARRAY['P', 'Pequeno', 'Small', 'S'], 1 FROM attribute_axes WHERE canonical_name = 'tamanho'
ON CONFLICT (axis_id, canonical_value) DO NOTHING;

INSERT INTO attribute_value_aliases (axis_id, canonical_value, aliases, sort_order)
SELECT id, 'M', ARRAY['M', 'Médio', 'Medio', 'Medium'], 2 FROM attribute_axes WHERE canonical_name = 'tamanho'
ON CONFLICT (axis_id, canonical_value) DO NOTHING;

INSERT INTO attribute_value_aliases (axis_id, canonical_value, aliases, sort_order)
SELECT id, 'G', ARRAY['G', 'Grande', 'Large', 'L'], 3 FROM attribute_axes WHERE canonical_name = 'tamanho'
ON CONFLICT (axis_id, canonical_value) DO NOTHING;

INSERT INTO attribute_value_aliases (axis_id, canonical_value, aliases, sort_order)
SELECT id, 'GG', ARRAY['GG', 'Extra Grande', 'XL', 'X-Large'], 4 FROM attribute_axes WHERE canonical_name = 'tamanho'
ON CONFLICT (axis_id, canonical_value) DO NOTHING;

INSERT INTO platform_image_limits (platform, max_images, min_width, min_height, notes)
VALUES
  ('mercadolivre', 10, 500, 500, 'Capa com fundo neutro e mínimo 500x500'),
  ('nuvemshop', 50, 200, 200, 'Alt text recomendado'),
  ('bling', 10, 100, 100, 'Até 10 imagens no ERP')
ON CONFLICT (platform) DO NOTHING;

INSERT INTO dlm_retention_policies (target_table, retention_days, strategy, batch_size, is_enabled)
VALUES
  ('enrichment_staging', 30, 'batch_delete', 1000, true),
  ('matching_queue', 60, 'batch_delete', 1000, true),
  ('enrichment_suggestions', 30, 'batch_delete', 1000, true),
  ('image_rights_review_queue', 90, 'batch_delete', 1000, true),
  ('image_processing_queue', 7, 'batch_delete', 1000, true),
  ('push_jobs', 7, 'batch_delete', 1000, true),
  ('webhook_events', 30, 'batch_delete', 1000, true),
  ('sync_logs', 365, 'drop_partition', 1000, true),
  ('quality_history', 365, 'drop_partition', 1000, true),
  ('channel_readiness_history', 365, 'drop_partition', 1000, true),
  ('push_execution_logs', 365, 'drop_partition', 1000, true),
  ('identity_resolution_logs', 90, 'drop_partition', 1000, true),
  ('divergence_alerts', 90, 'move_to_archive', 500, true),
  ('ncm_audit_log', 540, 'move_to_archive', 500, true),
  ('ean_validation_history', 540, 'move_to_archive', 500, true),
  ('dlm_job_runs', 36500, 'permanent', 1000, true),
  ('control_changes', 36500, 'permanent', 1000, true)
ON CONFLICT (target_table) DO NOTHING;

INSERT INTO channel_sync_owners (platform, stock_price, content)
VALUES
  ('mercadolivre', 'bling_native', 'hub'),
  ('nuvemshop', 'bling_native', 'hub')
ON CONFLICT (platform) DO NOTHING;

INSERT INTO enrichment_controls (platform, mode, kill_switch, max_replaces_per_run)
VALUES
  ('mercadolivre', 'shadow', false, 25),
  ('nuvemshop', 'shadow', false, 25)
ON CONFLICT (platform) DO NOTHING;

INSERT INTO stock_warehouses (bling_warehouse_id, name, role, include_in_push)
VALUES
  ('9001', 'Depósito Principal Vendedor', 'seller', true),
  ('9002', 'Depósito Showroom Vendedor', 'seller', false),
  ('9099', 'Depósito Espelho Full Mercado Livre', 'ml_full', false)
ON CONFLICT (bling_warehouse_id) DO NOTHING;

INSERT INTO channel_stores (platform, bling_loja_id, name)
VALUES
  ('mercadolivre', '204501', 'Loja Mercado Livre Oficial'),
  ('nuvemshop', '204502', 'Loja Nuvemshop Oficial')
ON CONFLICT (platform) DO NOTHING;
`;

export const SEEDS_DOWN_SQL = `
DELETE FROM channel_stores WHERE platform IN ('mercadolivre', 'nuvemshop');
DELETE FROM stock_warehouses WHERE bling_warehouse_id IN ('9001', '9002', '9099');
DELETE FROM enrichment_controls WHERE platform IN ('mercadolivre', 'nuvemshop');
DELETE FROM channel_sync_owners WHERE platform IN ('mercadolivre', 'nuvemshop');
DELETE FROM dlm_retention_policies;
DELETE FROM platform_image_limits;
DELETE FROM attribute_value_aliases;
DELETE FROM attribute_axes;
`;

export async function up(pgm: MigrationBuilder): Promise<void> {
  const { upSql } = buildMonthlyPartitionsSql();
  pgm.sql(upSql);
  pgm.sql(SEEDS_UP_SQL);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  const { downSql } = buildMonthlyPartitionsSql();
  pgm.sql(SEEDS_DOWN_SQL);
  pgm.sql(downSql);
}
