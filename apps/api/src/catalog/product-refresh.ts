import { query } from '../db/pool.js';
import { activeErpConnector } from '../connectors/strategy/factory.js';
import { InboundStockBalance } from '../connectors/strategy/inbound.js';
import { runFullProductCatalogPipeline } from '../orchestrator/pipeline.js';
import { asProduct, hydrateVariations, imageCandidates, stockBySku, stockForBatch } from './full-sync.js';

/**
 * Busca UM produto no ERP e atualiza o espelho local: cadastro, variações,
 * saldos por depósito, NCM/EAN sugeridos, imagens na fila do IQRE e as notas do
 * CRE. Não é Full Sync: o custo é 1 requisição para o produto e 1 por variação
 * filha (quando o pai não traz a grade), tudo passando pelo rate limit global.
 */

export class ProductNotInErpError extends Error {
  constructor(readonly erpId: string) {
    super(`O ERP não devolveu o produto ${erpId}. Confira se ele existe e está ativo.`);
    this.name = 'ProductNotInErpError';
  }
}

export class ErpProductUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErpProductUnavailableError';
  }
}

export interface ProductRefreshResult {
  masterProductId: string;
  erpId: string;
  /** Divergências que o operador precisa saber (ex.: NCM do ERP diferente do aprovado no HUB). */
  notes: string[];
}

export async function refreshProductFromErp(erpId: string): Promise<ProductRefreshResult> {
  const erp = activeErpConnector();
  let raw: unknown;
  try {
    raw = await erp.pullCatalogProduct(erpId);
  } catch (error) {
    throw new ErpProductUnavailableError(error instanceof Error ? error.message : String(error));
  }

  const payload = asProduct(raw);
  if (!payload) throw new ProductNotInErpError(erpId);
  if (payload.tipo !== 'P') {
    throw new ErpProductUnavailableError('O ERP devolveu um registro que não é produto (tipo diferente de P).');
  }

  try {
    await hydrateVariations(erp, payload);
  } catch (error) {
    throw new ErpProductUnavailableError(error instanceof Error ? error.message : String(error));
  }

  let balances = new Map<string, InboundStockBalance>();
  try {
    balances = await stockForBatch(erp, [payload]);
  } catch {
    // Saldo é complemento: sem ele o cadastro e o NCM ainda atualizam.
    balances = new Map();
  }

  try {
    const report = await runFullProductCatalogPipeline({
      inboundPayload: payload,
      stockBalancesBySku: stockBySku(payload, balances),
      imagesToEnqueue: imageCandidates(payload),
    });
    const notes: string[] = [];
    const stored = await query<{ ncm: string | null }>(
      `SELECT ncm FROM master_products WHERE id = $1`,
      [report.masterProductId]
    );
    const erpNcm = (payload.tributacao?.ncm ?? '').replace(/\D/g, '').slice(0, 8);
    const hubNcm = (stored.rows[0]?.ncm ?? '').replace(/\D/g, '');
    if (erpNcm && hubNcm && erpNcm !== hubNcm) {
      notes.push(
        `O Bling está com NCM ${erpNcm} e o HUB mantém ${hubNcm} até nova aprovação fiscal.`
      );
    }
    return { masterProductId: report.masterProductId, erpId, notes };
  } catch (error) {
    throw new ErpProductUnavailableError(error instanceof Error ? error.message : String(error));
  }
}

/** Produto do HUB pelo uuid ou pelo id externo do ERP. */
export async function findProductForRefresh(idOrErpId: string): Promise<{ id: string; erp_id: string } | null> {
  const found = await query<{ id: string; erp_id: string }>(
    `SELECT id, erp_id FROM master_products WHERE erp_id = $1 OR id::text = $1 LIMIT 1`,
    [idOrErpId]
  );
  return found.rows[0] ?? null;
}
