import { MERCADO_LIVRE_ACTIVE } from '../../config/channels.js';
import { query } from '../../db/pool.js';
import { createErpConnector, createMarketplaceConnector, DEFAULT_ERP_ID } from '../strategy/factory.js';

export interface ReadinessRequirement {
  code: string;
  label: string;
}

export interface ConnectorCommandResult {
  performed: boolean;
  reason: string;
}

export interface IConnector {
  readonly id: string;
  readonly kind: 'erp' | 'marketplace';
  getProducts(): Promise<{ source: string; items: unknown[] }>;
  updateStock(sku: string, quantity: number): Promise<ConnectorCommandResult>;
  publishProduct(input: { sku: string; mode: 'CREATE' | 'CONTENT' }): Promise<ConnectorCommandResult>;
  getReadinessRequirements(): ReadinessRequirement[];
}

const LIVE_OFF = 'escrita_ao_vivo_desligada';

const MARKETPLACE_REQUIREMENTS: ReadinessRequirement[] = [
  { code: 'sku', label: 'SKU preenchido no ERP' },
  { code: 'ncm', label: 'NCM válido no ERP' },
  { code: 'cover', label: 'Imagem de capa elegível' },
  { code: 'category', label: 'Categoria vinculada no HUB' },
  { code: 'ean', label: 'EAN aprovado quando o canal exige' },
];

/** ERP de origem. A publicação no marketplace não passa por aqui. */
export class RegisteredErpConnector implements IConnector {
  readonly id = DEFAULT_ERP_ID;
  readonly kind = 'erp' as const;

  public async getProducts(): Promise<{ source: string; items: unknown[] }> {
    return { source: 'bling', items: [] };
  }

  public async updateStock(): Promise<ConnectorCommandResult> {
    return { performed: false, reason: 'estoque_lido_do_bling' };
  }

  public async publishProduct(): Promise<ConnectorCommandResult> {
    return { performed: false, reason: 'o_bling_e_a_fonte' };
  }

  public getReadinessRequirements(): ReadinessRequirement[] {
    return [
      { code: 'sku', label: 'SKU preenchido' },
      { code: 'ncm', label: 'NCM válido' },
      { code: 'name', label: 'Nome do produto' },
    ];
  }
}

/** Primeiro marketplace ativo. A escrita real continua na fila, com a flag de publicação. */
export class NuvemshopConnector implements IConnector {
  readonly id = 'nuvemshop';
  readonly kind = 'marketplace' as const;

  public async getProducts(): Promise<{ source: string; items: unknown[] }> {
    return { source: 'nuvemshop', items: [] };
  }

  public async updateStock(): Promise<ConnectorCommandResult> {
    return { performed: false, reason: LIVE_OFF };
  }

  public async publishProduct(input: { sku: string; mode: 'CREATE' | 'CONTENT' }): Promise<ConnectorCommandResult> {
    return { performed: false, reason: `${LIVE_OFF}:${input.mode}` };
  }

  public getReadinessRequirements(): ReadinessRequirement[] {
    return MARKETPLACE_REQUIREMENTS;
  }
}

const ADAPTERS: Record<string, () => IConnector> = {
  [DEFAULT_ERP_ID]: () => new RegisteredErpConnector(),
  nuvemshop: () => new NuvemshopConnector(),
};

function isRegistered(provider: string): boolean {
  try {
    createErpConnector(provider);
    return true;
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith('erp_not_registered')) throw error;
  }
  try {
    createMarketplaceConnector(provider);
    return true;
  } catch {
    return false;
  }
}

export function instantiateConnector(provider: string, connected: boolean): IConnector | null {
  if (!connected || !isRegistered(provider)) return null;
  if (provider === 'mercadolivre' && !MERCADO_LIVRE_ACTIVE) return null;
  const adapter = ADAPTERS[provider];
  return adapter ? adapter() : null;
}

export class ConnectorFactory {
  /** Instancia só o conector cuja conta está autorizada. Canal desligado devolve null. */
  static async create(provider: string): Promise<IConnector | null> {
    if (provider === 'mercadolivre' && !MERCADO_LIVRE_ACTIVE) return null;
    const found = await query<{ provider: string }>(
      `SELECT provider FROM oauth_tokens WHERE provider = $1`,
      [provider]
    );
    return instantiateConnector(provider, Boolean(found.rows[0]));
  }
}
