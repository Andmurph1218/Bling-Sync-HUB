import type { MigrationBuilder } from 'node-pg-migrate';

export const UP_SQL = `
CREATE TABLE IF NOT EXISTS platform_links (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  master_product_id   uuid NOT NULL REFERENCES master_products(id) ON DELETE CASCADE,
  platform            text NOT NULL CHECK (platform IN ('mercadolivre', 'nuvemshop')),
  platform_product_id text NOT NULL,
  platform_sku_raw    text,
  platform_sku_field  text,
  match_method        text NOT NULL,
  match_confidence    smallint,
  match_signals       jsonb NOT NULL DEFAULT '{}',
  confirmed_by        uuid REFERENCES users(id),
  confirmed_at        timestamptz,
  ml_model            text CHECK (ml_model IS NULL OR ml_model IN ('legacy_variations', 'user_product')),
  family_id           text,
  family_name         text,
  family_confidence   smallint,
  sync_status         text NOT NULL DEFAULT 'pending',
  last_synced_at      timestamptz,
  UNIQUE (platform, platform_product_id),
  CHECK (
    family_confidence IS NULL
    OR (ml_model = 'user_product' AND family_confidence BETWEEN 0 AND 100)
  )
);

CREATE TABLE IF NOT EXISTS platform_variant_links (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id            uuid NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  master_product_id     uuid NOT NULL REFERENCES master_products(id) ON DELETE CASCADE,
  platform              text NOT NULL CHECK (platform IN ('mercadolivre', 'nuvemshop')),
  platform_product_id   text NOT NULL,
  platform_variant_id   text NOT NULL DEFAULT '',
  platform_sku_raw      text,
  platform_sku_field    text,
  raw_attributes        jsonb NOT NULL DEFAULT '[]',
  normalized_attributes jsonb NOT NULL DEFAULT '[]',
  match_method          text,
  match_confidence      smallint,
  platform_price        numeric(10,2),
  platform_stock        integer,
  platform_ean          varchar(14),
  user_product_id       text,
  sync_status           text NOT NULL DEFAULT 'pending',
  last_synced_at        timestamptz,
  UNIQUE (platform, platform_product_id, platform_variant_id)
);

CREATE TABLE IF NOT EXISTS ml_selling_conditions (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_variant_link_id  uuid NOT NULL REFERENCES platform_variant_links(id) ON DELETE CASCADE,
  item_id                   text NOT NULL UNIQUE,
  listing_status            text,
  price                     numeric(10,2),
  follow_store_price        boolean NOT NULL DEFAULT false,
  follow_set_by             uuid REFERENCES users(id),
  logistic_type             text,
  inventory_id              text,
  last_synced_at            timestamptz
);

CREATE TABLE IF NOT EXISTS ml_stock_locations (
  user_product_id  text NOT NULL,
  location_type    text NOT NULL CHECK (location_type IN ('meli_facility', 'selling_address', 'seller_warehouse')),
  store_id         text NOT NULL DEFAULT '',
  network_node_id  text NOT NULL DEFAULT '',
  quantity         integer NOT NULL DEFAULT 0,
  stock_version    bigint,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_product_id, location_type, store_id, network_node_id)
);

CREATE TABLE IF NOT EXISTS platform_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform            text NOT NULL CHECK (platform IN ('mercadolivre', 'nuvemshop')),
  platform_product_id text NOT NULL,
  status              text NOT NULL CHECK (status IN (
                        'suggestion', 'quarantine', 'linked', 'dismissed', 'new_product'
                      )),
  master_product_id   uuid REFERENCES master_products(id),
  decided_by          uuid REFERENCES users(id),
  decided_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, platform_product_id)
);

CREATE TABLE IF NOT EXISTS matching_queue (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_item_id    uuid NOT NULL REFERENCES platform_items(id) ON DELETE CASCADE,
  platform_raw_data   jsonb NOT NULL,
  suggested_matches   jsonb NOT NULL DEFAULT '[]',
  best_score          smallint,
  status              text NOT NULL DEFAULT 'pending' CHECK (status IN (
                        'pending', 'matched', 'dismissed', 'new_product'
                      )),
  resolution          jsonb,
  resolved_by         uuid REFERENCES users(id),
  resolved_at         timestamptz,
  expires_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (status = 'pending' OR expires_at IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS match_rejections (
  platform_item_id  uuid NOT NULL REFERENCES platform_items(id) ON DELETE CASCADE,
  master_product_id uuid NOT NULL REFERENCES master_products(id) ON DELETE CASCADE,
  rejected_by       uuid NOT NULL REFERENCES users(id),
  reason            text,
  rejected_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (platform_item_id, master_product_id)
);

CREATE TABLE IF NOT EXISTS variant_matrix_analysis (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  master_product_id   uuid NOT NULL REFERENCES master_products(id) ON DELETE CASCADE,
  variant_id          uuid REFERENCES product_variants(id) ON DELETE CASCADE,
  combo_key           text NOT NULL,
  has_bling           boolean NOT NULL DEFAULT false,
  has_ml              boolean NOT NULL DEFAULT false,
  has_ns              boolean NOT NULL DEFAULT false,
  status              text NOT NULL CHECK (status IN (
                        'ok', 'missing_ml', 'missing_ns', 'extra_ml', 'extra_ns', 'discontinued'
                      )),
  analyzed_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (master_product_id, combo_key)
);
`;

export const DOWN_SQL = `
DROP TABLE IF EXISTS variant_matrix_analysis;
DROP TABLE IF EXISTS match_rejections;
DROP TABLE IF EXISTS matching_queue;
DROP TABLE IF EXISTS platform_items;
DROP TABLE IF EXISTS ml_stock_locations;
DROP TABLE IF EXISTS ml_selling_conditions;
DROP TABLE IF EXISTS platform_variant_links;
DROP TABLE IF EXISTS platform_links;
`;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(UP_SQL);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(DOWN_SQL);
}
