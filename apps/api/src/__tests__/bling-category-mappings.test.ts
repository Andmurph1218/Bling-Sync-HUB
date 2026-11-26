import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlingErpConnector, LiveBlingCatalogReader } from '../connectors/bling/bling-erp.js';
import { query } from '../db/pool.js';

vi.mock('../db/pool.js', () => ({ query: vi.fn() }));
const row = (id: number, store: number, category: number, code: string) => ({ id, loja: { id: store }, categoriaProduto: { id: category }, codigo: code, descricao: 'Categoria' });

class Reader extends LiveBlingCatalogReader {
  paths: string[] = [];
  constructor(private readonly pages: Array<{ status: number; data: unknown }>) { super(); }
  protected override async call<T>(_method: 'GET' | 'POST', path: string): Promise<{ status: number; data: T }> {
    this.paths.push(path);
    return this.pages.shift() as { status: number; data: T };
  }
}

afterEach(() => vi.resetAllMocks());
describe('Bling /categorias/lojas', () => {
  it('pagina, resolve loja.id pelo cadastro e usa codigo externo, nunca o id do vínculo', async () => {
    vi.mocked(query).mockResolvedValue({ rows: [{ platform: 'nuvemshop', bling_loja_id: '20' }, { platform: 'mercadolivre', bling_loja_id: '10' }] } as never);
    const reader = new Reader([
      { status: 200, data: { data: Array.from({ length: 100 }, (_, i) => row(i + 1, 10, i + 1, `MLB${i + 1}`)) } },
      { status: 200, data: { data: [row(777, 20, 901, '123456'), row(778, 999, 901, 'IGNORAR')] } },
    ]);
    const result = await new BlingErpConnector(reader).fetchCategoryMappings();
    expect(result).toHaveLength(101);
    expect(result.find((r) => r.channelId === 'nuvemshop')).toEqual({ erpCategoryId: '901', channelId: 'nuvemshop', channelCategoryId: '123456' });
    expect(result[0]).toEqual({ erpCategoryId: '1', channelId: 'mercadolivre', channelCategoryId: 'MLB1' });
    expect(reader.paths).toEqual(['/categorias/lojas?pagina=1&limite=100', '/categorias/lojas?pagina=2&limite=100']);
  });

  it('falha em vez de retornar a primeira página se a segunda falhar', async () => {
    vi.mocked(query).mockResolvedValue({ rows: [{ platform: 'nuvemshop', bling_loja_id: '20' }] } as never);
    const reader = new Reader([
      { status: 200, data: { data: Array.from({ length: 100 }, (_, i) => row(i + 1, 20, i + 1, String(i + 1))) } },
      { status: 503, data: { error: 'indisponível' } },
    ]);
    await expect(new BlingErpConnector(reader).fetchCategoryMappings()).rejects.toThrow('503');
  });

  it('não trata resposta malformada como snapshot vazio', async () => {
    vi.mocked(query).mockResolvedValue({ rows: [] } as never);
    await expect(new BlingErpConnector(new Reader([{ status: 200, data: {} }])).fetchCategoryMappings()).rejects.toThrow('invalid_category_page');
  });
});
