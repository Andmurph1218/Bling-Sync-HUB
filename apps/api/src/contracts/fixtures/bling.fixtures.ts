/**
 * Fixtures sanitizados oficiais da API Bling v3 (Seção 11 do Plano Mestre)
 */

export interface BlingComponentPayload {
  produto: { id: number };
  quantidade: number;
}

export interface BlingEstruturaPayload {
  tipoEstoque: 'F' | 'V';
  lancamentoEstoque?: 'A' | 'M' | 'P';
  componentes: BlingComponentPayload[];
}

export interface BlingTributacaoPayload {
  ncm?: string;
  cest?: string;
  origem?: number;
}

export interface BlingDimensoesPayload {
  largura?: number;
  altura?: number;
  profundidade?: number;
  unidadeMedida?: number;
}

export interface BlingVariacaoPayload {
  id: number;
  nome: string;
  codigo: string;
  preco: number;
  precoCusto?: number;
  tipo: 'P' | 'S' | 'N';
  situacao: 'A' | 'I' | 'E';
  formato: 'S' | 'E';
  gtin?: string;
  pesoLiquido?: number;
  pesoBruto?: number;
  dimensoes?: BlingDimensoesPayload;
  estoque?: { saldoVirtualTotal?: number };
  tributacao?: BlingTributacaoPayload;
  variacao: {
    nome: string;
    ordem: number;
    produtoPai?: { id: number; cloneInfo?: boolean };
  };
  estrutura?: BlingEstruturaPayload;
}

export interface BlingProductPayload {
  id: number;
  nome: string;
  codigo: string;
  preco: number;
  precoCusto?: number;
  tipo: 'P' | 'S' | 'N';
  situacao: 'A' | 'I' | 'E';
  formato: 'S' | 'V' | 'E';
  descricaoCurta?: string;
  descricaoComplementar?: string;
  unidade?: string;
  pesoLiquido?: number;
  pesoBruto?: number;
  gtin?: string;
  gtinEmbalagem?: string;
  marca?: string;
  categoria?: { id: number; descricao?: string };
  estoque?: { saldoVirtualTotal?: number };
  dimensoes?: BlingDimensoesPayload;
  tributacao?: BlingTributacaoPayload;
  estrutura?: BlingEstruturaPayload;
  variacoes?: BlingVariacaoPayload[];
}

/** 1. Produto simples (formato S) */
export const BLING_SIMPLE_PRODUCT_FIXTURE: { data: BlingProductPayload } = {
  data: {
    id: 100101,
    nome: 'Garrafa Térmica Inox 500ml Preta',
    codigo: 'GAR-INOX-500-PT',
    preco: 89.9,
    precoCusto: 42.5,
    tipo: 'P',
    situacao: 'A',
    formato: 'S',
    descricaoCurta: 'Garrafa térmica em aço inox 304 parede dupla 500ml.',
    descricaoComplementar:
      'Conserva líquidos gelados por 24h e quentes por 12h. Livre de BPA.',
    unidade: 'UN',
    pesoLiquido: 0.31,
    pesoBruto: 0.36,
    gtin: '7891234567895',
    marca: 'ThermoHub',
    categoria: { id: 901, descricao: 'Utilidades Domésticas' },
    // O saldoVirtualTotal do payload de produto NUNCA deve ser copiado para product_variants.stock
    estoque: { saldoVirtualTotal: 999 },
    dimensoes: {
      largura: 7.5,
      altura: 24.0,
      profundidade: 7.5,
      unidadeMedida: 1,
    },
    tributacao: {
      ncm: '9617.00.10',
      cest: '20.047.00',
      origem: 0,
    },
  },
};

/** 2. Produto com variação (formato V) */
export const BLING_VARIABLE_PRODUCT_FIXTURE: { data: BlingProductPayload } = {
  data: {
    id: 200200,
    nome: 'Camiseta Dry Fit Performance',
    codigo: 'CAM-DRY-PAI',
    preco: 79.9,
    precoCusto: 35.0,
    tipo: 'P',
    situacao: 'A',
    formato: 'V',
    unidade: 'UN',
    marca: 'MoveFit',
    tributacao: {
      ncm: '6109.90.00',
      origem: 0,
    },
    variacoes: [
      {
        id: 200201,
        nome: 'Camiseta Dry Fit Performance - Cor:Azul;Tamanho:M',
        codigo: 'CAM-DRY-AZ-M',
        preco: 79.9,
        precoCusto: 35.0,
        tipo: 'P',
        situacao: 'A',
        formato: 'S',
        gtin: '7891000100011',
        pesoLiquido: 0.18,
        pesoBruto: 0.2,
        dimensoes: { largura: 25, altura: 3, profundidade: 30 },
        estoque: { saldoVirtualTotal: 50 },
        tributacao: { ncm: '6109.90.00', origem: 0 },
        variacao: {
          nome: 'Cor:Azul;Tamanho:M',
          ordem: 1,
          produtoPai: { id: 200200, cloneInfo: true },
        },
      },
      {
        id: 200202,
        nome: 'Camiseta Dry Fit Performance - Cor:Preto;Tamanho:G',
        codigo: 'CAM-DRY-PT-G',
        preco: 84.9,
        precoCusto: 36.5,
        tipo: 'P',
        situacao: 'A',
        formato: 'S',
        gtin: '7891000100028',
        pesoLiquido: 0.19,
        pesoBruto: 0.21,
        dimensoes: { largura: 26, altura: 3, profundidade: 32 },
        estoque: { saldoVirtualTotal: 30 },
        tributacao: { ncm: '6109.90.00', origem: 0 },
        variacao: {
          nome: 'Cor:Preto;Tamanho:G',
          ordem: 2,
          produtoPai: { id: 200200, cloneInfo: true },
        },
      },
    ],
  },
};

/** 3. Kit (formato E) com estoque virtual e dois componentes */
export const BLING_KIT_PRODUCT_FIXTURE: { data: BlingProductPayload } = {
  data: {
    id: 300300,
    nome: 'Kit 2 Garrafas Térmicas + Escova de Limpeza',
    codigo: 'KIT-GAR2-ESC1',
    preco: 179.9,
    precoCusto: 88.0,
    tipo: 'P',
    situacao: 'A',
    formato: 'E',
    unidade: 'KIT',
    pesoLiquido: 0.68,
    pesoBruto: 0.78,
    gtin: '7892000300012',
    marca: 'ThermoHub',
    dimensoes: { largura: 16, altura: 25, profundidade: 9 },
    tributacao: {
      ncm: '9617.00.10',
      origem: 0,
    },
    estrutura: {
      tipoEstoque: 'V',
      lancamentoEstoque: 'A',
      componentes: [
        { produto: { id: 100101 }, quantidade: 2 },
        { produto: { id: 100199 }, quantidade: 1 },
      ],
    },
  },
};

/** 4. Variação de grade que também é composição (pai formato V, variação formato E) */
export const BLING_VARIABLE_KIT_PRODUCT_FIXTURE: { data: BlingProductPayload } = {
  data: {
    id: 400400,
    nome: 'Halter Emborrachado Kit ou Unidade',
    codigo: 'HAL-EMB-PAI',
    preco: 120.0,
    tipo: 'P',
    situacao: 'A',
    formato: 'V',
    unidade: 'UN',
    marca: 'IronPulse',
    tributacao: { ncm: '9506.91.00', origem: 0 },
    variacoes: [
      {
        id: 400401,
        nome: 'Halter Emborrachado - Peso:5kg;Apresentacao:Unidade',
        codigo: 'HAL-EMB-5KG-UN',
        preco: 120.0,
        precoCusto: 60.0,
        tipo: 'P',
        situacao: 'A',
        formato: 'S',
        pesoLiquido: 5.0,
        pesoBruto: 5.2,
        variacao: {
          nome: 'Peso:5kg;Apresentacao:Unidade',
          ordem: 1,
          produtoPai: { id: 400400 },
        },
      },
      {
        id: 400402,
        nome: 'Halter Emborrachado - Peso:5kg;Apresentacao:Par',
        codigo: 'HAL-EMB-5KG-PAR',
        preco: 229.0,
        precoCusto: 120.0,
        tipo: 'P',
        situacao: 'A',
        formato: 'E',
        pesoLiquido: 10.0,
        pesoBruto: 10.4,
        variacao: {
          nome: 'Peso:5kg;Apresentacao:Par',
          ordem: 2,
          produtoPai: { id: 400400 },
        },
        estrutura: {
          tipoEstoque: 'V',
          componentes: [{ produto: { id: 400401 }, quantidade: 2 }],
        },
      },
    ],
  },
};

export interface BlingStockBalanceItem {
  produto: { id: number };
  saldoFisicoTotal: number;
  saldoVirtualTotal: number;
  depositos: Array<{
    id: number;
    saldoFisico: number;
    saldoVirtual: number;
  }>;
}

/** 5. Saldos de dois depósitos seller, com um deles fora de include_in_push */
export const BLING_STOCK_BALANCES_TWO_SELLERS_FIXTURE: { data: BlingStockBalanceItem[] } = {
  data: [
    {
      produto: { id: 100101 },
      saldoFisicoTotal: 35,
      saldoVirtualTotal: 32,
      depositos: [
        // DEP-SELLER-MAIN (role = seller, include_in_push = true) -> entra (12.8 -> floor = 12)
        { id: 9001, saldoFisico: 15, saldoVirtual: 12.8 },
        // DEP-SELLER-SHOWROOM (role = seller, include_in_push = false) -> fica de fora
        { id: 9002, saldoFisico: 20, saldoVirtual: 19.2 },
      ],
    },
  ],
};

/** 6. Depósito ml_full com saldo que não entra na soma publicada */
export const BLING_STOCK_BALANCES_WITH_ML_FULL_FIXTURE: { data: BlingStockBalanceItem[] } = {
  data: [
    {
      produto: { id: 100101 },
      saldoFisicoTotal: 112,
      saldoVirtualTotal: 112,
      depositos: [
        // DEP-SELLER-MAIN (role = seller, include_in_push = true) -> entra (7)
        { id: 9001, saldoFisico: 8, saldoVirtual: 7 },
        // DEP-ML-FULL (role = ml_full, include_in_push = false) -> NUNCA entra na soma
        { id: 9099, saldoFisico: 105, saldoVirtual: 105 },
      ],
    },
  ],
};

export interface BlingProductStoreLinkPayload {
  id: number;
  codigo: string;
  preco: number;
  precoPromocional: number;
  produto: { id: number };
  loja: { id: number };
}

/** 7. Vínculo GET /produtos/lojas com preço e preço promocional */
export const BLING_STORE_PRICE_LINK_FIXTURE: { data: BlingProductStoreLinkPayload[] } = {
  data: [
    {
      id: 77001,
      codigo: 'GAR-INOX-500-PT',
      preco: 99.9,
      precoPromocional: 94.9,
      produto: { id: 100101 },
      loja: { id: 204501 },
    },
  ],
};

export interface BlingWebhookEnvelope<T = Record<string, unknown>> {
  eventId: string;
  date: string;
  version: string;
  event: 'product.created' | 'product.updated' | 'product.deleted' | 'stock.updated' | 'virtual_stock.updated';
  companyId: string;
  data: T;
}

/** 14a. Webhook stock */
export const BLING_WEBHOOK_STOCK_FIXTURE: BlingWebhookEnvelope<{
  produto: { id: number; codigo: string };
  deposito: { id: number };
  operacao: 'E' | 'S' | 'B';
  saldoFisicoTotal: number;
  saldoVirtualTotal: number;
}> = {
  eventId: 'evt-stock-001',
  date: '2026-10-16T12:00:00Z',
  version: 'v1',
  event: 'stock.updated',
  companyId: 'bling-company-01',
  data: {
    produto: { id: 100101, codigo: 'GAR-INOX-500-PT' },
    deposito: { id: 9001 },
    operacao: 'S',
    saldoFisicoTotal: 14,
    saldoVirtualTotal: 11,
  },
};

/** 14b. Webhook virtual_stock com vinculoComplexo = true */
export const BLING_WEBHOOK_VIRTUAL_STOCK_COMPLEX_FIXTURE: BlingWebhookEnvelope<{
  produto: { id: number; codigo: string };
  saldoVirtualTotal: number;
  vinculoComplexo: boolean;
}> = {
  eventId: 'evt-vstock-complex-002',
  date: '2026-10-16T12:01:00Z',
  version: 'v1',
  event: 'virtual_stock.updated',
  companyId: 'bling-company-01',
  data: {
    produto: { id: 300300, codigo: 'KIT-GAR2-ESC1' },
    saldoVirtualTotal: 5,
    vinculoComplexo: true,
  },
};

/** 15. product.updated com situacao I */
export const BLING_WEBHOOK_PRODUCT_UPDATED_INACTIVE_FIXTURE: BlingWebhookEnvelope<{
  id: number;
  codigo: string;
  nome: string;
  situacao: 'A' | 'I' | 'E';
  tipo: 'P' | 'S' | 'N';
}> = {
  eventId: 'evt-prod-inactive-003',
  date: '2026-10-16T12:05:00Z',
  version: 'v1',
  event: 'product.updated',
  companyId: 'bling-company-01',
  data: {
    id: 100101,
    codigo: 'GAR-INOX-500-PT',
    nome: 'Garrafa Térmica Inox 500ml Preta',
    situacao: 'I',
    tipo: 'P',
  },
};

/** 16. product.updated com situacao E */
export const BLING_WEBHOOK_PRODUCT_UPDATED_EXCLUDED_FIXTURE: BlingWebhookEnvelope<{
  id: number;
  codigo: string;
  nome: string;
  situacao: 'A' | 'I' | 'E';
  tipo: 'P' | 'S' | 'N';
}> = {
  eventId: 'evt-prod-excluded-004',
  date: '2026-10-16T12:06:00Z',
  version: 'v1',
  event: 'product.updated',
  companyId: 'bling-company-01',
  data: {
    id: 100101,
    codigo: 'GAR-INOX-500-PT',
    nome: 'Garrafa Térmica Inox 500ml Preta',
    situacao: 'E',
    tipo: 'P',
  },
};

/** 17 & 18. product.deleted (seguido de GET 404 ou GET 200) */
export const BLING_WEBHOOK_PRODUCT_DELETED_FIXTURE: BlingWebhookEnvelope<{
  id: number;
}> = {
  eventId: 'evt-prod-deleted-005',
  date: '2026-10-16T12:10:00Z',
  version: 'v1',
  event: 'product.deleted',
  companyId: 'bling-company-01',
  data: {
    id: 100101,
  },
};

export const BLING_GET_PRODUCT_404_RESPONSE_FIXTURE = {
  status: 404 as const,
  body: {
    error: {
      type: 'RESOURCE_NOT_FOUND',
      message: 'Não foi possível localizar o produto.',
      description: 'O recurso solicitado não foi encontrado.',
    },
  },
};

export const BLING_GET_PRODUCT_200_RESPONSE_FIXTURE = {
  status: 200 as const,
  body: BLING_SIMPLE_PRODUCT_FIXTURE,
};

/** 19. Resposta 429 do Bling v3 */
export const BLING_RATE_LIMIT_429_FIXTURE = {
  status: 429 as const,
  headers: {
    'retry-after': '2',
  },
  body: {
    error: {
      type: 'TOO_MANY_REQUESTS',
      message: 'Limite de requisições atingido.',
      description: 'O limite de 3 requisições por segundo foi excedido.',
    },
  },
};
