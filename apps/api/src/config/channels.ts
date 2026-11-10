/** Mercado Livre permanece no código, mas fica inativo até nova autorização. */
export const MERCADO_LIVRE_ACTIVE = false;

export const ACTIVE_CATALOG_CHANNELS = MERCADO_LIVRE_ACTIVE
  ? (['mercadolivre', 'nuvemshop'] as const)
  : (['nuvemshop'] as const);
