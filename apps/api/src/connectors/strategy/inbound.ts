/** Cadastro já no formato que o HUB grava. O conector do ERP produz este formato. */
export interface InboundVariant {
  id: number | string;
  nome?: string;
  codigo: string;
  preco?: number;
  precoCusto?: number;
  tipo?: string;
  situacao?: string;
  formato?: string;
  gtin?: string;
  pesoLiquido?: number;
  pesoBruto?: number;
  dimensoes?: { largura?: number; altura?: number; profundidade?: number };
  tributacao?: { ncm?: string };
  variacao?: { nome?: string; ordem?: number; produtoPai?: { id: number } };
}

export interface InboundProduct {
  id: number | string;
  codigo: string;
  nome: string;
  preco: number;
  precoCusto?: number;
  tipo: string;
  situacao: string;
  formato: string;
  gtin?: string;
  pesoLiquido?: number;
  pesoBruto?: number;
  dimensoes?: InboundVariant['dimensoes'];
  tributacao?: InboundVariant['tributacao'];
  variacao?: InboundVariant['variacao'];
  variacoes?: InboundVariant[];
}

export interface InboundStockBalance {
  depositos: Array<{ id: number | string; saldoVirtual: number; saldoFisico?: number }>;
}
