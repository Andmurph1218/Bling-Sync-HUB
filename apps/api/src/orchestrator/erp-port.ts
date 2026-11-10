import type { MapErpProductResult } from '../contracts/mappers.js';

type CatalogMapper = (payload: unknown) => MapErpProductResult;

let mapper: CatalogMapper | null = null;

export function registerCatalogMapper(next: CatalogMapper): void {
  mapper = next;
}

export function mapInboundProduct(payload: unknown): MapErpProductResult {
  if (!mapper) {
    throw new Error('erp_mapper_not_loaded');
  }
  return mapper(payload);
}
