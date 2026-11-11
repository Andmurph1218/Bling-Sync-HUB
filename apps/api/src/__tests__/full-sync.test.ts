import { describe, expect, it } from 'vitest';
import { runFullCatalogSync } from '../catalog/full-sync.js';
import { BlingProductPayload } from '../connectors/bling/fixtures.js';
import { ErpConnector } from '../connectors/strategy/types.js';

function product(id: number, tipo: 'P' | 'S', extra: Record<string, unknown> = {}): BlingProductPayload {
  return {
    id,
    nome: `Produto ${id}`,
    codigo: `SKU-${id}`,
    preco: 10,
    tipo,
    situacao: 'A',
    formato: 'S',
    ...extra,
  } as BlingProductPayload;
}

describe('sync completo do ERP', () => {
  it('pagina em lote, ignora serviço e variação filha, e grava só o produto pai', async () => {
    const pages = [
      ['1', '2'],
      ['3'],
    ];
    const catalog = new Map<string, unknown>([
      ['1', product(1, 'S')],
      ['2', product(2, 'P', { variacao: { produtoPai: { id: 9 } } })],
      ['3', product(3, 'P')],
    ]);
    const listedPages: number[] = [];
    const upserted: string[] = [];
    const erp = {
      id: 'bling',
      syncProduct: async () => ({ found: false, productId: null, externalId: null, sku: null, name: null }),
      getStock: async () => ({ found: false, quantity: null }),
      getPrice: async () => ({ found: false, price: null }),
      listCatalogPage: async (page: number, pageSize: number) => {
        listedPages.push(page);
        const externalIds = pages[page - 1] ?? [];
        return { page, pageSize, externalIds, done: externalIds.length < pageSize };
      },
      pullCatalogProduct: async (externalId: string) => catalog.get(externalId) ?? null,
      fetchProductEnrichmentData: async () => ({ images: [], ncm: '', category: '' }),
      createProduct: async () => ({ erp_id: '0', stockWarning: null }),
    } as ErpConnector;

    const report = await runFullCatalogSync(erp, {
      pageSize: 2,
      upsertProduct: async (payload) => {
        upserted.push(payload.codigo);
        return { masterProductId: `id-${payload.id}`, variantIdsBySku: { [payload.codigo]: 'variant' } };
      },
      scoreProduct: async () => false,
    });

    expect(listedPages).toEqual([1, 2]);
    expect(upserted).toEqual(['SKU-3']);
    expect(report).toMatchObject({
      status: 'done',
      seen: 3,
      upserted: 1,
      variants: 1,
      skippedService: 1,
      skippedChild: 1,
      incomplete: 1,
      ready: 0,
      failed: 0,
    });
  });

  it('busca as variações de uma grade e não relê produto que já está no banco', async () => {
    const pulled: string[] = [];
    const erp = {
      id: 'bling',
      syncProduct: async () => ({ found: false, productId: null, externalId: null, sku: null, name: null }),
      getStock: async () => ({ found: false, quantity: null }),
      getPrice: async () => ({ found: false, price: null }),
      listCatalogPage: async (page: number, pageSize: number) => ({
        page,
        pageSize,
        externalIds: page === 1 ? ['10', '11'] : [],
        done: page > 1,
      }),
      pullCatalogProduct: async (externalId: string) => {
        pulled.push(externalId);
        if (externalId === '11') return product(11, 'P', { formato: 'V', variacoes: [] });
        return product(12, 'P', { codigo: 'SKU-12', nome: 'Cor:Azul', variacao: { nome: 'Cor:Azul', ordem: 1 } });
      },
      listChildIds: async () => ['12'],
      fetchProductEnrichmentData: async () => ({ images: [], ncm: '', category: '' }),
      createProduct: async () => ({ erp_id: '0', stockWarning: null }),
    } as ErpConnector;
    const saved: Array<{ codigo: string; variacoes: number }> = [];

    const report = await runFullCatalogSync(erp, {
      pageSize: 2,
      skipExisting: true,
      alreadyImported: async (externalId) => externalId === '10',
      upsertProduct: async (payload) => {
        saved.push({ codigo: payload.codigo, variacoes: payload.variacoes?.length ?? 0 });
        return { masterProductId: 'm', variantIdsBySku: { [payload.codigo]: 'v' } };
      },
      scoreProduct: async () => false,
    });

    expect(pulled).toEqual(['11', '12']);
    expect(saved).toEqual([{ codigo: 'SKU-11', variacoes: 1 }]);
    expect(report.skippedExisting).toBe(1);
    expect(report.upserted).toBe(1);
    expect(report.failed).toBe(0);
  });
});
