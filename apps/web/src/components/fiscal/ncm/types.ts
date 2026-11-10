export interface NcmReviewer {
  id: string;
  name: string;
  email: string;
}

export interface NcmItem {
  id: string;
  productId: string;
  erpId: string | null;
  sku: string | null;
  productName: string | null;
  currentNcm: string | null;
  proposedNcm: string;
  sourcePlatform: string;
  status: string;
  firstReviewer: NcmReviewer | null;
  secondReviewer: NcmReviewer | null;
  tipiNote: string | null;
}

export interface NcmHistoryRow {
  id: string;
  master_product_id: string;
  previous_ncm: string | null;
  new_ncm: string | null;
  decision: string;
  tipi_note: string | null;
  createdAt: string;
  sku: string | null;
  productName: string | null;
  firstReviewerName: string | null;
  secondReviewerName: string | null;
}

export interface NcmMetrics {
  pendingFirst: number;
  pendingSecond: number;
  approved30d: number;
  rejected30d: number;
}

export function formatNcm(value: string | null): string {
  if (!value) return '—';
  const digits = value.replace(/\D/g, '');
  return digits.length === 8 ? `${digits.slice(0, 4)}.${digits.slice(4, 6)}.${digits.slice(6)}` : value;
}

export function tipiLookupUrl(ncm: string): string {
  const digits = ncm.replace(/\D/g, '');
  return `https://portalunico.siscomex.gov.br/classif/#/nomenclatura/${digits}`;
}

export function originLabel(platform: string): string {
  if (platform === 'mercadolivre') return 'Mercado Livre';
  if (platform === 'nuvemshop') return 'Nuvemshop';
  return platform;
}
