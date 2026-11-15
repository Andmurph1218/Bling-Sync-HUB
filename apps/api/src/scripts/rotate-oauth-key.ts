import { PoolClient } from 'pg';
import { assertOAuthKey, decryptWithKey, encryptWithKey } from '../auth/oauth-key.js';

/**
 * Rotaciona a OAUTH_ENCRYPTION_KEY: descriptografa cada segredo com a chave antiga
 * e regrava com a nova, tudo numa transação. Qualquer erro, contagem diferente do
 * esperado ou falha na conferência pós-gravação derruba a transação inteira.
 *
 * Uso:
 *   OAUTH_ENCRYPTION_KEY_OLD=... OAUTH_ENCRYPTION_KEY_NEW=... npm run rotate:oauth-key -- --dry-run
 *   OAUTH_ENCRYPTION_KEY_OLD=... OAUTH_ENCRYPTION_KEY_NEW=... npm run rotate:oauth-key -- --execute
 *
 * Opções: --expect=N (default 5) e --no-lock (sem FOR UPDATE; só para pg-mem nos testes).
 * Pare a API antes do --execute: um refresh de token com a chave antiga em memória
 * gravaria um segredo que a chave nova não abre.
 */

export const DEFAULT_EXPECTED_ROWS = 5;

export interface RotationOptions {
  oldKey: string;
  newKey: string;
  execute: boolean;
  expect?: number;
  lockRows?: boolean;
  log?: (line: string) => void;
}

export interface RotationReport {
  dryRun: boolean;
  oauthTokens: number;
  appCredentials: number;
  updated: number;
  expected: number;
}

interface OAuthRow {
  provider: string;
  access_token_enc: Buffer | string;
  refresh_token_enc: Buffer | string | null;
}

interface CredentialRow {
  provider: string;
  client_secret: string;
  webhook_secret: string | null;
}

function toBuffer(value: Buffer | string): Buffer {
  return Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
}

/** Lê com a antiga e devolve o novo envelope. Se a antiga não abre, a nova precisa abrir. */
function reencrypt(oldKey: string, newKey: string, payload: Buffer | string, label: string): Buffer {
  let plain: string;
  try {
    plain = decryptWithKey(oldKey, payload);
  } catch {
    try {
      decryptWithKey(newKey, payload);
    } catch {
      throw new Error(`${label}: não abre nem com a chave antiga nem com a nova. Rotação abortada.`);
    }
    throw new Error(`${label}: já está cifrado com a chave nova. Rode o dry-run antes de misturar chaves.`);
  }
  return encryptWithKey(newKey, plain);
}

export async function rotateOAuthEncryptionKey(options: RotationOptions): Promise<RotationReport> {
  const oldKey = assertOAuthKey(options.oldKey, 'OAUTH_ENCRYPTION_KEY_OLD');
  const newKey = assertOAuthKey(options.newKey, 'OAUTH_ENCRYPTION_KEY_NEW');
  if (oldKey.toLowerCase() === newKey.toLowerCase()) {
    throw new Error('A chave nova é igual à antiga. Nada a rotacionar.');
  }
  const expected = options.expect ?? DEFAULT_EXPECTED_ROWS;
  const lock = options.lockRows === false ? '' : ' FOR UPDATE';
  const log = options.log ?? (() => undefined);

  const { getPool } = await import('../db/pool.js');
  const client: PoolClient = await getPool().connect();

  try {
    await client.query('BEGIN');

    const tokens = await client.query<OAuthRow>(
      `SELECT provider, access_token_enc, refresh_token_enc FROM oauth_tokens ORDER BY provider${lock}`
    );
    const credentials = await client.query<CredentialRow>(
      `SELECT provider, client_secret, webhook_secret FROM channel_app_credentials ORDER BY provider${lock}`
    );

    const total = tokens.rows.length + credentials.rows.length;
    log(`Registros encontrados: ${tokens.rows.length} em oauth_tokens, ${credentials.rows.length} em channel_app_credentials.`);
    if (total !== expected) {
      throw new Error(`Esperava ${expected} registros e encontrei ${total}. Nada foi gravado.`);
    }

    // 1) Valida a chave antiga em todos os registros antes de tocar em qualquer linha.
    const plannedTokens = tokens.rows.map((row) => ({
      row,
      access: reencrypt(oldKey, newKey, toBuffer(row.access_token_enc), `oauth_tokens/${row.provider}.access`),
      refresh: row.refresh_token_enc
        ? reencrypt(oldKey, newKey, toBuffer(row.refresh_token_enc), `oauth_tokens/${row.provider}.refresh`)
        : null,
    }));
    const plannedCredentials = credentials.rows.map((row) => ({
      row,
      clientSecret: reencrypt(oldKey, newKey, row.client_secret, `channel_app_credentials/${row.provider}.client_secret`),
      webhookSecret: row.webhook_secret
        ? reencrypt(oldKey, newKey, row.webhook_secret, `channel_app_credentials/${row.provider}.webhook_secret`)
        : null,
    }));
    log(`${total} registros prontos para rotação.`);

    if (!options.execute) {
      await client.query('ROLLBACK');
      return { dryRun: true, oauthTokens: tokens.rows.length, appCredentials: credentials.rows.length, updated: 0, expected };
    }

    let updated = 0;
    for (const plan of plannedTokens) {
      const res = await client.query(
        `UPDATE oauth_tokens SET access_token_enc = $2, refresh_token_enc = $3 WHERE provider = $1`,
        [plan.row.provider, plan.access, plan.refresh]
      );
      updated += res.rowCount ?? 0;
    }
    for (const plan of plannedCredentials) {
      const res = await client.query(
        `UPDATE channel_app_credentials SET client_secret = $2, webhook_secret = $3 WHERE provider = $1`,
        [plan.row.provider, plan.clientSecret.toString('utf8'), plan.webhookSecret?.toString('utf8') ?? null]
      );
      updated += res.rowCount ?? 0;
    }

    if (updated !== expected) {
      throw new Error(`Atualizei ${updated} registros, esperava ${expected}. Nada foi gravado.`);
    }

    // 2) Confere na própria transação: cada valor gravado tem de abrir com a chave nova.
    const verifyTokens = await client.query<OAuthRow>(
      `SELECT provider, access_token_enc, refresh_token_enc FROM oauth_tokens ORDER BY provider`
    );
    const verifyCredentials = await client.query<CredentialRow>(
      `SELECT provider, client_secret, webhook_secret FROM channel_app_credentials ORDER BY provider`
    );
    for (const row of verifyTokens.rows) {
      const original = plannedTokens.find((plan) => plan.row.provider === row.provider);
      if (!original) throw new Error(`oauth_tokens/${row.provider}: linha desapareceu durante a rotação.`);
      const expectedAccess = decryptWithKey(oldKey, toBuffer(original.row.access_token_enc));
      if (decryptWithKey(newKey, toBuffer(row.access_token_enc)) !== expectedAccess) {
        throw new Error(`oauth_tokens/${row.provider}.access: conferência falhou. Nada foi gravado.`);
      }
      if (original.row.refresh_token_enc) {
        const expectedRefresh = decryptWithKey(oldKey, toBuffer(original.row.refresh_token_enc));
        if (!row.refresh_token_enc || decryptWithKey(newKey, toBuffer(row.refresh_token_enc)) !== expectedRefresh) {
          throw new Error(`oauth_tokens/${row.provider}.refresh: conferência falhou. Nada foi gravado.`);
        }
      }
    }
    for (const row of verifyCredentials.rows) {
      const original = plannedCredentials.find((plan) => plan.row.provider === row.provider);
      if (!original) throw new Error(`channel_app_credentials/${row.provider}: linha desapareceu durante a rotação.`);
      const expectedSecret = decryptWithKey(oldKey, original.row.client_secret);
      if (decryptWithKey(newKey, row.client_secret) !== expectedSecret) {
        throw new Error(`channel_app_credentials/${row.provider}.client_secret: conferência falhou. Nada foi gravado.`);
      }
      if (original.row.webhook_secret) {
        const expectedHook = decryptWithKey(oldKey, original.row.webhook_secret);
        if (!row.webhook_secret || decryptWithKey(newKey, row.webhook_secret) !== expectedHook) {
          throw new Error(`channel_app_credentials/${row.provider}.webhook_secret: conferência falhou. Nada foi gravado.`);
        }
      }
    }

    await client.query('COMMIT');
    log(`Rotação concluída: ${updated} registros regravados e conferidos com a chave nova.`);
    return { dryRun: false, oauthTokens: tokens.rows.length, appCredentials: credentials.rows.length, updated, expected };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function parseArgs(argv: string[]): { execute: boolean; expect: number; lockRows: boolean } {
  const execute = argv.includes('--execute');
  if (execute && argv.includes('--dry-run')) throw new Error('Use --dry-run ou --execute, não os dois.');
  const expectArg = argv.find((arg) => arg.startsWith('--expect='));
  const expect = expectArg ? Number(expectArg.split('=')[1]) : DEFAULT_EXPECTED_ROWS;
  if (!Number.isInteger(expect) || expect <= 0) throw new Error('--expect precisa ser um inteiro positivo.');
  return { execute, expect, lockRows: !argv.includes('--no-lock') };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const oldKey = (process.env.OAUTH_ENCRYPTION_KEY_OLD ?? '').trim();
  const newKey = (process.env.OAUTH_ENCRYPTION_KEY_NEW ?? '').trim();
  if (!oldKey || !newKey) {
    throw new Error('Defina OAUTH_ENCRYPTION_KEY_OLD e OAUTH_ENCRYPTION_KEY_NEW no ambiente.');
  }
  // `config/env` exige a chave vigente para montar o pool; a rotação usa as duas explicitamente.
  process.env.OAUTH_ENCRYPTION_KEY = process.env.OAUTH_ENCRYPTION_KEY ?? newKey;

  const report = await rotateOAuthEncryptionKey({
    oldKey,
    newKey,
    execute: args.execute,
    expect: args.expect,
    lockRows: args.lockRows,
    log: (line) => console.log(line),
  });

  if (report.dryRun) {
    console.log('Dry-run: nada foi gravado. Rode de novo com --execute.');
    return;
  }
  console.log('Agora troque OAUTH_ENCRYPTION_KEY no .env pela chave nova, remova OLD/NEW e reinicie a API.');
}

if (process.argv[1] && /rotate-oauth-key\.(ts|js)$/.test(process.argv[1])) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
