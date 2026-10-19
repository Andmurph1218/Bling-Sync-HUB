import crypto from 'node:crypto';
import path from 'node:path';
import dotenv from 'dotenv';
import { Router, Request, Response, NextFunction } from 'express';
import { query } from '../db/pool.js';
import { OAuthTokenManager } from '../connectors/oauth-token-manager.js';
import { sharedBlingRateLimiter } from '../connectors/bling-rate-limiter.js';

export const oauthRouter = Router();
const tokenManager = new OAuthTokenManager();

function getBlingCredentials(): { clientId: string; clientSecret: string } {
  dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: true });
  dotenv.config({ path: path.resolve(process.cwd(), '../../.env'), override: true });
  const clientId = (process.env.BLING_CLIENT_ID ?? '').trim();
  const clientSecret = (process.env.BLING_CLIENT_SECRET ?? '').trim();
  return { clientId, clientSecret };
}

export async function refreshBlingTokenViaHttp(
  currentRefreshToken: string
): Promise<{
  accessToken: string;
  refreshToken: string | null;
  expiresInSeconds: number;
}> {
  const { clientId, clientSecret } = getBlingCredentials();
  if (!clientId || !clientSecret) {
    throw new Error('BLING_CLIENT_ID e BLING_CLIENT_SECRET não configurados no .env');
  }

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64');
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: currentRefreshToken,
  });

  const response = await fetch('https://www.bling.com.br/Api/v3/oauth/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Falha ao renovar token OAuth do Bling (${response.status}): ${errText}`);
  }

  const json = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? currentRefreshToken,
    expiresInSeconds: json.expires_in ?? 21_600,
  };
}

/**
 * Busca automaticamente os depósitos (GET /depositos) e canais de venda/lojas (GET /canais-de-venda)
 * na API v3 do Bling usando o token salvo em oauth_tokens.
 */
export async function discoverBlingWarehousesAndStores(): Promise<{
  warehouses: Array<{
    id: string;
    descricao: string;
    situacao: number;
    padrao: boolean;
  }>;
  channels: Array<{
    id: string;
    descricao: string;
    tipo: string;
    situacao: number;
  }>;
}> {
  const accessToken = await tokenManager.getValidAccessToken(
    'bling',
    refreshBlingTokenViaHttp
  );

  const fetchBlingJson = async <T>(path: string): Promise<T> => {
    return sharedBlingRateLimiter.schedule('webhook_p1_push_stock', async () => {
      const res = await fetch(`https://api.bling.com.br/Api/v3${path}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Erro em GET ${path} (${res.status}): ${text}`);
      }
      return (await res.json()) as T;
    });
  };

  const depositosRes = await fetchBlingJson<{
    data?: Array<{
      id: number | string;
      descricao: string;
      situacao: number;
      padrao: boolean;
    }>;
  }>('/depositos');

  let canaisData: Array<{
    id: number | string;
    descricao: string;
    tipo: string;
    situacao: number;
  }> = [];

  try {
    const canaisRes = await fetchBlingJson<{
      data?: Array<{
        id: number | string;
        descricao: string;
        tipo: string;
        situacao: number;
      }>;
    }>('/canais-venda');
    canaisData = canaisRes.data ?? [];
  } catch {
    try {
      const lojasRes = await fetchBlingJson<{
        data?: Array<{
          id: number | string;
          loja?: { id: number | string };
        }>;
      }>('/produtos/lojas?limite=20');
      const uniqueLojas = new Set<string>();
      for (const item of lojasRes.data ?? []) {
        if (item.loja?.id) uniqueLojas.add(String(item.loja.id));
      }
      canaisData = Array.from(uniqueLojas).map((id) => ({
        id,
        descricao: `Loja Bling ${id}`,
        tipo: 'loja_virtual',
        situacao: 1,
      }));
    } catch {
      canaisData = [];
    }
  }

  const warehouses = (depositosRes.data ?? []).map((d) => ({
    id: String(d.id),
    descricao: d.descricao,
    situacao: d.situacao,
    padrao: Boolean(d.padrao),
  }));

  const channels = canaisData.map((c) => ({
    id: String(c.id),
    descricao: c.descricao,
    tipo: c.tipo,
    situacao: c.situacao,
  }));

  // Registra depósitos novos como 'unclassified' (include_in_push = false) até decisão do admin (Seção 9.1 / 10.8)
  for (const w of warehouses) {
    await query(
      `INSERT INTO stock_warehouses (bling_warehouse_id, name, role, include_in_push)
       VALUES ($1, $2, 'unclassified', false)
       ON CONFLICT (bling_warehouse_id) DO UPDATE
         SET name = EXCLUDED.name`,
      [w.id, w.descricao]
    );
  }

  return { warehouses, channels };
}

/**
 * 1. Inicia o fluxo OAuth 2.0 redirecionando o navegador para o Bling.
 */
oauthRouter.get('/oauth/bling/authorize', (_req: Request, res: Response) => {
  const { clientId } = getBlingCredentials();
  if (!clientId) {
    res.status(400).json({
      error: 'missing_bling_client_id',
      message:
        'Preencha BLING_CLIENT_ID e BLING_CLIENT_SECRET no arquivo .env antes de iniciar a autorização OAuth.',
    });
    return;
  }

  const state = crypto.randomBytes(16).toString('hex');
  const authorizeUrl = `https://www.bling.com.br/Api/v3/oauth/authorize?response_type=code&client_id=${encodeURIComponent(
    clientId
  )}&state=${state}`;

  res.redirect(authorizeUrl);
});

/**
 * 2. Callback OAuth 2.0 do Bling:
 * Troca o authorization_code pelo access_token e refresh_token, salva criptografado em oauth_tokens
 * e já executa a descoberta automática de depósitos (/depositos) e lojas (/canais-de-venda).
 */
oauthRouter.get(
  '/oauth/bling/callback',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const code = typeof req.query.code === 'string' ? req.query.code : null;
      if (!code) {
        res.status(400).json({ error: 'missing_authorization_code' });
        return;
      }

      const { clientId, clientSecret } = getBlingCredentials();
      if (!clientId || !clientSecret) {
        res.status(400).json({
          error: 'missing_bling_credentials',
          message: 'Configure BLING_CLIENT_ID e BLING_CLIENT_SECRET no .env',
        });
        return;
      }

      const basicAuth = Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString(
        'base64'
      );
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
      });

      const tokenRes = await fetch('https://www.bling.com.br/Api/v3/oauth/token', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basicAuth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: body.toString(),
      });

      if (!tokenRes.ok) {
        const errText = await tokenRes.text();
        res.status(502).json({
          error: 'bling_token_exchange_failed',
          status: tokenRes.status,
          details: errText,
        });
        return;
      }

      const tokenJson = (await tokenRes.json()) as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
      };

      const expiresAt = new Date(
        Date.now() + (tokenJson.expires_in ?? 21_600) * 1000
      );

      await tokenManager.upsertToken({
        provider: 'bling',
        accessToken: tokenJson.access_token,
        refreshToken: tokenJson.refresh_token ?? null,
        expiresAt,
      });

      const discovered = await discoverBlingWarehousesAndStores();

      res.status(200).json({
        status: 'bling_connected_and_discovered',
        tokenExpiresAt: expiresAt.toISOString(),
        discoveredWarehouses: discovered.warehouses,
        discoveredChannels: discovered.channels,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * 3. Endpoint para reexecutar a descoberta de depósitos e lojas a qualquer momento.
 */
oauthRouter.post(
  '/admin/bling/discover',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const discovered = await discoverBlingWarehousesAndStores();
      res.status(200).json({
        status: 'discovered',
        discoveredWarehouses: discovered.warehouses,
        discoveredChannels: discovered.channels,
      });
    } catch (error) {
      next(error);
    }
  }
);
