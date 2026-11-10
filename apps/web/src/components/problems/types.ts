export type ProblemType = 'estoque' | 'preco' | 'anuncio' | 'cadastro';
export type ProblemSeverity = 'critico' | 'aviso' | 'erro';

export interface ProblemItem {
  id: string;
  productId: string | null;
  erpId: string | null;
  sku: string;
  name: string;
  message: string;
  occurredAt: string | null;
}

export interface ProblemGroup {
  key: string;
  type: ProblemType;
  severity: ProblemSeverity;
  source: 'completude' | 'publish_queue' | 'webhook_events';
  failureType: string;
  message: string;
  groupMessage: string;
  count: number;
  lastAt: string | null;
  action: 'reprocess' | 'erp' | 'fiscal';
  channel: string;
  single?: ProblemItem | null;
}

export interface ProblemSelection {
  groupKeys: string[];
  itemIds: string[];
}

export const ERP_SYNC_GROUP = 'gap:stock';

export function isErpSyncTarget(id: string): boolean {
  return id === ERP_SYNC_GROUP || id.startsWith(`${ERP_SYNC_GROUP}:`);
}
