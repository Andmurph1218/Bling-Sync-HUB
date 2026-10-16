import type { MigrationBuilder } from 'node-pg-migrate';

export const UP_SQL = `
CREATE TABLE IF NOT EXISTS master_products (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bling_id            text NOT NULL UNIQUE,
  bling_sku           text NOT NULL UNIQUE,
  ncm                 varchar(8),
  cest                text,
  tax_origin          smallint,
  unit                varchar(10),
  requires_cest       boolean NOT NULL DEFAULT false,
  ncm_status          text NOT NULL DEFAULT 'unknown'
                        CHECK (ncm_status IN ('unknown', 'valid', 'invalid', 'divergent', 'conflict', 'pending_approval')),
  ncm_validated_at    timestamptz,
  ncm_validated_by    uuid REFERENCES users(id),
  ncm_fiscal_risk     boolean NOT NULL DEFAULT false,
  bling_tipo          text NOT NULL DEFAULT 'P' CHECK (bling_tipo IN ('P', 'S', 'N')),
  bling_formato       text NOT NULL DEFAULT 'S' CHECK (bling_formato IN ('S', 'V', 'E')),
  name                text,
  description         text,
  short_description   text,
  brand               text,
  category            text,
  meta_description    varchar(160),
  seo_slug            text,
  warranty_months     smallint,
  keywords            text[],
  videos              jsonb NOT NULL DEFAULT '[]',
  extra_attributes    jsonb NOT NULL DEFAULT '{}',
  matching_status     text NOT NULL DEFAULT 'unmatched',
  catalog_status      text NOT NULL DEFAULT 'active' CHECK (catalog_status IN ('active', 'inactive', 'deleted')),
  status_changed_at   timestamptz,
  last_bling_snapshot jsonb,
  last_bling_sync     timestamptz,
  last_ml_sync        timestamptz,
  last_ns_sync        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS product_variants (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  master_product_id  uuid NOT NULL REFERENCES master_products(id) ON DELETE CASCADE,
  bling_variant_id   text UNIQUE,
  bling_sku          text NOT NULL UNIQUE,
  is_default         boolean NOT NULL DEFAULT false,
  bling_formato      text NOT NULL DEFAULT 'S' CHECK (bling_formato IN ('S', 'E')),
  stock_mode         text CHECK (stock_mode IS NULL OR stock_mode IN ('physical', 'virtual')),
  price              numeric(10,2),
  promotional_price  numeric(10,2),
  use_promotional    boolean NOT NULL DEFAULT false,
  cost_price         numeric(10,2),
  stock              numeric(12,3),
  net_weight         numeric(8,3),
  gross_weight       numeric(8,3),
  height             numeric(8,2),
  width              numeric(8,2),
  depth              numeric(8,2),
  ean                varchar(14),
  ean_status         text NOT NULL DEFAULT 'unknown'
                       CHECK (ean_status IN ('unknown', 'valid', 'invalid', 'pending_validation', 'divergent', 'duplicate')),
  ean_validated_at   timestamptz,
  ean_validated_by   uuid REFERENCES users(id),
  fiscal_risk_flag   boolean NOT NULL DEFAULT false,
  quality_scores     jsonb NOT NULL DEFAULT '{}',
  is_active          boolean NOT NULL DEFAULT true,
  variant_status     text NOT NULL DEFAULT 'active' CHECK (variant_status IN ('active', 'inactive', 'discontinued')),
  last_bling_sync    timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (bling_formato = 'S' AND stock_mode IS NULL)
    OR (bling_formato = 'E' AND stock_mode IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_one_default_variant
  ON product_variants (master_product_id, is_default)
  WHERE is_default = true;

CREATE TABLE IF NOT EXISTS product_components (
  kit_variant_id       uuid NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  component_bling_id   text NOT NULL,
  component_variant_id uuid REFERENCES product_variants(id),
  quantity             numeric(12,4) NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (kit_variant_id, component_bling_id),
  CHECK (kit_variant_id IS DISTINCT FROM component_variant_id)
);

CREATE TABLE IF NOT EXISTS variant_stock_balances (
  variant_id         uuid NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  bling_warehouse_id text NOT NULL REFERENCES stock_warehouses(bling_warehouse_id),
  saldo_fisico       numeric(12,3) NOT NULL DEFAULT 0,
  saldo_virtual      numeric(12,3) NOT NULL DEFAULT 0,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (variant_id, bling_warehouse_id)
);

CREATE TABLE IF NOT EXISTS variant_channel_prices (
  variant_id              uuid NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  platform                text NOT NULL REFERENCES channel_stores(platform),
  store_price             numeric(10,2),
  store_promotional_price numeric(10,2),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (variant_id, platform)
);

CREATE TABLE IF NOT EXISTS attribute_axes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name  text NOT NULL UNIQUE,
  display_name    text NOT NULL,
  bling_key       text,
  ml_attribute_id text,
  ns_option_name  text,
  sort_order      smallint NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS product_axes (
  master_product_id uuid NOT NULL REFERENCES master_products(id) ON DELETE CASCADE,
  axis_id           uuid NOT NULL REFERENCES attribute_axes(id),
  sort_order        smallint NOT NULL DEFAULT 0,
  PRIMARY KEY (master_product_id, axis_id)
);

CREATE TABLE IF NOT EXISTS attribute_value_aliases (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  axis_id         uuid NOT NULL REFERENCES attribute_axes(id) ON DELETE CASCADE,
  canonical_value text NOT NULL,
  aliases         text[] NOT NULL,
  sort_order      smallint NOT NULL DEFAULT 0,
  UNIQUE (axis_id, canonical_value)
);

CREATE TABLE IF NOT EXISTS variant_attributes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id      uuid NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  axis_id         uuid NOT NULL REFERENCES attribute_axes(id),
  canonical_value text NOT NULL,
  sort_order      smallint NOT NULL DEFAULT 0,
  UNIQUE (variant_id, axis_id)
);
`;

export const DOWN_SQL = `
DROP TABLE IF EXISTS variant_attributes;
DROP TABLE IF EXISTS attribute_value_aliases;
DROP TABLE IF EXISTS product_axes;
DROP TABLE IF EXISTS attribute_axes;
DROP TABLE IF EXISTS variant_channel_prices;
DROP TABLE IF EXISTS variant_stock_balances;
DROP TABLE IF EXISTS product_components;
DROP INDEX IF EXISTS uq_one_default_variant;
DROP TABLE IF EXISTS product_variants;
DROP TABLE IF EXISTS master_products;
`;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(UP_SQL);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(DOWN_SQL);
}
