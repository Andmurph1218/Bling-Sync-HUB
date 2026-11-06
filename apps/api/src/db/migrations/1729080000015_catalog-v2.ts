import type { MigrationBuilder } from 'node-pg-migrate';

/**
 * P1 — catálogo operacional:
 * arquivar sem apagar no ERP, árvore de categorias do HUB
 * e mapas de atributos por categoria e canal.
 */
export const UP_SQL = `
ALTER TABLE master_products
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

ALTER TABLE master_products
  ADD COLUMN IF NOT EXISTS hub_category_id uuid;

CREATE TABLE IF NOT EXISTS hub_categories (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id  uuid REFERENCES hub_categories(id),
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE master_products
  DROP CONSTRAINT IF EXISTS master_products_hub_category_id_fkey;
ALTER TABLE master_products
  ADD CONSTRAINT master_products_hub_category_id_fkey
  FOREIGN KEY (hub_category_id) REFERENCES hub_categories(id);

CREATE INDEX IF NOT EXISTS master_products_list_updated
  ON master_products (catalog_status, updated_at);

CREATE TABLE IF NOT EXISTS channel_category_maps (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_category_id        uuid NOT NULL REFERENCES hub_categories(id) ON DELETE CASCADE,
  platform               text NOT NULL CHECK (platform IN ('mercadolivre', 'nuvemshop')),
  channel_category_id    text NOT NULL,
  channel_category_name  text NOT NULL,
  UNIQUE (hub_category_id, platform)
);

CREATE TABLE IF NOT EXISTS channel_attribute_maps (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_category_map_id uuid NOT NULL REFERENCES channel_category_maps(id) ON DELETE CASCADE,
  channel_attribute_id    text NOT NULL,
  channel_attribute_name  text NOT NULL,
  required                boolean NOT NULL DEFAULT false,
  mode                    text NOT NULL CHECK (mode IN ('fixed', 'dynamic', 'manual')),
  fixed_value             text,
  source_field            text,
  UNIQUE (channel_category_map_id, channel_attribute_id)
);

CREATE TABLE IF NOT EXISTS channel_attribute_value_maps (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_attribute_map_id uuid NOT NULL REFERENCES channel_attribute_maps(id) ON DELETE CASCADE,
  hub_value                text NOT NULL,
  channel_value            text NOT NULL,
  UNIQUE (channel_attribute_map_id, hub_value)
);
`;

export const DOWN_SQL = `
DROP TABLE IF EXISTS channel_attribute_value_maps;
DROP TABLE IF EXISTS channel_attribute_maps;
DROP TABLE IF EXISTS channel_category_maps;
ALTER TABLE master_products DROP CONSTRAINT IF EXISTS master_products_hub_category_id_fkey;
ALTER TABLE master_products DROP COLUMN IF EXISTS hub_category_id;
ALTER TABLE master_products DROP COLUMN IF EXISTS archived_at;
DROP INDEX IF EXISTS master_products_list_updated;
DROP TABLE IF EXISTS hub_categories CASCADE;
`;

export const shorthands = {};

export function up(pgm: MigrationBuilder): void {
  pgm.sql(UP_SQL);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(DOWN_SQL);
}
