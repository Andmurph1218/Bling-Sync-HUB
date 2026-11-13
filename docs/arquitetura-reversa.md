# Volta do marketplace para o HUB

O HUB lê o anúncio do canal para alinhar vínculos, diagnosticar divergências e enriquecer mídia/conteúdo por canal. Preço, estoque e fiscal continuam soberanos no ERP: o HUB nunca grava esses campos de volta no Bling.

## Estoque e preço

O ERP é soberano absoluto.

Se o marketplace divergir — por exemplo, vendeu no canal e o saldo no Bling ainda não baixou, ou há promoção ativa apenas na loja — o HUB não sobrescreve o ERP. A reconciliação faz upsert do retrato em `marketplace_listings_snapshot` (preservando o retrato anterior se a API do canal responder `401`, `429` ou `5xx`) e exibe o alerta em **Problemas** (filtro *Divergências de Canal*). O ajuste comercial ou de saldo é feito pelo operador no Bling.

`MarketplaceConnector.updateStock` permanece recusando escrita direta de estoque (`estoque_na_integracao_nativa`).

## Dados fiscais

NCM, EAN e SKU nascem no ERP.

- Se um canal trouxer EAN válido ausente no ERP, o motor **GVE** registra sugestão em `ean_pending_validation` para revisão humana em `/fiscal/ean`.
- NCM obtido no enriquecimento entra como `pending_approval` e exige dupla confirmação por dois revisores fiscais distintos com nota TIPI em `/fiscal/ncm`.
- O HUB não sobrescreve NCM, EAN nem SKU diretamente no Bling a partir de anúncios externos.

## Enriquecimento

Imagens e conteúdo de canal entram na camada do HUB sem adulterar o cadastro mestre do Bling:

- Imagens importadas de anúncios entram em `product_images` / `image_processing_queue` (passando pelo **IQRE** antes de elegibilidade de capa).
- Títulos e descrições específicos de canal ficam em `channel_content_overrides`, mantendo nome e descrição originais do ERP intactos.

## Duplicidade e reconciliação de vínculos

O detector de duplicidade (`duplicate-detector.service.ts`) sinaliza SKU ou EAN repetido entre produtos ativos e anúncios já existentes.

Na reconciliação (`reconciliation.service.ts`):
- Na **Nuvemshop**, o HUB descobre/valida automaticamente o `store_id` da loja conectada e percorre os anúncios em páginas de 200 itens (`createNuvemshopBatchReader`).
- **Regra de dois sinais (`collectListingSignals`):** o vínculo só nasce **`vinculado`** automaticamente quando há pelo menos **dois sinais concordantes** (ex.: `SKU + EAN` ou `SKU + título compatível`). Quando apenas **um sinal** coincide (ex.: somente SKU sem EAN e com título divergente, ou somente EAN), o HUB grava **`sugerido`** e envia o par para confirmação humana em **`/vinculos`** (`matching_queue`), evitando falsos positivos em kits ou EAN compartilhado.
- Produto já vinculado nunca entra como criação de novo anúncio na fila de publicação.

## Pedidos

O HUB não processa pedido nem NF-e. `catalog-mode.ts` recusa eventos `order.*` e `orderNF.*`. A entrada de pedidos permanece na integração nativa dos canais com o Bling.

## Quando ligar a publicação ao vivo

`ENABLE_LIVE_PUBLISHING` só envia chamadas reais ao marketplace quando seu valor é exatamente `true`. Qualquer outro valor mantém a fila em simulação. Mesmo com `ENABLE_LIVE_PUBLISHING=true`, apenas os SKUs presentes em **`LIVE_PUBLISH_ALLOWLIST`** são publicados no piloto (lista vazia bloqueia todos os envios), e o **botão de pânico** em `/configuracoes/geral` interrompe imediatamente a fila caso necessário.

Condições obrigatórias para iniciar o piloto ao vivo, todas ao mesmo tempo:

1. Depósitos reais do Bling conferidos em `/canais/depositos` (somente depósitos próprios de venda com `role = 'seller'` e `include_in_push = true`).
2. Checklist do canal 100% verde para os SKUs incluídos na `LIVE_PUBLISH_ALLOWLIST`.
3. Token do canal ativo válido e renovável (Nuvemshop usa token permanente validado na loja `6667412`).
4. Volta de preço e estoque operando exclusivamente como alerta, sem escrita no ERP.
5. Simulação (Dry-Run) conferida sem falhas abertas em `/problemas` e pessoa com permissão `push:execute` acompanhando as primeiras 48 horas.
