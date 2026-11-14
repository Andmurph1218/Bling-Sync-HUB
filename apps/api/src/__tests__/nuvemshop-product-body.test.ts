import { describe, expect, it } from 'vitest';
import { buildNuvemshopProductBody, NuvemshopPublishError } from '../connectors/strategy/nuvemshop-publish.js';
import { ListingDraft } from '../connectors/strategy/types.js';

function draft(overrides: Partial<ListingDraft> = {}): ListingDraft {
  return {
    sku: 'NS-MESTRE',
    title: 'Camiseta Dry Fit',
    price: 49.9,
    stock: 3,
    attributes: [
      { id: 'cor', value_name: 'Cor', name: 'Cor' },
      { id: 'tamanho', value_name: 'Tamanho', name: 'Tamanho' },
    ],
    description: '<p>Descrição</p>',
    brand: 'JHS',
    categoryIds: [123456],
    variants: [
      { sku: 'NS-AZ-M', price: 49.9, stock: 3, values: ['Azul', 'M'] },
      { sku: 'NS-PT-G', price: 54.9, stock: 4, values: ['Preto', 'G'] },
    ],
    images: ['https://hub.test/api/media/a.jpg'],
    ...overrides,
  };
}

describe('buildNuvemshopProductBody', () => {
  it('emite um objeto por variação, com values na ordem dos attributes', () => {
    const body = buildNuvemshopProductBody(draft()) as {
      name: { pt: string };
      description: { pt: string };
      categories: number[];
      brand: string;
      attributes: Array<{ pt: string }>;
      variants: Array<{ sku: string; price: string; stock: number; values: Array<{ pt: string }> }>;
    };
    expect(body.name).toEqual({ pt: 'Camiseta Dry Fit' });
    expect(body.description).toEqual({ pt: '<p>Descrição</p>' });
    expect(body.categories).toEqual([123456]);
    expect(body.brand).toBe('JHS');
    expect(body.attributes).toEqual([{ pt: 'Cor' }, { pt: 'Tamanho' }]);
    expect(body.variants).toHaveLength(2);
    expect(body.variants[0]).toEqual({
      price: '49.90',
      sku: 'NS-AZ-M',
      stock_management: true,
      stock: 3,
      values: [{ pt: 'Azul' }, { pt: 'M' }],
    });
    expect(body.variants[1]).toMatchObject({ sku: 'NS-PT-G', price: '54.90', stock: 4 });
    expect(body.variants[1]!.values).toEqual([{ pt: 'Preto' }, { pt: 'G' }]);
  });

  it('não perde SKU quando o produto tem 10 variações', () => {
    const variants = Array.from({ length: 10 }, (_, index) => ({
      sku: `NS-${index}`,
      price: 10,
      stock: index,
      values: ['Azul', 'M'],
    }));
    const body = buildNuvemshopProductBody(draft({ variants })) as {
      variants: Array<{ sku: string }>;
    };
    expect(body.variants.map((variant) => variant.sku)).toEqual(variants.map((variant) => variant.sku));
  });

  it('produto simples sem eixos envia uma variação sem attributes/values', () => {
    const body = buildNuvemshopProductBody(
      draft({
        sku: 'NS-SIMPLES',
        attributes: [],
        variants: [{ sku: 'NS-SIMPLES', price: 10, stock: 2, values: [] }],
        description: null,
        categoryIds: [],
        brand: null,
        images: [],
      })
    ) as Record<string, unknown>;
    expect(body).toEqual({
      name: { pt: 'Camiseta Dry Fit' },
      published: true,
      variants: [
        { price: '10.00', sku: 'NS-SIMPLES', stock_management: true, stock: 2 },
      ],
    });
  });

  it('falha com mais de 3 eixos', () => {
    expect(() =>
      buildNuvemshopProductBody(
        draft({
          attributes: [
            { id: 'a', value_name: 'A' },
            { id: 'b', value_name: 'B' },
            { id: 'c', value_name: 'C' },
            { id: 'd', value_name: 'D' },
          ],
          variants: [{ sku: 'X', price: 1, stock: 1, values: ['a', 'b', 'c', 'd'] }],
        })
      )
    ).toThrow(/3 atributos/);
  });

  it('falha quando a variação não tem valor para todo eixo', () => {
    expect(() =>
      buildNuvemshopProductBody(
        draft({ variants: [{ sku: 'NS-X', price: 10, stock: 1, values: ['Azul'] }] })
      )
    ).toThrow(/NS-X/);
  });

  it('falha com SKU duplicado', () => {
    expect(() =>
      buildNuvemshopProductBody(
        draft({
          variants: [
            { sku: 'NS-X', price: 10, stock: 1, values: ['Azul', 'M'] },
            { sku: 'NS-X', price: 10, stock: 1, values: ['Preto', 'G'] },
          ],
        })
      )
    ).toThrow(/duplicado/i);
  });

  it('falha com preço inválido', () => {
    expect(() =>
      buildNuvemshopProductBody(
        draft({ variants: [{ sku: 'NS-X', price: 0, stock: 1, values: ['Azul', 'M'] }] })
      )
    ).toThrow(NuvemshopPublishError);
  });
});
