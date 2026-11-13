# Contrato de um segundo ERP

O HUB fala com o ERP pela interface `ErpConnector` em `apps/api/src/connectors/strategy/types.ts`. O conector ativo é selecionado por `ACTIVE_ERP` (`activeErpConnector()` em `apps/api/src/connectors/strategy/factory.ts`), tendo `bling` como padrão. Outro ERP (ex.: Omie, Tiny, SAP) entra como nova classe registrada na fábrica com `registerErpConnector(slug, factory)`.

> **Estado atual do isolamento (12/11/2026):** `activeErpConnector()`, o snapshot comercial neutro `ErpCommerceSnapshot` (`readCommerce`), as portas de taxa (`rate-limit-port.ts`) e os erros de domínio (`strategy/types.ts`) estão ativos e validados por `architecture.test.ts` (`0` imports diretos de `connectors/bling/*` fora da pasta do conector).

## Campos soberanos

Estes campos nascem no ERP e o HUB não os grava de volta a partir de um marketplace:

| Campo | Onde o HUB guarda |
|---|---|
| Identidade do cadastro | `master_products.erp_id` |
| SKU | `master_products.erp_sku` e `product_variants.erp_sku` |
| Preço de cadastro | `product_variants.price` |
| Estoque publicável (`seller`) | `product_variants.stock` (exibição geral em `catalog_stock`) |
| NCM | `master_products.ncm` |
| EAN | `product_variants.ean` |

Nome e descrição do ERP também não são substituídos por texto de canal (`channel_content_overrides` guarda textos por marketplace). Imagem importada de anúncio fica em `product_images` e não altera o ERP.

## Métodos da interface `ErpConnector`

| Método | Obrigatório | O que entrega |
|---|---|---|
| `syncProduct(productId)` | Sim | Confirma se o cadastro existe e devolve `externalId`, `sku` e `name` |
| `getStock(productId)` | Sim | Quantidade elegível do vendedor no espelho/ERP, ou ausência de leitura |
| `getPrice(productId)` | Sim | Preço de cadastro, ou ausência de leitura |
| `listCatalogPage(page, pageSize)` | Sim | Página de IDs externos ativos (`externalIds`, `childIds`, `done`, `total`) |
| `pullCatalogProduct(externalId)` | Sim | Payload bruto do cadastro por ID externo, ou `null` em `404` |
| `fetchProductEnrichmentData(erpId)` | Sim | `{ images, ncm, category }` extraídos do cadastro no ERP para o worker de enriquecimento |
| `createProduct(productData)` | Sim | Cria apenas o cadastro mínimo no ERP (sem lançar saldo em estoque) e devolve `{ erp_id, stockWarning }` |
| `readCommerce(externalId)` | Opcional | `ErpCommerceSnapshot` neutro (`sku`, `changedAt`, `lines[]` com preço por variante e `balances[]`), evitando que o core leia campos proprietários do ERP |
| `pullStockBalances(externalIds)` | Opcional | Saldos por depósito para um lote de IDs externos |
| `listChildIds(parentId)` | Opcional | IDs das variações filhas de um produto-grade |
| `recordUrl(erpId)` | Opcional | Deep link para abrir o cadastro diretamente na interface do ERP |

A fábrica registra a implementação com `registerErpConnector(slug, criar)`. Enquanto `ACTIVE_ERP` não for alterado no ambiente, `bling` permanece como o ERP soberano padrão.
