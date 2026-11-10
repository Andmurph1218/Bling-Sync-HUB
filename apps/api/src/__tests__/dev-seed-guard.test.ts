import { describe, expect, it } from 'vitest';
import { assertDevSeedAllowed } from '../scripts/dev-seed-guard.js';

describe('seed do admin local', () => {
  it('aceita development apontando para localhost', () => {
    expect(() =>
      assertDevSeedAllowed('development', 'postgres://bling_hub:bling_hub_dev@localhost:5432/bling_sync_hub')
    ).not.toThrow();
    expect(() =>
      assertDevSeedAllowed('development', 'postgres://bling_hub:bling_hub_dev@127.0.0.1:5432/bling_sync_hub')
    ).not.toThrow();
  });

  it('recusa produção e banco remoto', () => {
    expect(() => assertDevSeedAllowed('production', 'postgres://bling_hub:x@localhost:5432/bling_sync_hub')).toThrow(
      /development/
    );
    expect(() =>
      assertDevSeedAllowed('development', 'postgres://bling_hub:x@201.79.39.118:5432/bling_sync_hub')
    ).toThrow(/localhost/);
  });
});
