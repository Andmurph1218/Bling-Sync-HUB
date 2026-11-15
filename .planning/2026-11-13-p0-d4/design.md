# P0-D4 — Publicação Nuvemshop completa (imagem, categoria, atributos, variações)

## Revisão 2 — mudanças solicitadas

- [x] **Variações sem perda de SKU**: `variants` tem N objetos, um por `product_variants` ativo. O exemplo abaixo mostra 2; um produto com 10 variações gera 10 objetos, todos com SKU/preço/estoque/values.
- [x] **Conversão explícita para HTML**: texto puro passa por `\n\n` → `<p>` e `\n` → `<br>`, depois `sanitize-html`; HTML de origem também é sanitizado. O body nunca recebe texto puro.
- [x] **Imagens por URL, sem corte por contagem**: `Set` com os `src` existentes na Nuvemshop e envio apenas do que não está no Set. A contagem foi removida. A reescrita de `src` pelo CDN da Nuvemshop fica documentada como limitação da V1.

## Objetivo


Publicar na Nuvemshop um produto com checklist verde, incluindo descrição em HTML sanitizado, categoria, todos os atributos de variação, todas as variações e as imagens (capa primeiro), sem duplicar imagens em retry.

## Decisões aprovadas

1. **Variações reais, sem perda de SKU**: `buildNuvemshopProductBody` itera **todas** as variantes ativas do produto. Nenhuma variação é descartada: `variants` tem exatamente N objetos, um por `product_variants` ativo, cada um com seu SKU, preço, estoque e `values`. `attributes` é montado com os nomes dos eixos (ordem de `product_axes`/`attribute_axes`, usando `ns_option_name` quando existir). Um produto com 10 variações gera 10 objetos em `variants`.
2. **Marca**: `brand` é campo próprio do produto; não entra em `attributes`/`values`.
3. **Limite**: até 3 eixos (limite da Nuvemshop). Acima disso, falha com mensagem clara em vez de publicar torto.
4. **Descrição HTML explícita**: o texto vindo do override/ERP é convertido antes de enviar. Texto puro tem `\n\n` convertido em `<p>` e `\n` simples em `<br>`; HTML de origem também passa por sanitização com `sanitize-html` (remove `script`, `iframe`, `on*`, `javascript:` etc.). O body nunca recebe texto puro.
5. **Imagens por URL**: após criar (e também quando o produto já existe), `GET /products/{id}/images`, criar um `Set` de `src` e enviar **apenas** as imagens do HUB cujo `src` não está no Set, com `position = Set.size + 1`. Não há corte por contagem: uma imagem nova entra mesmo que o operador tenha apagado outra no HUB. Limitação documentada da V1: a Nuvemshop pode reescrever `src` para o CDN dela; nesse caso o Set não casa no retry e a imagem pode ser reenviada. Resolver em P1 com mapa de posição/hash por anúncio.
6. **Descrição**: `channel_content_overrides` da Nuvemshop (default/primeira variante, `live` > `shadow`, ignora `reverted`) → `master_products.description` → `short_description`; converte/sanitiza; omite se vazio.
7. **Categoria**: exige ID numérico positivo. Mapeamento com ID inválido falha o job com mensagem clara.
8. **Checklist de produto variável**: hoje `checklistForChannels` só lê a variante `is_default=true`. Produto variável do Bling não tem default e fica vermelho por preço/EAN. Correção mínima: escolher a variante representante (default se existir; senão a primeira ativa por `created_at`).

## Payload do `POST /products`

Produto com 2 variações (Cor/Tamanho). Um produto com 10 variações gera 10 objetos em `variants`, sem descartar nenhum SKU:

```json
{
  "name": { "pt": "Camiseta Dry Fit" },
  "description": { "pt": "<p>Linha 1<br>Linha 2</p>" },
  "categories": [123456],
  "brand": "JHS",
  "attributes": [{ "pt": "Cor" }, { "pt": "Tamanho" }],
  "published": true,
  "variants": [
    {
      "price": "49.90",
      "sku": "NS-AZ-M",
      "stock_management": true,
      "stock": 3,
      "values": [{ "pt": "Azul" }, { "pt": "M" }]
    },
    {
      "price": "54.90",
      "sku": "NS-PT-G",
      "stock_management": true,
      "stock": 4,
      "values": [{ "pt": "Preto" }, { "pt": "G" }]
    }
  ]
}
```

Produto simples (sem eixos) continua com um único objeto em `variants`, sem `attributes`/`values`.

## Regras de montagem

- Eixos vêm de `variant_attributes` + `attribute_axes` + `product_axes`, ordenados por `product_axes.sort_order` e depois `attribute_axes.sort_order`.
- Nome do eixo no body: `ns_option_name` → `display_name` → `canonical_name`.
- Cada variação precisa ter valor para todos os eixos; falta de valor falha com mensagem clara.
- Preço/estoque vêm de cada `product_variants` (`price`, `stock`), não do default.
- SKUs duplicados ou preço `<= 0` falham antes do POST.
- Produto simples sem eixos: se o mapa da categoria tiver atributos fixos (ex.: Cor = Azul), eles viram um único eixo/valor na variação única. Se não houver, `attributes`/`values` são omitidos.
- Existência: o worker **já** consulta `channel_listing_links` (`linkedListingExternalId`) antes de chamar `createListing`; com vínculo, o POST nem acontece e o job falha com `EXISTING_LISTING_MESSAGE`. O lookup por SKU só roda quando não há vínculo. Para reduzir o N+1: tentar o SKU mestre primeiro e parar no primeiro anúncio encontrado; cada `fetchNuvemshopListing` usa timeout curto de **5s** e interrompe a sequência no primeiro 429/5xx (erro retryable), sem continuar para os próximos SKUs.

## Imagens

1. `GET /2025-03/{store}/products/{id}/images?per_page=200`.
2. `existingSrcs = new Set(imagens.map(i => i.src))`.
3. Enviar **somente** `imagensDoHub.filter(src => !existingSrcs.has(src))`, em ordem.
4. `position = existingSrcs.size + indice + 1` (capa primeiro na criação nova).
5. Sem corte por `plano.length - existentes.length`: imagem nova é enviada mesmo se outra foi apagada no HUB.
6. URL: `PUBLIC_BASE_URL/api/media/{sha256}.{ext}` quando houver hash + base pública; senão `source_url`/`url_normalized`.
7. Capa elegível primeiro; demais por `position_ns`; limite de 50.
8. Erro 429/5xx é retryable (job volta para `pending`); 4xx encerra. No retry, `ja_existia` reconcilia as faltantes.

> **Limitação V1**: a Nuvemshop devolve `src` no CDN dela. Se o `src` for reescrito, o Set não casa no retry e a imagem pode ser reenviada. O cruzamento por URL resolve o caso de imagem apagada no HUB (o cenário que a contagem errava), mas não garante idempotência perfeita contra reescrita de CDN. P1: persistir o mapa `{listing_id, position, sha256}` ou reconciliar por posição.

## Descrição HTML

Novo módulo `apps/api/src/connectors/strategy/nuvemshop-html.ts`:

```ts
toNuvemshopHtml(input: string | null | undefined): string | null
```

- Texto puro: escapa `&`, `<`, `>`; parágrafos separados por linha em branco viram `<p>`; quebras simples viram `<br>`.
- HTML: **não escapar**. Se o texto já contém tags HTML válidas (`<p>`, `<br>`, `<div>` etc.), passa direto pelo `sanitize-html`, preservando o HTML original. A detecção é por tag (`/<[a-z][\s\S]*>/i`), então um texto puro com sinal de menor (`5 < 10`) continua sendo tratado como texto e é escapado.
- Sem sanitização dupla: `<p>Texto</p>` sai como `<p>Texto</p>` (nunca `&lt;p&gt;Texto&lt;/p&gt;`); `&amp;` existente não vira `&amp;amp;`.
- Allowlist conservadora: `p, br, strong, b, em, i, u, s, ul, ol, li, h1..h6, blockquote, a, table, thead, tbody, tfoot, tr, th, td, hr, span, div`.
- `a` aceita apenas `href/title/target/rel` e esquemas `http/https/mailto`; `rel=noopener noreferrer` é injetado.
- Resultado vazio vira `null` e o campo é omitido do body.

Dependências: `sanitize-html` + `@types/sanitize-html` em `apps/api`.

## Arquivos

- `apps/api/src/connectors/strategy/types.ts`: `ListingVariant` e novos campos de `ListingDraft` (`description?`, `brand?`, `categoryIds?`, `variants?`, `images?`; `attributes[].name?`).
- `apps/api/src/connectors/strategy/nuvemshop-html.ts`: conversão + sanitização.
- `apps/api/src/catalog/publish-preview.ts`: `buildNuvemshopDraft(productId)`; ajuste da variante representante em `checklistForChannels`.
- `apps/api/src/queues/publish-queue.ts`: `listingDraftNow` usa `buildNuvemshopDraft` para Nuvemshop.
- `apps/api/src/connectors/strategy/nuvemshop-publish.ts`: `buildNuvemshopProductBody` exportado, body com descrição/categorias/marca/atributos/variações, checagem de SKUs e `syncNuvemshopImages`.
- `apps/api/package.json` + lockfile: `sanitize-html`.
- Testes: `publish-queue.test.ts` (contrato 2 variações + retry parcial), `nuvemshop-html.test.ts` (novo), `publish-queue-concurrency.test.ts` (separar POST de produto de POST de imagem).

## Teste de contrato

Produto variável `NS-VAR` com 2 variações, sem `is_default` (como o Bling grava):

- variante 1: `NS-AZ-M`, 49,90, estoque 3, Cor=Azul, Tamanho=M;
- variante 2: `NS-PT-G`, 54,90, estoque 4, Cor=Preto, Tamanho=G;
- categoria NS numérica `123456`, mapa com Marca/Cor/Tamanho;
- descrição texto puro com quebra de linha;
- capa elegível + imagem secundária.

Validações:

- `POST /products` contém `description.pt` em HTML, `categories: [123456]`, `brand`, `attributes: [{pt:"Cor"},{pt:"Tamanho"}]` e **dois** objetos em `variants`, com os `values` corretos na mesma ordem;
- primeira chamada `POST /products/{id}/images` é a capa com `position: 1`; segunda é a secundária com `position: 2`;
- retry após 503 na imagem: produto passa a existir, `GET images` devolve 1, sobe só a faltante;
- checklist fica verde para o produto sem `is_default`.

## Fora de escopo

- `PUT` de anúncio existente.
- Custom fields/metafields da Nuvemshop.
- Alterar o preview do Mercado Livre (ele continua single-variant).
- Migration nova (nenhuma coluna necessária).

## Riscos

- Atributos que não são eixos (ex.: GTIN) não são enviados como ficha técnica; a Nuvemshop 2025-03 não aceita valores livres em `attributes`. O gate continua exigindo o mapa da categoria.
- `PUBLIC_BASE_URL` ausente faz a publicação usar a URL de origem; se ela não for pública, a Nuvemshop recusa a imagem e o job retenta/falha. Não publica sem capa silenciosamente.
- A ordem da capa só é garantida em criação nova. Em anúncio existente com imagens fora de ordem, o `position` é append; reordenar exigiria `PUT /images/{id}`.
- Produto variável sem default passa a ser publicado com a primeira variante como representante do preço/EAN no checklist; é uma mudança de comportamento fora do escritor, mas necessária para o produto variável chegar ao POST.
