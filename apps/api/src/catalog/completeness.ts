import { isBlankSku } from './blank-sku.js';

export const NO_SELLER_WAREHOUSE_MESSAGE =
  'Nenhum depósito de venda classificado. Vá em Canais > Depósitos e classifique';

export const EXISTING_LISTING_MESSAGE =
  'Já existe anúncio neste canal. A ação Criar está bloqueada; use Atualizar.';

export type CatalogChannel = 'mercadolivre' | 'nuvemshop';

export interface ChecklistInput {
  erpId: string;
  sku: string | null;
  hasCoverImage: boolean;
  hubCategoryId: string | null;
  mappedPlatforms: CatalogChannel[];
  greenPlatforms: CatalogChannel[];
  eanStatus: string | null;
  eanRequired: boolean;
  ncmStatus: string;
  ncmFiscalRisk: boolean;
  price: number | null;
  hasDuplicateCandidate: boolean;
  /** Informado só no checklist de envio: sem depósito seller o estoque publicável não existe. */
  hasSellerWarehouse?: boolean;
  /**
   * Informado no checklist de envio. null = nenhum anúncio, a ação é Criar.
   * Um id bloqueia Criar e pede Atualizar.
   */
  existingListingId?: string | null;
  /** Quando informado, o semáforo vale só para estes canais. */
  channels?: CatalogChannel[];
}

export interface ChecklistItem {
  code: string;
  ok: boolean;
  blocks: boolean;
  title: string;
  fixHref: string;
}

export interface ChecklistResult {
  percent: number;
  ready: boolean;
  tone: 'green' | 'amber' | 'red';
  items: ChecklistItem[];
}

const ACTIVE_CHANNELS: CatalogChannel[] = ['mercadolivre', 'nuvemshop'];

function hasAll(platforms: CatalogChannel[], required: CatalogChannel[]): boolean {
  return required.every((platform) => platforms.includes(platform));
}

export function evaluateCatalogChecklist(input: ChecklistInput): ChecklistResult {
  const required = input.channels?.length ? input.channels : ACTIVE_CHANNELS;
  const ficha = `/catalogo/${encodeURIComponent(input.erpId)}`;
  const items: ChecklistItem[] = [
    {
      code: 'sku',
      ok: !isBlankSku(input.sku),
      blocks: true,
      title: isBlankSku(input.sku)
        ? 'Sem SKU — não sincroniza'
        : 'SKU preenchido',
      fixHref: `${ficha}?aba=geral`,
    },
    {
      code: 'cover',
      ok: input.hasCoverImage,
      blocks: true,
      title: input.hasCoverImage ? 'Imagem de capa elegível' : 'Falta imagem de capa elegível',
      fixHref: `${ficha}?aba=imagens`,
    },
    {
      code: 'hub_category',
      ok: Boolean(input.hubCategoryId),
      blocks: true,
      title: input.hubCategoryId ? 'Categoria do catálogo definida' : 'Sem categoria',
      fixHref: `${ficha}?aba=geral`,
    },
    {
      code: 'channel_category',
      ok: hasAll(input.greenPlatforms, required),
      blocks: true,
      title: hasAll(input.greenPlatforms, required)
        ? 'Categoria do canal mapeada'
        : 'Categoria do canal ainda não está verde',
      fixHref: '/atributos',
    },
    {
      code: 'attributes',
      ok: hasAll(input.mappedPlatforms, required) && hasAll(input.greenPlatforms, required),
      blocks: true,
      title:
        hasAll(input.mappedPlatforms, required) && hasAll(input.greenPlatforms, required)
          ? 'Atributos obrigatórios resolvidos'
          : 'Atributos obrigatórios do canal ainda não resolvidos',
      fixHref: '/atributos',
    },
    {
      code: 'ean',
      ok: !input.eanRequired || input.eanStatus === 'valid',
      blocks: true,
      title:
        !input.eanRequired || input.eanStatus === 'valid'
          ? 'Código de barras ok para o canal'
          : 'Código de barras ausente ou inválido para este canal',
      fixHref: '/fiscal/ean',
    },
    {
      code: input.ncmStatus === 'pending_approval' ? 'ncm_approval' : 'ncm',
      ok: input.ncmStatus === 'valid' && !input.ncmFiscalRisk,
      blocks: true,
      title:
        input.ncmStatus === 'conflict'
          ? 'NCM em conflito entre variações'
          : input.ncmStatus === 'pending_approval'
            ? 'NCM importado aguardando aprovação do fiscal'
            : input.ncmStatus === 'valid' && !input.ncmFiscalRisk
              ? 'NCM válido'
              : 'NCM ausente ou inválido',
      fixHref: '/fiscal/ncm',
    },
    {
      code: 'price',
      ok: input.price !== null && input.price > 0,
      blocks: true,
      title: input.price !== null && input.price > 0 ? 'Preço maior que zero' : 'Preço ausente ou zero',
      fixHref: `${ficha}?aba=geral`,
    },
    {
      code: 'duplicate',
      ok: !input.hasDuplicateCandidate,
      blocks: true,
      title: input.hasDuplicateCandidate
        ? 'Possível duplicata por SKU ou EAN — vincule em vez de criar'
        : 'Sem duplicata conhecida',
      fixHref: '/vinculos',
    },
  ];
  if (input.hasSellerWarehouse !== undefined) {
    items.push({
      code: 'seller_warehouse',
      ok: input.hasSellerWarehouse,
      blocks: true,
      title: input.hasSellerWarehouse ? 'Depósito de venda classificado' : NO_SELLER_WAREHOUSE_MESSAGE,
      fixHref: '/canais/depositos',
    });
  }
  if (input.existingListingId !== undefined) {
    const linked = Boolean(input.existingListingId);
    items.push({
      code: 'channel_listing',
      ok: !linked,
      blocks: true,
      title: linked ? EXISTING_LISTING_MESSAGE : 'Nenhum anúncio neste canal. A ação é Criar.',
      fixHref: '/vinculos',
    });
  }

  const okCount = items.filter((item) => item.ok).length;
  const percent = Math.round((okCount / items.length) * 100);
  const ready = items.every((item) => item.ok);
  const tone = ready ? 'green' : percent >= 50 ? 'amber' : 'red';
  return { percent, ready, tone, items };
}
