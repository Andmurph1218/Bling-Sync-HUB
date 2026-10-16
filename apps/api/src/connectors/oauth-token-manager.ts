/**
 * Gerenciador de Credenciais OAuth (Seções 5, 9.1 e 10.0 do Plano Mestre)
 *
 * Regras travadas:
 * - Token OAuth fica em oauth_tokens (PostgreSQL), criptografado com AES-256-GCM (bytea).
 * - Redis não guarda credencial OAuth.
 * - A renovação trava a linha com SELECT ... FOR UPDATE.
 * - Se a resposta trouxer outro refresh token, os dois valores novos são gravados na mesma transação.
 * - Renovação é single-flight: uma renovação por vez por provider; chamadas concorrentes aguardam a mesma promessa.
 * - A Nuvemshop usa a mesma tabela com refresh_token_enc nulo.
 */

import { PoolClient } from 'pg';
import { decryptOAuthToken, encryptOAuthToken } from '../auth/crypto.js';
import { query, withTransaction } from '../db/pool.js';

export type OAuthProvider = 'bling' | 'mercadolivre' | 'nuvemshop';

export interface StoredOAuthToken {
  provider: OAuthProvider;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
  rotatedAt: Date | null;
  updatedAt: Date;
}

export interface OAuthRefreshResponse {
  accessToken: string;
  refreshToken?: string | null;
  expiresInSeconds: number;
}

export type OAuthRefreshFn = (
  currentRefreshToken: string,
  provider: OAuthProvider
) => Promise<OAuthRefreshResponse>;

function toBuffer(val: Buffer | Uint8Array | string): Buffer {
  if (Buffer.isBuffer(val)) return val;
  if (val instanceof Uint8Array) return Buffer.from(val);
  if (typeof val === 'string' && val.startsWith('\\x')) {
    return Buffer.from(val.slice(2), 'hex');
  }
  return Buffer.from(val, 'utf8');
}

export class OAuthTokenManager {
  private readonly inFlightRefreshes = new Map<OAuthProvider, Promise<StoredOAuthToken>>();
  private readonly expiryBufferMs: number;

  constructor(options?: { expiryBufferMs?: number }) {
    this.expiryBufferMs = options?.expiryBufferMs ?? 60_000;
  }

  public async upsertToken(input: {
    provider: OAuthProvider;
    accessToken: string;
    refreshToken: string | null;
    expiresAt: Date;
  }): Promise<StoredOAuthToken> {
    const accessEnc = encryptOAuthToken(input.accessToken);
    const refreshEnc = input.refreshToken ? encryptOAuthToken(input.refreshToken) : null;
    const nowIso = new Date().toISOString();

    await query(
      `INSERT INTO oauth_tokens (provider, access_token_enc, refresh_token_enc, expires_at, rotated_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $5)
       ON CONFLICT (provider) DO UPDATE
         SET access_token_enc = EXCLUDED.access_token_enc,
             refresh_token_enc = EXCLUDED.refresh_token_enc,
             expires_at = EXCLUDED.expires_at,
             rotated_at = EXCLUDED.rotated_at,
             updated_at = EXCLUDED.updated_at`,
      [input.provider, accessEnc, refreshEnc, input.expiresAt.toISOString(), nowIso]
    );

    const loaded = await this.getToken(input.provider);
    if (!loaded) {
      throw new Error(`Falha ao ler token recém-gravado para ${input.provider}`);
    }
    return loaded;
  }

  public async getToken(
    provider: OAuthProvider,
    client?: PoolClient
  ): Promise<StoredOAuthToken | null> {
    const sql = `
      SELECT provider, access_token_enc, refresh_token_enc, expires_at, rotated_at, updated_at
      FROM oauth_tokens
      WHERE provider = $1
    `;
    const res = client
      ? await client.query<{
          provider: OAuthProvider;
          access_token_enc: Buffer | Uint8Array | string;
          refresh_token_enc: Buffer | Uint8Array | string | null;
          expires_at: Date | string;
          rotated_at: Date | string | null;
          updated_at: Date | string;
        }>(sql, [provider])
      : await query<{
          provider: OAuthProvider;
          access_token_enc: Buffer | Uint8Array | string;
          refresh_token_enc: Buffer | Uint8Array | string | null;
          expires_at: Date | string;
          rotated_at: Date | string | null;
          updated_at: Date | string;
        }>(sql, [provider]);

    const row = res.rows[0];
    if (!row) return null;

    const accessToken = decryptOAuthToken(toBuffer(row.access_token_enc));
    const refreshToken = row.refresh_token_enc
      ? decryptOAuthToken(toBuffer(row.refresh_token_enc))
      : null;

    return {
      provider: row.provider,
      accessToken,
      refreshToken,
      expiresAt: row.expires_at instanceof Date ? row.expires_at : new Date(row.expires_at),
      rotatedAt: row.rotated_at
        ? row.rotated_at instanceof Date
          ? row.rotated_at
          : new Date(row.rotated_at)
        : null,
      updatedAt: row.updated_at instanceof Date ? row.updated_at : new Date(row.updated_at),
    };
  }

  /**
   * Retorna um access token válido. Se estiver expirado (ou dentro do buffer de expiração)
   * ou se forceRefresh = true (ex: após HTTP 401), executa o refresh em single-flight.
   */
  public async getValidAccessToken(
    provider: OAuthProvider,
    refreshFn: OAuthRefreshFn,
    options?: { forceRefresh?: boolean; knownStaleAccessToken?: string }
  ): Promise<string> {
    if (!options?.forceRefresh) {
      const current = await this.getToken(provider);
      if (!current) {
        throw new Error(`Credencial OAuth ausente para o provider ${provider}`);
      }
      if (provider === 'nuvemshop') {
        return current.accessToken;
      }
      if (current.expiresAt.getTime() - Date.now() > this.expiryBufferMs) {
        return current.accessToken;
      }
    }

    const refreshed = await this.refreshSingleFlight(
      provider,
      refreshFn,
      options?.knownStaleAccessToken
    );
    return refreshed.accessToken;
  }

  /**
   * Renovação Single-Flight:
   * 1. No mesmo processo: compartilha a mesma Promise em inFlightRefreshes.
   * 2. No banco (entre réplicas): trava a linha de oauth_tokens com SELECT ... FOR UPDATE.
   *    Se outra réplica já tiver renovado o token (accessToken diferente do stale ou expires_at já no futuro),
   *    reaproveita o novo valor sem chamar /oauth/token novamente.
   */
  public refreshSingleFlight(
    provider: OAuthProvider,
    refreshFn: OAuthRefreshFn,
    knownStaleAccessToken?: string
  ): Promise<StoredOAuthToken> {
    const existingPromise = this.inFlightRefreshes.get(provider);
    if (existingPromise) {
      return existingPromise;
    }

    const refreshPromise = this.executeLockedRefresh(
      provider,
      refreshFn,
      knownStaleAccessToken
    ).finally(() => {
      this.inFlightRefreshes.delete(provider);
    });

    this.inFlightRefreshes.set(provider, refreshPromise);
    return refreshPromise;
  }

  private async executeLockedRefresh(
    provider: OAuthProvider,
    refreshFn: OAuthRefreshFn,
    knownStaleAccessToken?: string
  ): Promise<StoredOAuthToken> {
    return withTransaction(async (client: PoolClient) => {
      const res = await client.query<{
        provider: OAuthProvider;
        access_token_enc: Buffer | Uint8Array | string;
        refresh_token_enc: Buffer | Uint8Array | string | null;
        expires_at: Date | string;
        rotated_at: Date | string | null;
        updated_at: Date | string;
      }>(
        `SELECT provider, access_token_enc, refresh_token_enc, expires_at, rotated_at, updated_at
         FROM oauth_tokens
         WHERE provider = $1
         FOR UPDATE`,
        [provider]
      );

      const row = res.rows[0];
      if (!row) {
        throw new Error(`Credencial OAuth não encontrada para ${provider}`);
      }

      const currentAccess = decryptOAuthToken(toBuffer(row.access_token_enc));
      const currentRefresh = row.refresh_token_enc
        ? decryptOAuthToken(toBuffer(row.refresh_token_enc))
        : null;
      const currentExpiresAt =
        row.expires_at instanceof Date ? row.expires_at : new Date(row.expires_at);

      // Se outra réplica já renovou enquanto aguardávamos o lock FOR UPDATE, não chama /oauth/token de novo
      if (
        knownStaleAccessToken &&
        currentAccess !== knownStaleAccessToken &&
        currentExpiresAt.getTime() - Date.now() > this.expiryBufferMs
      ) {
        return {
          provider,
          accessToken: currentAccess,
          refreshToken: currentRefresh,
          expiresAt: currentExpiresAt,
          rotatedAt: row.rotated_at ? new Date(row.rotated_at) : null,
          updatedAt: new Date(row.updated_at),
        };
      }

      if (!currentRefresh) {
        throw new Error(`Refresh token ausente para ${provider}`);
      }

      const refreshed = await refreshFn(currentRefresh, provider);
      const nextRefreshToken =
        refreshed.refreshToken && refreshed.refreshToken.length > 0
          ? refreshed.refreshToken
          : currentRefresh;

      const newAccessEnc = encryptOAuthToken(refreshed.accessToken);
      const newRefreshEnc = encryptOAuthToken(nextRefreshToken);
      const newExpiresAt = new Date(Date.now() + refreshed.expiresInSeconds * 1000);
      const now = new Date();

      await client.query(
        `UPDATE oauth_tokens
         SET access_token_enc = $2,
             refresh_token_enc = $3,
             expires_at = $4,
             rotated_at = $5,
             updated_at = $5
         WHERE provider = $1`,
        [
          provider,
          newAccessEnc,
          newRefreshEnc,
          newExpiresAt.toISOString(),
          now.toISOString(),
        ]
      );

      return {
        provider,
        accessToken: refreshed.accessToken,
        refreshToken: nextRefreshToken,
        expiresAt: newExpiresAt,
        rotatedAt: now,
        updatedAt: now,
      };
    });
  }
}
