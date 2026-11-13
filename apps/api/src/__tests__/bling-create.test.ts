import { describe, expect, it } from 'vitest';
import {
  BlingErpConnector,
  BlingPostTimeoutError,
  LiveBlingCatalogReader,
  SkuAlreadyInBlingError,
  blingJitteredBackoffMs,
  blingRetryDelayMs,
  blingCommerceFromPayload,
  blingSkuAlreadyListed,
  runBlingCall,
} from '../connectors/bling/bling-erp.js';
import { activeErpId } from '../connectors/strategy/factory.js';

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
  it('traduz preço e SKU do Bling para o contrato neutro', () => {
    const previous = process.env.ACTIVE_ERP;
    delete process.env.ACTIVE_ERP;
    expect(activeErpId()).toBe('bling');
    process.env.ACTIVE_ERP = 'outro';
    expect(activeErpId()).toBe('outro');
    if (previous === undefined) delete process.env.ACTIVE_ERP;
    else process.env.ACTIVE_ERP = previous;

    expect(blingCommerceFromPayload({
      id: 'erp-atl',
      codigo: 'ATL-368',
      preco: '180,00',
      formato: 'S',
    }, [{
      externalId: 'erp-atl',
      raw: { produto: { id: 'erp-atl' } },
    }])).toMatchObject({
      externalId: 'erp-atl',
      sku: 'ATL-368',
      lines: [{ externalId: 'erp-atl', sku: 'ATL-368', price: 180 }],
    });
  });

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

  it('guarda o id do Bling quando o SKU já existe', async () => {
    const reader = new ScriptedReader(() => ({ status: 200, data: { data: [{ id: 555001, codigo: 'SKU-1' }] } }));
    await expect(reader.create(product)).rejects.toMatchObject({ name: 'SkuAlreadyInBlingError', erpId: '555001' });
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

  it('filtra explicitamente produtos ativos (criterio=2)', async () => {
    const reader = new ScriptedReader(() => ({ status: 200, data: { data: [{ id: 10 }], total: 1 } }));
    const page = await reader.list(1, 50);
    expect(reader.calls).toEqual(['GET /produtos?pagina=1&limite=50&tipo=P&criterio=2']);
    expect(page.externalIds).toEqual(['10']);
  });

  it('respeita Retry-After, repete 5xx no GET e não repete 5xx no POST', async () => {
    expect(blingRetryDelayMs(0, 429, { 'retry-after': '2' })).toBe(2000);
    expect(blingRetryDelayMs(0, 503, {})).toBe(1000);
    expect(blingRetryDelayMs(1, 503, {})).toBe(2000);
    expect(blingRetryDelayMs(2, 500, {})).toBe(4000);
    expect(blingRetryDelayMs(0, 404, { 'retry-after': '9' })).toBeNull();

    const waits: number[] = [];
    let gets = 0;
    const recovered = await runBlingCall('GET', async () => {
      gets += 1;
      if (gets === 1) return { status: 503, data: null, headers: {} };
      if (gets === 2) return { status: 429, data: null, headers: { 'retry-after': '3' } };
      return { status: 200, data: { ok: true } };
    }, async (ms) => {
      waits.push(ms);
    });
    expect(recovered).toEqual({ status: 200, data: { ok: true } });
    expect(waits).toEqual([1000, 3000]);

    let posts = 0;
    const rejected = await runBlingCall('POST', async () => {
      posts += 1;
      return { status: 500, data: null, headers: { 'retry-after': '1' } };
    }, async () => undefined);
    expect(posts).toBe(1);
    expect(rejected.status).toBe(500);
  });

  it('não consulta estoque ao puxar o cadastro do produto', async () => {
    const calls: string[] = [];
    const connector = new BlingErpConnector({
      list: async () => {
        throw new Error('lista não entra nesta leitura');
      },
      pull: async () => {
        calls.push('pull');
        return { id: 1, nome: 'Luminária' };
      },
      stock: async () => {
        calls.push('stock');
        return [];
      },
      children: async () => [],
      create: async () => {
        throw new Error('criação não entra nesta leitura');
      },
    });
    await expect(connector.pullCatalogProduct('1')).resolves.toEqual({ id: 1, nome: 'Luminária' });
    expect(calls).toEqual(['pull']);
  });

  it('usa backoff exponencial com jitter quando 429 não traz Retry-After e notifica penalidade global', async () => {
    expect(blingJitteredBackoffMs(0, () => 0)).toBe(1000);
    expect(blingJitteredBackoffMs(0, () => 0.5)).toBeGreaterThan(1000);
    expect(blingJitteredBackoffMs(1, () => 0.5)).toBeGreaterThan(2000);

    const penalties: number[] = [];
    const waits: number[] = [];
    let calls = 0;
    const res = await runBlingCall(
      'GET',
      async () => {
        calls += 1;
        if (calls === 1) return { status: 429, data: null, headers: {} };
        if (calls === 2) return { status: 429, data: null, headers: { 'retry-after': '2' } };
        return { status: 200, data: { ok: true }, headers: {} };
      },
      async (ms) => {
        waits.push(ms);
      },
      {
        maxAttempts: 5,
        random: () => 0.5,
        onRateLimit: (ms) => {
          penalties.push(ms);
        },
      }
    );
    expect(res.status).toBe(200);
    expect(waits[0]).toBeGreaterThan(1000);
    expect(waits[1]).toBe(2000);
    expect(penalties).toEqual(waits);
  });
});
