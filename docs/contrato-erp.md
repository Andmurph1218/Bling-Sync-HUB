# Contrato de um segundo ERP

O HUB fala com o ERP pela interface `ErpConnector` em `apps/api/src/connectors/strategy/types.ts`. O Bling é a classe registrada hoje. Outro ERP entra como classe nova na fábrica, com o slug próprio. Catálogo, atributos e filas não importam o conector do ERP.

## Campos soberanos

Estes campos nascem no ERP e o HUB não os grava de volta a partir de um marketplace:

| Campo | Onde o HUB guarda |
|---|---|
| Identidade do cadastro | `master_products.erp_id` |
| SKU | `master_products.erp_sku` e `product_variants.erp_sku` |
| Preço de cadastro | `product_variants.price` |
| Estoque do vendedor | `product_variants.stock` |
| NCM | `master_products.ncm` |
| EAN | `product_variants.ean` |

Nome e descrição do ERP também não são substituídos por texto de canal. Imagem importada do anúncio fica em `product_images` e não altera o ERP.

## Métodos que a classe nova precisa implementar

| Método | O que entrega |
|---|---|
| `syncProduct` | O cadastro existe e qual é o id externo, o SKU e o nome |
| `getStock` | Quantidade do vendedor, ou ausência de leitura |
| `getPrice` | Preço de cadastro, ou ausência de leitura |
| `listCatalogPage` | Uma página de ids externos, dizendo se a página acabou |
| `pullCatalogProduct` | O payload bruto de um id, ou nulo se não existir |
| `createProduct` | Cria o cadastro mínimo e devolve o `erp_id` |
| `pullStockBalances` | Opcional. Saldos por id |
| `listChildIds` | Opcional. Ids das variações de uma grade |
| `recordUrl` | Opcional. URL para abrir o cadastro no ERP |

A fábrica registra a classe com `registerErpConnector(slug, criar)`. O slug `bling` continua o ERP padrão até outra conta ser escolhida.
