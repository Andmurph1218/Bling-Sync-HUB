import { describe, expect, it } from 'vitest';
import {
  assertNuvemshopReadable,
  listingFromProduct,
  NuvemshopListingError,
} from '../connectors/strategy/nuvemshop-listing.js';

describe('leitura do anúncio da Nuvemshop', () => {
  it('trata 404 como ausência e 401, 429 e 5xx como falha', () => {
    expect(assertNuvemshopReadable(200)).toBe('ok');
    expect(assertNuvemshopReadable(404)).toBe('missing');
    for (const status of [401, 429, 500, 503]) {
      expect(() => assertNuvemshopReadable(status)).toThrow(NuvemshopListingError);
    }
  });

  it('não compara preço com a primeira variante quando o SKU não bate', () => {
    const product = {
      id: 10,
      name: 'Kit',
      variants: [
        { sku: 'OUTRO', price: 9, stock: 1 },
        { sku: 'CERTO', price: 20, stock: 4 },
      ],
    };
    expect(listingFromProduct(product, 'SUMIU')).toBeNull();
    expect(listingFromProduct(product, 'certo')).toMatchObject({ price: 20, stock: 4, externalId: '10', signals: ['sku'] });
    const withEan = listingFromProduct(
      { ...product, variants: [{ sku: 'CERTO', barcode: '789', price: 20, stock: 4 }] },
      'CERTO',
      { ean: '789', name: 'Kit' }
    );
    expect(withEan?.signals).toEqual(expect.arrayContaining(['sku', 'ean']));
  });
});