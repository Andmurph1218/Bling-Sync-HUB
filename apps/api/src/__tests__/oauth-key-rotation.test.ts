import crypto from 'node:crypto';
import { newDb, DataType } from 'pg-mem';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decryptWithKey } from '../auth/oauth-key.js';
import { saveAppCredentials } from '../connectors/app-credentials.js';
import { OAuthTokenManager } from '../connectors/oauth-token-manager.js';
import { DbPoolLike, query, setPool } from '../db/pool.js';
import { runAllMigrationsUp } from '../db/migrator.js';
import { rotateOAuthEncryptionKey } from '../scripts/rotate-oauth-key.js';

/** `config/env` usa esta chave no Vitest; o teste cifra com ela e rotaciona para outra. */
const OLD_KEY = 'f'.repeat(64);
const NEW_KEY = 'ab'.repeat(32);
const EXPECTED_ROWS = 2;

describe('rotação da OAUTH_ENCRYPTION_KEY', () => {
  let poolInstance: DbPoolLike;

  beforeAll(async () => {
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
      implementation: (value: string) => (value ? value.trim() : ''),
    });
    mem.public.registerFunction({
      name: 'length',
      args: [DataType.text],
      returns: DataType.integer,
      implementation: (value: string) => (value ? value.length : 0),
    });
    const pgAdapter = mem.adapters.createPg();
    poolInstance = new pgAdapter.Pool() as unknown as DbPoolLike;
    setPool(poolInstance);
    await runAllMigrationsUp({ stripPartitionClauseForMemDb: true });
  });

  afterAll(async () => {
    if (poolInstance) await poolInstance.end();
    setPool(null);
  });

  async function seed(): Promise<void> {
    await query(`DELETE FROM oauth_tokens`);
    await query(`DELETE FROM channel_app_credentials`);
    await new OAuthTokenManager().upsertToken({
      provider: 'bling',
      accessToken: 'access-original',
      refreshToken: 'refresh-original',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    await saveAppCredentials({
      provider: 'nuvemshop',
      clientId: 'client-1',
      clientSecret: 'secret-original',
      webhookSecret: 'hook-original',
    });
  }

  async function readTokens() {
    const res = await query<{ provider: string; access_token_enc: Buffer | string; refresh_token_enc: Buffer | string | null }>(
      `SELECT provider, access_token_enc, refresh_token_enc FROM oauth_tokens`
    );
    return res.rows;
  }

  async function readCredentials() {
    const res = await query<{ provider: string; client_secret: string; webhook_secret: string | null }>(
      `SELECT provider, client_secret, webhook_secret FROM channel_app_credentials`
    );
    return res.rows;
  }

  it('dry-run valida a chave antiga e não grava nada', async () => {
    await seed();
    const before = await readTokens();

    const report = await rotateOAuthEncryptionKey({
      oldKey: OLD_KEY,
      newKey: NEW_KEY,
      execute: false,
      expect: EXPECTED_ROWS,
      lockRows: false,
    });

    expect(report).toMatchObject({ dryRun: true, oauthTokens: 1, appCredentials: 1, updated: 0 });
    expect(await readTokens()).toEqual(before);
    expect(decryptWithKey(OLD_KEY, before[0]!.access_token_enc)).toBe('access-original');
  });

  it('executa a rotação e a chave nova abre todos os segredos', async () => {
    await seed();

    const report = await rotateOAuthEncryptionKey({
      oldKey: OLD_KEY,
      newKey: NEW_KEY,
      execute: true,
      expect: EXPECTED_ROWS,
      lockRows: false,
    });

    expect(report).toMatchObject({ dryRun: false, updated: EXPECTED_ROWS });

    const tokens = await readTokens();
    expect(decryptWithKey(NEW_KEY, tokens[0]!.access_token_enc)).toBe('access-original');
    expect(decryptWithKey(NEW_KEY, tokens[0]!.refresh_token_enc!)).toBe('refresh-original');
    expect(() => decryptWithKey(OLD_KEY, tokens[0]!.access_token_enc)).toThrow();

    const credentials = await readCredentials();
    expect(decryptWithKey(NEW_KEY, credentials[0]!.client_secret)).toBe('secret-original');
    expect(decryptWithKey(NEW_KEY, credentials[0]!.webhook_secret!)).toBe('hook-original');
    expect(() => decryptWithKey(OLD_KEY, credentials[0]!.client_secret)).toThrow();
  });

  it('contagem diferente do esperado derruba a transação sem gravar', async () => {
    await seed();
    const before = await readTokens();

    await expect(
      rotateOAuthEncryptionKey({
        oldKey: OLD_KEY,
        newKey: NEW_KEY,
        execute: true,
        expect: 5,
        lockRows: false,
      })
    ).rejects.toThrow(/Esperava 5 registros e encontrei 2/);

    expect(await readTokens()).toEqual(before);
    expect(decryptWithKey(OLD_KEY, (await readTokens())[0]!.access_token_enc)).toBe('access-original');
  });

  it('chave antiga errada aborta antes de qualquer UPDATE', async () => {
    await seed();
    const before = await readTokens();

    await expect(
      rotateOAuthEncryptionKey({
        oldKey: 'c'.repeat(64),
        newKey: NEW_KEY,
        execute: true,
        expect: EXPECTED_ROWS,
        lockRows: false,
      })
    ).rejects.toThrow(/não abre nem com a chave antiga nem com a nova/);

    expect(await readTokens()).toEqual(before);
  });

  it('repetir a rotação com a chave antiga acusa que já foi feita', async () => {
    await seed();
    await rotateOAuthEncryptionKey({
      oldKey: OLD_KEY,
      newKey: NEW_KEY,
      execute: true,
      expect: EXPECTED_ROWS,
      lockRows: false,
    });

    await expect(
      rotateOAuthEncryptionKey({
        oldKey: OLD_KEY,
        newKey: NEW_KEY,
        execute: true,
        expect: EXPECTED_ROWS,
        lockRows: false,
      })
    ).rejects.toThrow(/já está cifrado com a chave nova/);
  });

  it('recusa chave nova igual à antiga', async () => {
    await expect(
      rotateOAuthEncryptionKey({ oldKey: OLD_KEY, newKey: OLD_KEY, execute: false, lockRows: false })
    ).rejects.toThrow(/igual à antiga/);
  });
});
