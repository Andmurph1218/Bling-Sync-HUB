import { describe, expect, it } from 'vitest';
import {
  BLING_SIMPLE_PRODUCT_FIXTURE,
  BLING_VARIABLE_PRODUCT_FIXTURE,
  BLING_KIT_PRODUCT_FIXTURE,
  BLING_VARIABLE_KIT_PRODUCT_FIXTURE,
  BLING_STOCK_BALANCES_TWO_SELLERS_FIXTURE,
  BLING_STOCK_BALANCES_WITH_ML_FULL_FIXTURE,
  BLING_STORE_PRICE_LINK_FIXTURE,
  BLING_WEBHOOK_PRODUCT_UPDATED_INACTIVE_FIXTURE,
  BLING_WEBHOOK_PRODUCT_UPDATED_EXCLUDED_FIXTURE,
  BLING_WEBHOOK_PRODUCT_DELETED_FIXTURE,
  BLING_GET_PRODUCT_404_RESPONSE_FIXTURE,
  BLING_GET_PRODUCT_200_RESPONSE_FIXTURE,
  BLING_RATE_LIMIT_429_FIXTURE,
} from '../contracts/fixtures/bling.fixtures.js';
import {
  ML_LEGACY_VARIATIONS_ITEM_FIXTURE,
  ML_USER_PRODUCT_FAMILY_ITEMS_FIXTURE,
  ML_UP_STOCK_ONLY_MELI_FACILITY_FIXTURE,
  ML_UP_STOCK_SELLER_AND_MELI_FACILITY_FIXTURE,
  ML_UPTIN_MIGRATION_WEBHOOK_FIXTURE,
} from '../contracts/fixtures/mercadolivre.fixtures.js';
import { NS_PRODUCT_WITH_INVENTORY_LEVELS_FIXTURE } from '../contracts/fixtures/nuvemshop.fixtures.js';
import {
  applyMlUptinMigration,
  classifyApiHttpError,
  computePublishableStockFromBalances,
  mapBlingProductToCatalog,
  mapMercadoLivreListingGroup,
  mapMercadoLivreStockLocations,
  mapNuvemshopProduct,
  resolveBlingLifecycleSignal,
  resolveVariantChannelPrice,
} from '../contracts/mappers.js';

describe('Fase 0.5 — Fixtures Sanitizados e Mappers (Simples, Variação, Kit, 429 e product.deleted)', () => {
  it('1. Mapper cobre produto simples (formato S): 1 variante is_default, mesmo SKU, stock nulo e espelho de CEST/origem', () => {
    const res = mapBlingProductToCatalog(BLING_SIMPLE_PRODUCT_FIXTURE.data);
    expect(res.kind).toBe('mapped');
    if (res.kind !== 'mapped') return;

    const { product } = res;
    expect(product.bling_id).toBe('100101');
    expect(product.bling_sku).toBe('GAR-INOX-500-PT');
    expect(product.bling_formato).toBe('S');
    expect(product.ncm).toBe('96170010');
    expect(product.cest).toBe('2004700');
    expect(product.tax_origin).toBe(0);
    expect(product.requires_cest).toBe(true);
    expect(product.variants).toHaveLength(1);

    const v = product.variants[0]!;
    expect(v.is_default).toBe(true);
    expect(v.bling_variant_id).toBeNull();
    expect(v.bling_sku).toBe('GAR-INOX-500-PT');
    expect(v.bling_formato).toBe('S');
    expect(v.stock_mode).toBeNull();
    // Regra crítica: nunca copia saldoVirtualTotal (999) do payload de produto para stock
    expect(v.stock).toBeNull();
    expect(v.components).toEqual([]);
  });

  it('2. Mapper cobre produto com variação (formato V) e variação que também é composição (formato E)', () => {
    const resVar = mapBlingProductToCatalog(BLING_VARIABLE_PRODUCT_FIXTURE.data);
    expect(resVar.kind).toBe('mapped');
    if (resVar.kind !== 'mapped') return;

    expect(resVar.product.bling_formato).toBe('V');
    expect(resVar.product.product_axes).toEqual(['cor', 'tamanho']);
    expect(resVar.product.variants).toHaveLength(2);
    expect(resVar.product.variants.every((v) => !v.is_default)).toBe(true);
    expect(resVar.product.variants[0]?.comboKey).toBe('cor:Azul|tamanho:M');
    expect(resVar.product.variants[0]?.stock).toBeNull();
    expect(resVar.product.variants[1]?.comboKey).toBe('cor:Preto|tamanho:G');

    const resVarKit = mapBlingProductToCatalog(BLING_VARIABLE_KIT_PRODUCT_FIXTURE.data);
    expect(resVarKit.kind).toBe('mapped');
    if (resVarKit.kind !== 'mapped') return;

    const unitVariant = resVarKit.product.variants[0]!;
    const pairKitVariant = resVarKit.product.variants[1]!;
    expect(unitVariant.bling_formato).toBe('S');
    expect(unitVariant.components).toHaveLength(0);
    expect(pairKitVariant.bling_formato).toBe('E');
    expect(pairKitVariant.stock_mode).toBe('virtual');
    expect(pairKitVariant.components).toEqual([
      { component_bling_id: '400401', quantity: 2 },
    ]);
  });

  it('3. Mapper cobre kit (formato E) como 1 SKU vendável com estoque virtual e dois componentes', () => {
    const resKit = mapBlingProductToCatalog(BLING_KIT_PRODUCT_FIXTURE.data);
    expect(resKit.kind).toBe('mapped');
    if (resKit.kind !== 'mapped') return;

    expect(resKit.product.bling_formato).toBe('E');
    expect(resKit.product.variants).toHaveLength(1);
    const kitVar = resKit.product.variants[0]!;
    expect(kitVar.is_default).toBe(true);
    expect(kitVar.bling_formato).toBe('E');
    expect(kitVar.stock_mode).toBe('virtual');
    expect(kitVar.stock).toBeNull();
    expect(kitVar.components).toEqual([
      { component_bling_id: '100101', quantity: 2 },
      { component_bling_id: '100199', quantity: 1 },
    ]);
  });

  it('4. Saldos de depósito: soma apenas seller com include_in_push = true, exclui ml_full e envia floor ao canal', () => {
    const twoSellersResult = computePublishableStockFromBalances(
      BLING_STOCK_BALANCES_TWO_SELLERS_FIXTURE.data[0]!,
      [
        { bling_warehouse_id: '9001', role: 'seller', include_in_push: true },
        { bling_warehouse_id: '9002', role: 'seller', include_in_push: false },
      ]
    );
    expect(twoSellersResult.variantStockColumn).toBe(12.8);
    expect(twoSellersResult.publishableFloor).toBe(12);
    expect(twoSellersResult.emptySellerPushWarehousesAlert).toBe(false);

    const withMlFullResult = computePublishableStockFromBalances(
      BLING_STOCK_BALANCES_WITH_ML_FULL_FIXTURE.data[0]!,
      [
        { bling_warehouse_id: '9001', role: 'seller', include_in_push: true },
        { bling_warehouse_id: '9099', role: 'ml_full', include_in_push: false },
      ]
    );
    // Saldo 105 do ml_full fica 100% fora da soma
    expect(withMlFullResult.variantStockColumn).toBe(7);
    expect(withMlFullResult.publishableFloor).toBe(7);
  });

  it('5. Preço por loja (GET /produtos/lojas): espera leitura quando loja configurada sem linha e aplica promocional da loja', () => {
    const waiting = resolveVariantChannelPrice({
      catalogPrice: 89.9,
      catalogPromotionalPrice: null,
      usePromotional: false,
      costPrice: 42.5,
      hasChannelStoreConfigured: true,
      storePriceRow: null,
    });
    expect(waiting.waitingForStoreRead).toBe(true);
    expect(waiting.effectivePrice).toBeNull();

    const storeFixture = BLING_STORE_PRICE_LINK_FIXTURE.data[0]!;
    const resolvedStore = resolveVariantChannelPrice({
      catalogPrice: 89.9,
      catalogPromotionalPrice: null,
      usePromotional: false,
      costPrice: 42.5,
      hasChannelStoreConfigured: true,
      storePriceRow: {
        store_price: storeFixture.preco,
        store_promotional_price: storeFixture.precoPromocional,
      },
    });
    expect(resolvedStore.waitingForStoreRead).toBe(false);
    expect(resolvedStore.effectivePrice).toBe(94.9);
    expect(resolvedStore.source).toBe('store');
    expect(resolvedStore.catalogStoreDivergenceAlert).toBe(true);
    expect(resolvedStore.belowCostCriticalAlert).toBe(false);
  });

  it('6. Ciclo de vida e product.deleted: distingue situacao I/E, confirma exclusão apenas após GET 404 e alerta se GET ainda for 200', () => {
    const inactiveRes = resolveBlingLifecycleSignal({
      type: 'product.updated',
      situacao: BLING_WEBHOOK_PRODUCT_UPDATED_INACTIVE_FIXTURE.data.situacao,
    });
    expect(inactiveRes.catalog_status).toBe('inactive');
    expect(inactiveRes.variant_status).toBe('inactive');
    expect(inactiveRes.cancelPendingContentAndCreate).toBe(true);
    expect(inactiveRes.commercialExitZeroStockAndPause).toBe(true);

    const excludedRes = resolveBlingLifecycleSignal({
      type: 'product.updated',
      situacao: BLING_WEBHOOK_PRODUCT_UPDATED_EXCLUDED_FIXTURE.data.situacao,
    });
    expect(excludedRes.catalog_status).toBe('deleted');
    expect(excludedRes.variant_status).toBe('discontinued');

    const deletedConfirmed404 = resolveBlingLifecycleSignal({
      type: BLING_WEBHOOK_PRODUCT_DELETED_FIXTURE.event as 'product.deleted',
      followUpGetStatus: BLING_GET_PRODUCT_404_RESPONSE_FIXTURE.status,
    });
    expect(deletedConfirmed404.statusChanged).toBe(true);
    expect(deletedConfirmed404.catalog_status).toBe('deleted');
    expect(deletedConfirmed404.variant_status).toBe('discontinued');

    const deletedStill200 = resolveBlingLifecycleSignal({
      type: BLING_WEBHOOK_PRODUCT_DELETED_FIXTURE.event as 'product.deleted',
      followUpGetStatus: BLING_GET_PRODUCT_200_RESPONSE_FIXTURE.status,
    });
    expect(deletedStill200.statusChanged).toBe(false);
    expect(deletedStill200.catalog_status).toBeNull();
    expect(deletedStill200.prematureDeleteEventAlert).toBe(true);
  });

  it('7. Classificador HTTP cobre resposta 429 (com Retry-After), 409 (x-version) e 404', () => {
    const rateLimited = classifyApiHttpError(
      BLING_RATE_LIMIT_429_FIXTURE.status,
      BLING_RATE_LIMIT_429_FIXTURE.headers
    );
    expect(rateLimited.category).toBe('rate_limit_429');
    expect(rateLimited.retryable).toBe(true);
    expect(rateLimited.retryAfterMs).toBe(2000);

    const conflict409 = classifyApiHttpError(409);
    expect(conflict409.category).toBe('version_conflict_409');
    expect(conflict409.retryable).toBe(true);
  });

  it('8. Mercado Livre Legado, Família User Product (2 condições), Estoque Full (meli_facility) e Migração UPtin', () => {
    const legacy = mapMercadoLivreListingGroup([ML_LEGACY_VARIATIONS_ITEM_FIXTURE]);
    expect(legacy.ml_model).toBe('legacy_variations');
    expect(legacy.variants).toHaveLength(2);
    expect(legacy.variants[0]?.platform_sku_raw).toBe('CAM-DRY-AZ-M');
    expect(legacy.variants[0]?.platform_sku_field).toBe('attributes[SELLER_SKU]');
    expect(legacy.variants[1]?.platform_sku_raw).toBe('CAM-DRY-PT-G');
    expect(legacy.variants[1]?.platform_sku_field).toBe('seller_custom_field');

    const upFamily = mapMercadoLivreListingGroup(ML_USER_PRODUCT_FAMILY_ITEMS_FIXTURE);
    expect(upFamily.ml_model).toBe('user_product');
    expect(upFamily.family_id).toBe('MLBF990011');
    // 3 itens na família, mas apenas 2 user_product_id distintos
    expect(upFamily.variants).toHaveLength(2);
    const firstUp = upFamily.variants[0]!;
    expect(firstUp.user_product_id).toBe('MLBU100001');
    expect(firstUp.selling_conditions).toHaveLength(2);
    // 1ª condição marcada follow_store_price = true e 2ª false, ambas com trilha system
    expect(firstUp.selling_conditions[0]?.follow_store_price).toBe(true);
    expect(firstUp.selling_conditions[0]?.control_change_entry.origin).toBe('system');
    expect(firstUp.selling_conditions[1]?.follow_store_price).toBe(false);
    expect(firstUp.selling_conditions[1]?.control_change_entry.new_value).toBe('false');

    const onlyFullStock = mapMercadoLivreStockLocations(ML_UP_STOCK_ONLY_MELI_FACILITY_FIXTURE);
    expect(onlyFullStock.canWriteSellerWarehouse).toBe(false);
    expect(onlyFullStock.skipStockStepReason).toBe('ml_full');

    const coexistingStock = mapMercadoLivreStockLocations(
      ML_UP_STOCK_SELLER_AND_MELI_FACILITY_FIXTURE
    );
    expect(coexistingStock.canWriteSellerWarehouse).toBe(true);
    expect(coexistingStock.skipStockStepReason).toBeNull();
    expect(coexistingStock.stock_version).toBe(11);

    const migrated = applyMlUptinMigration(
      {
        master_product_id: 'uuid-master-1',
        variant_id: 'uuid-var-1',
        match_confidence: 95,
      },
      ML_UPTIN_MIGRATION_WEBHOOK_FIXTURE
    );
    expect(migrated.family_confidence).toBe(95);
    expect(migrated.user_product_id).toBe('MLBU100001');
  });

  it('9. Nuvemshop: mapeia inventory_levels e gera payload de measures sem price nem stock', () => {
    const ns = mapNuvemshopProduct(NS_PRODUCT_WITH_INVENTORY_LEVELS_FIXTURE);
    expect(ns.platform_product_id).toBe('991122');
    expect(ns.variants).toHaveLength(2);
    const v1 = ns.variants[0]!;
    expect(v1.stock).toBe(12);
    expect(v1.measuresPayload).toEqual({
      id: 55001,
      weight: '0.180',
      width: '25.00',
      height: '3.00',
      depth: '30.00',
    });
    expect('price' in v1.measuresPayload).toBe(false);
    expect('stock' in v1.measuresPayload).toBe(false);
  });
});
