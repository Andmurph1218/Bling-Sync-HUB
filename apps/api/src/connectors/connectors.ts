/**
 * Conectores HTTP para Bling ERP v3, Mercado Livre (MLB) e Nuvemshop (Seções 8.8, 10.0, 10.7 e 10.8)
 */

import crypto from 'node:crypto';
import { query } from '../db/pool.js';
import { classifyApiHttpError } from '../contracts/mappers.js';
import {
  BlingCallerModule,
  BlingRateLimiter,
  sharedBlingRateLimiter,
} from './bling-rate-limiter.js';
import { OAuthRefreshFn, OAuthTokenManager } from './oauth-token-manager.js';

export interface HttpTransportRequest {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  headers: Record<string, string>;
  body?: unknown;
}

export interface HttpTransportResponse<T = unknown> {
  status: number;
  headers: Record<string, string | undefined>;
  data: T;
}

export type HttpTransport = <T = unknown>(
  req: HttpTransportRequest
) => Promise<HttpTransportResponse<T>>;

export interface BlingConnectorOptions {
  baseUrl?: string;
  limiter?: BlingRateLimiter;
  tokenManager: OAuthTokenManager;
  refreshFn: OAuthRefreshFn;
  transport: HttpTransport;
}

export class BlingConnector {
  private readonly baseUrl: string;
  private readonly limiter: BlingRateLimiter;
  private readonly tokenManager: OAuthTokenManager;
  private readonly refreshFn: OAuthRefreshFn;
  private readonly transport: HttpTransport;

  constructor(options: BlingConnectorOptions) {
    this.baseUrl = options.baseUrl ?? 'https://api.bling.com.br/Api/v3';
    this.limiter = options.limiter ?? sharedBlingRateLimiter;
    this.tokenManager = options.tokenManager;
    this.refreshFn = (refreshToken, provider) =>
      this.limiter.schedule('token', () => options.refreshFn(refreshToken, provider));
    this.transport = options.transport;
  }

  public async request<T = unknown>(
    callerModule: BlingCallerModule,
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown
  ): Promise<HttpTransportResponse<T>> {
    const accessToken = await this.tokenManager.getValidAccessToken(
      'bling',
      this.refreshFn
    );

    const executeOnce = async (token: string): Promise<HttpTransportResponse<T>> => {
      return this.limiter.schedule(callerModule, async () => {
        const res = await this.transport<T>({
          method,
          url: `${this.baseUrl}${path}`,
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
            ...(body ? { 'Content-Type': 'application/json' } : {}),
          },
          body,
        });

        if (res.status === 429) {
          const classified = classifyApiHttpError(res.status, res.headers);
          if (classified.retryAfterMs) {
            this.limiter.notifyRateLimitPenalty(classified.retryAfterMs);
          }
        }

        return res;
      });
    };

    const firstRes = await executeOnce(accessToken);
    if (firstRes.status !== 401) {
      return firstRes;
    }

    // 401 -> Renovação single-flight (sem disparar rajada) e 1 nova tentativa
    const newAccessToken = await this.tokenManager.getValidAccessToken(
      'bling',
      this.refreshFn,
      {
        forceRefresh: true,
        knownStaleAccessToken: accessToken,
      }
    );

    return executeOnce(newAccessToken);
  }

  /**
   * Aplica enriquecimento no Bling (apenas campos permitidos do Grupo B: marca, peso, dimensões)
   * e grava em hub_writes para evitar eco no WIG (Seção 4 e 8.5).
   */
  public async applyToBling(
    blingId: string,
    callerModule: BlingCallerModule,
    allowedFieldsPayload: {
      marca?: string;
      pesoLiquido?: number;
      pesoBruto?: number;
      dimensoes?: { largura: number; altura: number; profundidade: number };
    }
  ): Promise<{ requestId: string; status: number }> {
    const changedFields = Object.keys(allowedFieldsPayload);
    const requestId = crypto.randomUUID();

    await query(
      `INSERT INTO hub_writes (bling_id, request_id, changed_fields)
       VALUES ($1, $2, $3)`,
      [blingId, requestId, changedFields]
    );

    const res = await this.request(
      callerModule,
      'PATCH',
      `/produtos/${blingId}`,
      allowedFieldsPayload
    );

    return { requestId, status: res.status };
  }

  public async saveSyncCursor(jobName: string, cursorValue: string | null): Promise<void> {
    await query(
      `INSERT INTO sync_cursors (job_name, cursor_value, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (job_name) DO UPDATE
         SET cursor_value = EXCLUDED.cursor_value,
             updated_at = now()`,
      [jobName, cursorValue]
    );
  }
}

export interface MercadoLivreConnectorOptions {
  baseUrl?: string;
  tokenManager: OAuthTokenManager;
  refreshFn: OAuthRefreshFn;
  transport: HttpTransport;
}

export class MercadoLivreConnector {
  private readonly baseUrl: string;
  private readonly tokenManager: OAuthTokenManager;
  private readonly refreshFn: OAuthRefreshFn;
  private readonly transport: HttpTransport;

  constructor(options: MercadoLivreConnectorOptions) {
    this.baseUrl = options.baseUrl ?? 'https://api.mercadolibre.com';
    this.tokenManager = options.tokenManager;
    this.refreshFn = options.refreshFn;
    this.transport = options.transport;
  }

  public async getUserProductStock(userProductId: string): Promise<{
    stockVersion: number;
    locations: Array<{
      type: 'meli_facility' | 'seller_warehouse' | 'selling_address';
      quantity: number;
      store_id?: string;
      network_node_id?: string;
    }>;
  }> {
    const token = await this.tokenManager.getValidAccessToken(
      'mercadolivre',
      this.refreshFn
    );
    const res = await this.transport<{
      id: string;
      locations: Array<{
        type: 'meli_facility' | 'seller_warehouse' | 'selling_address';
        quantity: number;
        store_id?: string;
        network_node_id?: string;
      }>;
    }>({
      method: 'GET',
      url: `${this.baseUrl}/user-products/${userProductId}/stock`,
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const rawVersion = res.headers['x-version'] ?? res.headers['X-Version'] ?? '1';
    return {
      stockVersion: Number(rawVersion),
      locations: res.data.locations,
    };
  }

  /**
   * Atualiza estoque do User Product no Mercado Livre (Seção 10.8):
   * - Se o produto tiver apenas meli_facility, retorna skipped (motivo ml_full) sem fazer PUT.
   * - Escreve exclusivamente em /user-products/{id}/stock/type/seller_warehouse com X-Version.
   * - Se responder 409 Conflict, relê o x-version na hora e tenta de novo exatamente 1 vez.
   */
  public async updateSellerWarehouseStock(
    userProductId: string,
    floorQuantity: number
  ): Promise<
    | { outcome: 'skipped'; reason: 'ml_full' }
    | { outcome: 'updated'; usedVersion: number; retriedOn409: boolean }
  > {
    const initialStock = await this.getUserProductStock(userProductId);
    const sellerLocations = initialStock.locations.filter(
      (l) => l.type === 'seller_warehouse'
    );
    const hasMeliFacility = initialStock.locations.some(
      (l) => l.type === 'meli_facility'
    );

    if (sellerLocations.length === 0 && hasMeliFacility) {
      return { outcome: 'skipped', reason: 'ml_full' };
    }

    const token = await this.tokenManager.getValidAccessToken(
      'mercadolivre',
      this.refreshFn
    );

    const putWithVersion = async (version: number) => {
      return this.transport({
        method: 'PUT',
        url: `${this.baseUrl}/user-products/${userProductId}/stock/type/seller_warehouse`,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Version': String(version),
        },
        body: {
          locations: sellerLocations.map((loc) => ({
            type: 'seller_warehouse',
            store_id: loc.store_id,
            network_node_id: loc.network_node_id,
            quantity: Math.max(0, Math.floor(floorQuantity)),
          })),
        },
      });
    };

    const firstAttempt = await putWithVersion(initialStock.stockVersion);
    if (firstAttempt.status !== 409) {
      return {
        outcome: 'updated',
        usedVersion: initialStock.stockVersion,
        retriedOn409: false,
      };
    }

    // 409 no PUT de estoque relê o x-version e tenta de novo uma vez (Seção 10.8)
    const refreshedStock = await this.getUserProductStock(userProductId);
    const secondAttempt = await putWithVersion(refreshedStock.stockVersion);
    if (secondAttempt.status >= 400) {
      throw new Error(
        `Falha ao atualizar estoque seller_warehouse de ${userProductId} após retry 409 (status ${secondAttempt.status})`
      );
    }

    return {
      outcome: 'updated',
      usedVersion: refreshedStock.stockVersion,
      retriedOn409: true,
    };
  }
}

export interface NuvemshopConnectorOptions {
  baseUrl?: string;
  storeId: string;
  userAgent?: string;
  tokenManager: OAuthTokenManager;
  transport: HttpTransport;
}

export class NuvemshopConnector {
  private readonly baseUrl: string;
  private readonly storeId: string;
  private readonly userAgent: string;
  private readonly tokenManager: OAuthTokenManager;
  private readonly transport: HttpTransport;

  constructor(options: NuvemshopConnectorOptions) {
    this.baseUrl = options.baseUrl ?? 'https://api.tiendanube.com/v1';
    this.storeId = options.storeId;
    this.userAgent = options.userAgent ?? 'BlingSyncHub/0.1 (suporte@blingsync.local)';
    this.tokenManager = options.tokenManager;
    this.transport = options.transport;
  }

  private async getHeaders(): Promise<Record<string, string>> {
    const token = await this.tokenManager.getToken('nuvemshop');
    if (!token) {
      throw new Error('Credencial OAuth ausente para nuvemshop');
    }
    return {
      Authentication: `bearer ${token.accessToken}`,
      'User-Agent': this.userAgent,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Passo measures da Nuvemshop (Seção 8.8):
   * Usa PATCH /products/{id}/variants enviando APENAS id, weight, width, height e depth.
   * Nunca envia price, promotional_price nem stock, e nunca usa PUT /products/{id}/variants.
   */
  public async patchVariantMeasures(
    productId: string,
    measures: {
      id: number;
      weight?: string;
      width?: string;
      height?: string;
      depth?: string;
    }
  ): Promise<HttpTransportResponse> {
    const headers = await this.getHeaders();
    const cleanBody: Record<string, unknown> = { id: measures.id };
    if (measures.weight !== undefined) cleanBody.weight = measures.weight;
    if (measures.width !== undefined) cleanBody.width = measures.width;
    if (measures.height !== undefined) cleanBody.height = measures.height;
    if (measures.depth !== undefined) cleanBody.depth = measures.depth;

    return this.transport({
      method: 'PATCH',
      url: `${this.baseUrl}/${this.storeId}/products/${productId}/variants`,
      headers,
      body: [cleanBody],
    });
  }
}
