import { encryptOAuthToken, decryptOAuthToken } from '../auth/crypto.js';
import { getPublicBaseUrl } from '../config/public-url.js';
import { query } from '../db/pool.js';

const CALLBACK_PATH: Record<string, string> = {
  bling: '/oauth/bling/callback',
  mercadolivre: '/oauth/mercadolivre/callback',
  nuvemshop: '/oauth/nuvemshop/callback',
};

const ENV_SEED: Record<string, { id: string; secret: string; redirect?: string; webhook?: string }> = {
  bling: { id: 'BLING_CLIENT_ID', secret: 'BLING_CLIENT_SECRET', webhook: 'BLING_WEBHOOK_SECRET' },
  mercadolivre: { id: 'ML_CLIENT_ID', secret: 'ML_CLIENT_SECRET', redirect: 'ML_REDIRECT_URI', webhook: 'ML_WEBHOOK_SECRET' },
  nuvemshop: { id: 'NS_CLIENT_ID', secret: 'NS_CLIENT_SECRET', webhook: 'NS_WEBHOOK_SECRET' },
};

export interface StoredAppCredentials {
  provider: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  webhookSecret: string;
  isActive: boolean;
}

export interface PublicAppCredentials {
  provider: string;
  clientId: string;
  redirectUri: string;
  callbackUrl: string;
  hasClientSecret: boolean;
  hasWebhookSecret: boolean;
  isActive: boolean;
}

export function callbackUrlFor(provider: string): string {
  const base = (getPublicBaseUrl() ?? 'http://localhost:3001').replace(/\/$/, '');
  return `${base}${CALLBACK_PATH[provider] ?? `/oauth/${provider}/callback`}`;
}

function seal(value: string): string {
  return encryptOAuthToken(value).toString('utf8');
}

function open(value: string | null): string {
  if (!value) return '';
  return decryptOAuthToken(Buffer.from(value, 'utf8'));
}

async function seedFromEnvIfEmpty(provider: string): Promise<void> {
  if (process.env.VITEST) return;
  const spec = ENV_SEED[provider];
  if (!spec) return;
  const existing = await query(`SELECT 1 FROM channel_app_credentials WHERE provider = $1`, [provider]);
  if (existing.rows[0]) return;
  const clientId = (process.env[spec.id] ?? '').trim();
  const clientSecret = (process.env[spec.secret] ?? '').trim();
  if (!clientId || !clientSecret) return;
  const redirectUri = ((spec.redirect ? process.env[spec.redirect] : '') ?? '').trim() || callbackUrlFor(provider);
  const webhookSecret = ((spec.webhook ? process.env[spec.webhook] : '') ?? '').trim();
  await query(
    `INSERT INTO channel_app_credentials (
       provider, client_id, client_secret, redirect_uri, webhook_secret, is_active
     ) VALUES ($1, $2, $3, $4, $5, true)`,
    [provider, clientId, seal(clientSecret), redirectUri, webhookSecret ? seal(webhookSecret) : null]
  );
}

export async function loadAppCredentials(provider: string): Promise<StoredAppCredentials | null> {
  await seedFromEnvIfEmpty(provider);
  const found = await query<{
    client_id: string;
    client_secret: string;
    redirect_uri: string;
    webhook_secret: string | null;
    is_active: boolean;
  }>(
    `SELECT client_id, client_secret, redirect_uri, webhook_secret, is_active
     FROM channel_app_credentials
     WHERE provider = $1`,
    [provider]
  );
  const row = found.rows[0];
  if (!row || !row.is_active) return null;
  return {
    provider,
    clientId: row.client_id,
    clientSecret: open(row.client_secret),
    redirectUri: row.redirect_uri || callbackUrlFor(provider),
    webhookSecret: open(row.webhook_secret),
    isActive: row.is_active,
  };
}

export async function readPublicAppCredentials(provider: string): Promise<PublicAppCredentials> {
  const found = await query<{
    client_id: string;
    client_secret: string;
    redirect_uri: string;
    webhook_secret: string | null;
    is_active: boolean;
  }>(
    `SELECT client_id, client_secret, redirect_uri, webhook_secret, is_active
     FROM channel_app_credentials WHERE provider = $1`,
    [provider]
  );
  const row = found.rows[0];
  const callbackUrl = row?.redirect_uri || callbackUrlFor(provider);
  return {
    provider,
    clientId: row?.client_id ?? '',
    redirectUri: callbackUrl,
    callbackUrl,
    hasClientSecret: Boolean(row?.client_secret),
    hasWebhookSecret: Boolean(row?.webhook_secret),
    isActive: row?.is_active ?? false,
  };
}

export async function saveAppCredentials(input: {
  provider: string;
  clientId: string;
  clientSecret?: string;
  redirectUri?: string;
  webhookSecret?: string;
  isActive?: boolean;
}): Promise<PublicAppCredentials> {
  const current = await query<{ client_secret: string; webhook_secret: string | null }>(
    `SELECT client_secret, webhook_secret FROM channel_app_credentials WHERE provider = $1`,
    [input.provider]
  );
  const previous = current.rows[0];
  const clientSecret = input.clientSecret?.trim()
    ? seal(input.clientSecret.trim())
    : previous?.client_secret;
  if (!clientSecret) {
    throw new Error('client_secret_required');
  }
  const webhookSecret = input.webhookSecret === undefined
    ? previous?.webhook_secret ?? null
    : input.webhookSecret.trim()
      ? seal(input.webhookSecret.trim())
      : null;
  const redirectUri = input.redirectUri?.trim() || callbackUrlFor(input.provider);
  await query(
    `INSERT INTO channel_app_credentials (
       provider, client_id, client_secret, redirect_uri, webhook_secret, is_active
     ) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (provider) DO UPDATE
       SET client_id = EXCLUDED.client_id,
           client_secret = EXCLUDED.client_secret,
           redirect_uri = EXCLUDED.redirect_uri,
           webhook_secret = EXCLUDED.webhook_secret,
           is_active = EXCLUDED.is_active,
           updated_at = now()`,
    [
      input.provider,
      input.clientId.trim(),
      clientSecret,
      redirectUri,
      webhookSecret,
      input.isActive ?? true,
    ]
  );
  return readPublicAppCredentials(input.provider);
}
