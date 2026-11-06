import type { MigrationBuilder } from 'node-pg-migrate';

export const UP_SQL = `
CREATE TABLE IF NOT EXISTS integration_catalog (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  slug          text NOT NULL UNIQUE,
  category      text NOT NULL CHECK (category IN ('Marketplace', 'ERP', 'Logística')),
  logo_url      text,
  is_installed  boolean NOT NULL DEFAULT false,
  is_available  boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS integration_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text NOT NULL,
  requested_by  uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

INSERT INTO integration_catalog (name, slug, category, is_available) VALUES
  ('Mercado Livre', 'mercadolivre', 'Marketplace', true),
  ('Nuvemshop', 'nuvemshop', 'Marketplace', true),
  ('Shopee', 'shopee', 'Marketplace', false),
  ('Amazon', 'amazon', 'Marketplace', false),
  ('TikTok Shop', 'tiktok', 'Marketplace', false),
  ('Bling ERP', 'bling', 'ERP', true),
  ('Omie', 'omie', 'ERP', false),
  ('Correios', 'correios', 'Logística', false),
  ('Melhor Envio', 'melhorenvio', 'Logística', false);
`;

export const DOWN_SQL = `
DROP TABLE IF EXISTS integration_requests;
DROP TABLE IF EXISTS integration_catalog;
`;

export const shorthands = {};

export function up(pgm: MigrationBuilder): void {
  pgm.sql(UP_SQL);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(DOWN_SQL);
}
