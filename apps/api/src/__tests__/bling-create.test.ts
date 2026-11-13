import { describe, expect, it } from 'vitest';
import {
  BlingPostTimeoutError,
  LiveBlingCatalogReader,
  SkuAlreadyInBlingError,
  blingSkuAlreadyListed,
  runBlingCall,
} from '../connectors/bling/bling-erp.js';

class ScriptedReader extends LiveBlingCatalogReader {
  readonly calls: string[] = [];

  constructor(
    private readonly respond: (method: string, path: string) => { status: number; data: unknown }
  ) {
    super();
  }

  protected override async call<T>(method: 'GET' | 'POST', path: string): Promise<{ status: number; data: T }> {
    this.calls.push(`${method} ${path}`);
    return this.respond(method, path) as { status: number; data: T };
  }
}

const product = { name: 'Luminária', sku: 'SKU-1', price: 10, stock: 4 };

describe('criação de produto no Bling', () => {
  it('reconhece o SKU devolvido pelo filtro codigo', () => {
    expect(blingSkuAlreadyListed([{ codigo: 'sku-1' }], 'SKU-1')).toBe(true);
    expect(blingSkuAlreadyListed([{}], 'SKU-1')).toBe(true);
    expect(blingSkuAlreadyListed([{ codigo: 'OUTRO' }], 'SKU-1')).toBe(false);
    expect(blingSkuAlreadyListed([], 'SKU-1')).toBe(false);
  });

  it('cria só o cadastro e não lança estoque', async () => {
    const reader = new ScriptedReader((method, path) => {
      if (method === 'GET') return { status: 200, data: { data: [] } };
      if (path === '/produtos') return { status: 201, data: { data: { id: 42 } } };
      throw new Error(`chamada inesperada ${method} ${path}`);
    });
    await expect(reader.create(product)).resolves.toEqual({ erp_id: '42', stockWarning: null });
    expect(reader.calls).toEqual(['GET /produtos?codigo=SKU-1', 'POST /produtos']);
  });

  it('aborta antes do POST quando o SKU já existe no Bling', async () => {
    const reader = new ScriptedReader(() => ({ status: 200, data: { data: [{ id: 7, codigo: 'SKU-1' }] } }));
    await expect(reader.create(product)).rejects.toBeInstanceOf(SkuAlreadyInBlingError);
    expect(reader.calls).toEqual(['GET /produtos?codigo=SKU-1']);
  });

  it('não repete POST quando o Bling estoura o tempo', async () => {
    const none = async () => undefined;
    let posts = 0;
    await expect(runBlingCall('POST', async () => {
      posts += 1;
      throw new Error('bling_timeout');
    }, none)).rejects.toBeInstanceOf(BlingPostTimeoutError);
    expect(posts).toBe(1);

    let gets = 0;
    await expect(runBlingCall('GET', async () => {
      gets += 1;
      throw new Error('bling_timeout');
    }, none)).rejects.toThrow('bling_timeout');
    expect(gets).toBe(4);
  });

  it('filtra explicitamente produtos ativos (criterio=2) e repete GET em 5xx transitório', async () => {
    const reader = new ScriptedReader(() => ({ status: 200, data: { data: [{ id: 10 }], total: 1 } }));
    const page = await reader.list(1, 50);
    expect(reader.calls).toEqual(['GET /produtos?pagina=1&limite=50&tipo=P&criterio=2']);
    expect(page.externalIds).toEqual(['10']);

    const none = async () => undefined;
    let attempts = 0;
    const recovered = await runBlingCall<Record<string, unknown>>('GET', async () => {
      attempts += 1;
      if (attempts < 3) return { status: 503, data: { error: 'unavailable' } };
      return { status: 200, data: { ok: true } };
    }, none);
    expect(attempts).toBe(3);
    expect(recovered.status).toBe(200);
  });
});
