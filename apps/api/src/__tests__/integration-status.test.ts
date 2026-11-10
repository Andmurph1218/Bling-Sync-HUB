import { describe, expect, it } from 'vitest';
import { evaluateCatalogChecklist } from '../catalog/completeness.js';
import { describeChannelIntegration } from '../catalog/integration-status.js';
import { instantiateConnector } from '../connectors/ipaas/connector.js';
import { loadConnectors } from '../connectors/load.js';

function checklist(overrides: Partial<Parameters<typeof evaluateCatalogChecklist>[0]> = {}) {
  return evaluateCatalogChecklist({
    erpId: '1',
    sku: 'SKU-1',
    hasCoverImage: true,
    hubCategoryId: 'cat',
    mappedPlatforms: ['nuvemshop'],
    greenPlatforms: ['nuvemshop'],
    eanStatus: 'valid',
    eanRequired: false,
    ncmStatus: 'valid',
    ncmFiscalRisk: false,
    price: 10,
    hasDuplicateCandidate: false,
    channels: ['nuvemshop'],
    ...overrides,
  });
}

describe('status de integração por canal', () => {
  it('marca vinculado e apto como conectado', () => {
    const view = describeChannelIntegration({
      platform: 'nuvemshop',
      linkStatus: 'linked',
      sendRequested: false,
      checklist: checklist(),
    });
    expect(view.visual).toBe('connected');
    expect(view.ready).toBe(true);
  });

  it('explica a categoria que falta sem tratar como bloqueio crítico', () => {
    const view = describeChannelIntegration({
      platform: 'nuvemshop',
      linkStatus: null,
      sendRequested: false,
      checklist: checklist({ hubCategoryId: null, mappedPlatforms: [], greenPlatforms: [] }),
    });
    expect(view.visual).toBe('pending');
    expect(view.tooltip).toBe('Falta vincular categoria no HUB');
    expect(view.blockers.some((item) => item.where === 'hub')).toBe(true);
  });

  it('bloqueia SKU vazio e NCM inválido', () => {
    const view = describeChannelIntegration({
      platform: 'nuvemshop',
      linkStatus: null,
      sendRequested: true,
      checklist: checklist({ sku: '', ncmStatus: 'invalid' }),
    });
    expect(view.visual).toBe('blocked');
    expect(view.blockers.map((item) => item.code)).toEqual(expect.arrayContaining(['sku', 'ncm']));
  });

  it('deixa em branco quando não há vínculo nem pedido de envio', () => {
    const view = describeChannelIntegration({
      platform: 'nuvemshop',
      linkStatus: null,
      sendRequested: false,
      checklist: checklist(),
    });
    expect(view.visual).toBe('absent');
  });
});

describe('fábrica de conectores', () => {
  it('só instancia Bling e Nuvemshop conectados e ignora o Mercado Livre desligado', async () => {
    await loadConnectors();
    expect(instantiateConnector('bling', true)?.id).toBe('bling');
    expect(instantiateConnector('nuvemshop', true)?.id).toBe('nuvemshop');
    expect(instantiateConnector('bling', false)).toBeNull();
    expect(instantiateConnector('mercadolivre', true)).toBeNull();
    expect(instantiateConnector('shopee', true)).toBeNull();
    const shop = instantiateConnector('nuvemshop', true);
    expect(shop?.getReadinessRequirements().map((item) => item.code)).toContain('category');
  });
});
