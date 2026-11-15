# Auditoria Delta de Go-Live — JH Sync Hub

> ## ✅ Concluído / Resolvido
> **Registro histórico.** Esta auditoria apontou 4 bloqueadores (P0-D1 a P0-D4) em 13/11/2026. Todos foram corrigidos e verificados antes do go-live: migration `0034` (fila de imagem aceita `erp`), bloqueio de `sugerido` no `CREATE`, migration `0035` (um job aberto por produto e canal) e escritor completo da Nuvemshop (imagens, categoria, atributos, variações e HTML sanitizado).
> O veredito 🔴 NO-GO abaixo vale para o estado do código **antes** dessas correções. O estado atual está em [02-status-e-roadmap.md](../02-status-e-roadmap.md) e a revisão 3 em [auditoria-go-live.md](auditoria-go-live.md). Nada aqui é pendência.


**Data:** 13/11/2026
**Base auditada:** `main` @ `e22c27b` (`feat(images): ativar worker IQRE com cache local /api/media, S3 do Bling, Nuvemshop e endpoint oficial de variações`)
**Método:** leitura integral do código da API/web + execução limpa da suíte + prova isolada de constraint com `pg-mem`. **Nenhuma escrita de aplicação foi feita.** Não houve chamada real a Bling/Nuvemshop nem inspeção do PostgreSQL/Redis de produção nesta rodada.
**Auditoria de referência:** `docs/auditoria-go-live.md` (base `0671858`, 33 migrations).

---

## 1. Veredito

# 🔴 NO-GO

**Não ligar `ENABLE_LIVE_PUBLISHING=true` nesta base.**

A suíte está verde (51 arquivos / 185 testes, exit 0), mas os quatro bloqueios abaixo não são cobertos por ela e atacam exatamente o caminho que a flag liga:

1. **O Full Sync quebra em todo produto com imagem.** O Full Sync enfileira imagens com `source_platform = 'erp'`, valor que a constraint de `image_processing_queue` não aceita. O produto é gravado, mas o enfileiramento estoura e o erro é engolido por produto. Resultado: catálogo sem imagens, sem capa, sem `worst_score` e sem auto-publicação. **É regressão da refatoração de ERP/imagens.**
2. **Vínculo `sugerido` não bloqueia `CREATE`.** A reconciliação grava `sugerido` com `listing_id` real; checklist e worker só olham `vinculado`. O worker cria um anúncio duplicado na Nuvemshop e, ao gravar o vínculo, colide com `UNIQUE (product_id, channel)` e vira carta morta — anúncio órfão.
3. **Não existe serialização por `(produto, canal)` na publicação.** A rota aceita até 20 jobs sem dedupe, `createPublishJobs` não checa job aberto e o worker roda com `concurrency: 2`. Dois jobs do mesmo produto podem fazer o `GET /products/sku/{sku}` antes de o primeiro POST concluir e ambos criam anúncio.
4. **O escritor não envia imagem, categoria nem atributos.** O checklist exige capa, categoria de canal e atributos verdes; o `POST /products` da Nuvemshop envia apenas nome, `published`, preço, SKU e estoque. O anúncio publicado não é o anúncio aprovado.

Os itens 1 e 2 são falhas de integridade de dados. O item 3 é risco de duplicidade em loja real. O item 4 é bloqueio de negócio: publicar sem capa/categoria não serve para piloto.

**Ressalva de escopo:** o piloto com `LIVE_PUBLISH_ALLOWLIST` reduz o universo, mas não elimina nenhum dos quatro bloqueios — todos ocorrem dentro do SKU permitido.

**Além do código:** a preparação operacional apontada na auditoria anterior continua pendente (`hub_categories` e `channel_category_maps` da Nuvemshop vazios, senha inicial dos 2 revisores fiscais, NCM dos SKUs do piloto). Corrigir os P0 de código não dispensa o item 7 do checklist. `MERCADO_LIVRE_ACTIVE` permanece `false` e o ML segue como stub, então não há risco de escrita no ML nesta flag.

---

## 2. Evidência de execução

| Verificação | Comando | Resultado |
|---|---|---|
| Testes | `npm test` (redirecionado para log, sem pipe) | **51/51 arquivos, 185/185 testes, exit 0** |
| Typecheck | `npm run typecheck` (API + web) | **exit 0**, sem erros |
| Constraint `image_processing_queue` | `pg-mem`: `CHECK (source_platform IN ('bling','mercadolivre','nuvemshop'))` + `INSERT 'erp'` | `ERRO: check constraint ... is violated by some row`; `INSERT 'bling' => OK` |
| Working tree | `git status` | sem alteração em `apps/`; `docs/auditoria-go-live.md` já estava modificado; novos: `.planning/`, `docs/auditoria-delta-go-live-2026-11-13.md` |

**A suíte verde não valida o caminho crítico:** `full-sync.test.ts` não contém `midia`, `imagens`, `imagesToEnqueue` nem `source_platform`. O caminho `'erp'` não tem teste. O mesmo vale para colisão `sugerido` e concorrência de publicação.

---

## 3. Status da auditoria anterior

Legenda: ✅ Corrigido · ⚠️ Parcialmente · ❌ Não corrigido

| Item | Status | Evidência (código + teste) | Observação |
|---|---|---|---|
| **P0-1** Estoque publicável | ✅ | `orchestrator/pipeline.ts:267-290` (`catalogStockFromBalances`); `contracts/mappers.ts` (`computePublishableStockFromBalances`); `catalog/publish-preview.ts:128-135` usa `pv.stock`; `catalog/warehouse-stock.ts:17-40`; testes `stock-split.test.ts` (5) | `stock` soma só `role='seller'` + `include_in_push=true`; `catalog_stock` é exibição. Sem depósito seller o checklist bloqueia (`completeness.ts:143-151`). |
| **P0-2** Bloqueio de duplicidade | ⚠️ | Checklist: `catalog/publish-preview.ts:327-331` + `:395`; worker: `queues/publish-queue.ts:210-214`; `catalog/completeness.ts:152-161`; `publish-queue.test.ts` (8) cobre `vinculado` | Só `link_status='vinculado'` bloqueia. **`sugerido` com `listing_id` real não bloqueia** → ver P0-D2. **Sem teste para o caso `sugerido`.** |
| **P0-3** NCM e imagem pendentes | ✅ | NCM: `engines/nve.ts:384,395` (`pending_approval`), `:480-527` (dois `fiscal_approver` distintos), `phase11.test.ts:135`, `phase3.test.ts:370`; imagem: `queues/enrichment-worker.ts:52-59` (`rights_status='pending'`, `is_cover_eligible=false`), migration `0031_pending-review.ts:8-11`; capa só no IQRE `engines/iqre.ts:383-431`; `image-worker.test.ts` | Implementado. O estado `pending` em si não tem teste dedicado; o IQRE tem. |
| **P0-4** Cadastro rápido | ✅ | Pré-checagem `GET /produtos?codigo=` em `bling-create.test.ts:71-83`; sem `/estoques` em `connectors/bling/bling-erp.ts:634`; POST sem retry em `:322-333`; transação `routes/catalog.ts:745,754`; `SkuAlreadyInErpError` recupera `erp_id` em `:840-852` | Timeout sem ID continua exigindo conferência manual — documentado. |
| **P1-1** Marca d'água de preço | ✅ | `orchestrator/pipeline.ts:59-64,100,122-127,175-179`; `catalog/full-sync.ts:276-283`; `sync-watermark.test.ts` (2) | Preço ausente não zera. **Ressalva:** o guard `stale` protege preço/estoque/snapshot, mas `name`, `brand`, `category`, `catalog_status` e `variant_status` continuam sobrescritos por snapshot antigo (`pipeline.ts:108-121,186-187`). Ver P1-D12. |
| **P1-2** Conflito de vínculo | ✅ | `services/reconciliation.service.ts:120-151` (try/catch em `linkIfMissing`); `reconciliation.test.ts` (7) | Colisão é logada, não aborta o lote. |
| **P1-3** Paginação/lote da reconciliação | ⚠️ | `reconciliation.service.ts:257-271`; lote Nuvemshop `connectors/strategy/nuvemshop-listing.ts:186-221`; capas restritas em `:302-309`; canais ativos `:253` | Funciona, mas o keyset é `mp.id::text > $1 ORDER BY mp.id::text` (`:262,268`), que **não usa o índice da PK**. Com 24k produtos e páginas de 40, cada página faz varredura + ordenação textual. Ver P1-D7. |
| **P1-4** Erro transitório e Store ID | ✅ | `nuvemshop-listing.ts:137-149` (401/429/5xx lançam, 404 é ausência); `:72-125` resolve store id; `nuvemshop-listing.test.ts` (2) | Snapshot só é apagado quando a leitura devolve `null` legítimo (`reconciliation.service.ts:341-346`). |
| **P1-5** Vínculo multi-sinal | ✅ | `connectors/strategy/listing-signals.ts:11-14` (`>= 2` sinais); `reconciliation.service.ts:117-141`; `matching-link.test.ts` | Um sinal grava `sugerido` e abre `matching_queue`; confirmação promove. |
| **P1-6** Cota, filtro e retry do Bling | ✅ | `connectors/bling/bling-http-limit.ts:216-245` (slot atômico no Redis), `:194-213` (penalidade global), cota diária `:180-191`; `bling-erp.ts:322-333`; `bling-http-limit.test.ts` (3) | POST não repete em timeout/5xx. **Ressalva:** Redis fora → `waitLocal()` por processo (`:239-244`), N× o limite global. Ver P1-D6. |
| **P1-7** Transação e retomada da Sync | ✅ | `queues/erp-sync-worker.ts:115-117` (retoma `lastCompletedPage+1`), `:205-233` (só avança em sucesso), `:262-269` (`lockDuration:300_000`), `:280-284` (boot); migration `0033_snapshot-upsert.ts`; `erp-sync-queue.test.ts` (3), `phase12.test.ts` | **Ressalva:** falha de `pullCatalogProduct` por produto é engolida e a página avança (`full-sync.ts:422-425`); o produto só volta no próximo Full Sync. Ver P1-D11. |
| **P1-8** Escritor e fila de publicação | ⚠️ | Draft reconstruído em `queues/publish-queue.ts:224`; vínculo transacional `:152-172`; reuso de SKU `nuvemshop-publish.ts:53-60`; retry 429/5xx `:14-16`, `publish-queue.ts:249`; `publish-queue.test.ts` (8) | Sem idempotência sob concorrência (`sugerido` + jobs paralelos) e sem imagens/categoria/atributos no payload. Ver P0-D2/D3/D4. |
| **P1-9** Isolamento do ERP | ⚠️ | `architecture.test.ts` verde; `ACTIVE_ERP`/`activeErpConnector()`; `rate-limit-port.ts`; erros neutros em `strategy/types.ts` | O teste **ignora `__tests__/` e `scripts/`** (`architecture.test.ts:28-29`). O isolamento de `src/` é real, mas a garantia anunciada é mais fraca do que “100%”. Ver P1-D10. |
| **P1-10** Status visual e canais na Home | ✅ | `routes/catalog.ts:270-291` (`statusLabel` Conectado/Pausado + `linkedCount`), `:307` (`totalVariants`); `apps/web/src/app/page.tsx:301-316,510-511,614-641`; `reconciliation.test.ts:221-231` | Separa conexão de vínculos e mostra variações. |
| **P2.1–P2.8** Resiliência/observabilidade | ✅ | `dead-letters.ts`; `backoff.ts`; `quota-pause.ts`; `publish-preview.ts:293-403`; migration `0033`; `nuvemshop-http.ts:118-140`; `metrics.ts:8,80-87,118-148`; `stuck-publish.ts:4-25`; testes `dead-letters`, `backoff`, `queue-metrics`, `stuck-publish` | Entregue. **Ressalvas:** replay de carta morta roda inline no HTTP (`dead-letters.ts:82-90`); jitter pode sortear 1 ms (`backoff.ts:19`). Ver P1-D8/D9. |
| **Etapa 3** Allowlist e pânico | ✅ | `publish-queue.ts:38-39` (`LIVE_PUBLISH_ALLOWLIST`), `:198,220`; `routes/users-admin.ts:384-392`; `publish-queue.test.ts:408-417,475-598` | Lista vazia não publica; pausa aplicada no worker. |
| **Etapa 4** Gestão de estoque | ❌ | Sem leitura de pedidos; sem alertas de saldo virtual negativo/ruptura/capital parado | Fora do escopo do piloto de publicação, mas continua aberto. |

---

## 4. Novos achados críticos (P0)

### P0-D1 — `image_processing_queue.source_platform='erp'` viola CHECK e quebra o Full Sync de produtos com imagem

**Arquivos/linhas**
- `apps/api/src/catalog/full-sync.ts:150-158` — `imageCandidates()` devolve `{ source_url, source_platform: 'erp' }`.
- `apps/api/src/orchestrator/pipeline.ts:497-505` — `runFullProductCatalogPipeline` chama `enqueueProductImagesForSync(masterProductId, imagesToEnqueue)`.
- `apps/api/src/engines/iqre.ts:244-256` — `INSERT INTO image_processing_queue (... source_platform ...) VALUES (..., $5, ...)`.
- `apps/api/src/db/migrations/1729080000006_images-and-queues.ts:37` — `CHECK (source_platform IN ('bling', 'mercadolivre', 'nuvemshop'))`.
- `apps/api/src/db/migrations/1729080000026_erp-identity.ts:44-47` — amplia **somente** `product_images`; não toca a fila.
- `apps/api/src/db/migrations/1729080000031_pending-review.ts` — também não toca a fila.

**Mecanismo**
1. `upsertCatalogProduct` roda em transação própria (`pipeline.ts:95-257`) e **comita o produto**.
2. Em seguida, `enqueueProductImagesForSync` abre outra transação (`iqre.ts:262-263`).
3. O `INSERT` com `'erp'` viola o CHECK e aborta a transação.
4. `runFullProductCatalogPipeline` lança; `full-sync.ts:454-456` captura por produto, faz `note(...)` e **não incrementa `report.upserted`**.
5. Como o `throw` acontece antes de `savedIds.push` (`full-sync.ts:447-453`), o produto **não entra no bloco de score** — nem `hooks.scoreProduct` (`:447-451`), nem o recálculo de `savedIds` (`:459-476`) — e a imagem nunca entra na fila; a capa nunca é elegível; o checklist nunca fica 100%; o auto-publish nunca dispara.

**Impacto**
- Em produção, todo produto do Bling com pelo menos uma imagem cujo link passe em `isAllowedImageHost(link, 'erp')` cai nesse caminho.
- O relatório do Full Sync subconta `upserted` e enche `failed`, mas o produto já está no banco — inconsistência silenciosa.
- É **regressão direta** da refatoração “ERP soberano + S3/imagens”: `product_images` foi ampliada para `'erp'`, a fila não.

**Prova**
- Constraint declarada em `0006:37`; nenhuma migration posterior altera `image_processing_queue`.
- `pg-mem` reproduziu a semântica: `INSERT 'erp' => ERRO: check constraint ... is violated by some row`; `INSERT 'bling' => OK`.
- `full-sync.test.ts` não contém `midia`, `imagens`, `imagesToEnqueue` nem `'erp'` — o caminho não é testado.

**Correção mínima**
- Migration ampliando o CHECK da fila para `('bling','erp','mercadolivre','nuvemshop')` **ou** normalizar o candidato do Full Sync para `'bling'` (menos correto semanticamente, mas elimina a regressão).
- Teste de regressão: payload com `midia.imagens.internas[]`, rodar `runFullProductCatalogPipeline`, assertar 1 linha em `image_processing_queue` e `enqueuedImagesCount=1`.

---

### P0-D2 — Vínculo `sugerido` não bloqueia `CREATE`; o `commit` colide e deixa anúncio órfão na Nuvemshop

**Arquivos/linhas**
- `apps/api/src/catalog/publish-preview.ts:216-229` — `linkedListingExternalId` filtra `link_status='vinculado'`.
- `apps/api/src/catalog/publish-preview.ts:327-331` — checklist carrega só `link_status='vinculado'`.
- `apps/api/src/services/reconciliation.service.ts:136-141` — insere `sugerido` **com `listing_id` real** quando há um único sinal.
- `apps/api/src/queues/publish-queue.ts:210-214` — sem externalId, o worker segue para o POST.
- `apps/api/src/queues/publish-queue.ts:239-244` — `createListing` e depois `commitCreatedListing`.
- `apps/api/src/queues/publish-queue.ts:159-164` — `INSERT INTO channel_listing_links` sem `ON CONFLICT`.
- `apps/api/src/db/migrations/1729080000019_channel-listing-links.ts:14` — `UNIQUE (product_id, channel)`.

**Mecanismo**
1. A reconciliação encontra anúncio com SKU igual, mas EAN/título divergente → `linkStatusFromSignals` devolve `sugerido` (`listing-signals.ts:12-13`) e grava a linha com `listing_id` verdadeiro.
2. Checklist e worker não veem `vinculado` → `existingListingId=null` → `CREATE` liberado.
3. `createNuvemshopListing` faz `GET /products/sku/{sku}` (`nuvemshop-publish.ts:53-60`):
   - **Se achar o anúncio existente:** devolve `{ reason: 'ja_existia', externalId }`. `processPublishQueueItem` chama `commitCreatedListing` mesmo assim (`publish-queue.ts:239-244`) → o `INSERT` colide com a linha `sugerido` → 23505 → carta morta. **Não duplica o POST, mas também não promove o vínculo.**
   - **Se não achar (consistência eventual):** POSTa de novo → **duplicata**; o `commit` colide do mesmo jeito.
4. `commitCreatedListing` tenta `INSERT` e bate em `UNIQUE (product_id, channel)` → 23505.
5. O catch (`publish-queue.ts:245-254`) não é retryable → `UnrecoverableError` → carta morta. O anúncio recém-criado fica **sem vínculo** e o produto continua “Criar” para sempre.

**Impacto**
- Duplicidade em loja real quando o lookup falha; em qualquer cenário, o vínculo `sugerido` nunca é promovido e o job morre em carta morta.
- É o edge case exato que o P0-2 anterior não cobriu: “vinculado” ≠ “existe anúncio”.

**Correção mínima**
- Checklist/worker devem tratar `sugerido` com `listing_id` como anúncio existente: bloquear `CREATE` e oferecer “Vincular/Atualizar”.
- `commitCreatedListing` deve fazer `ON CONFLICT (product_id, channel) DO UPDATE` apenas quando `link_status='sugerido'`, promovendo a `vinculado`; se a linha existente já for `vinculado`, abortar antes do POST.
- Teste: reconciliar com 1 sinal → tentar publicar → assertar 0 POSTs e item bloqueado.

---

### P0-D3 — Publicação sem serialização/dedupe por `(produto, canal)`; dois jobs criam dois anúncios

**Arquivos/linhas**
- `apps/api/src/routes/publish-queue.ts:10-37` — aceita 1..20 jobs, sem idempotency key.
- `apps/api/src/queues/publish-queue.ts:257-315` — `enqueueReadyProducts`/`enqueueCheckedJobs` não checam job aberto.
- `apps/api/src/queues/publish-queue.ts:317-345` — `createPublishJobs` insere sempre.
- Contraste: `apps/api/src/catalog/publish-preview.ts:177-183` — `enqueueAutoPublish` **faz** a checagem de `pending/processing`. O caminho manual não.
- `apps/api/src/db/migrations/1729080000017_publish-queue.ts:4-17` — nenhuma unicidade em `(product_id, channel, status)`.
- `apps/api/src/queues/publish-queue.ts:365` — `concurrency: 2`.
- `apps/api/src/queues/publish-queue.ts:199` — `mark(id,'processing')` sem guarda de estado.

**Mecanismo**
1. Duas requisições (duplo clique, retry do cliente, dois operadores, dois jobs manuais) inserem duas linhas `pending` para o mesmo produto/canal.
2. Com `concurrency: 2`, os dois workers executam em paralelo.
3. Ambos leem `linkedListingExternalId` antes de qualquer POST → ambos recebem `null`.
4. Ambos chamam `GET /products/sku/{sku}`; se o anúncio ainda não existe (ou a loja tem consistência eventual), ambos recebem `null`.
5. Ambos POSTam → **dois anúncios**.
6. O segundo `commit` colide em `UNIQUE (product_id, channel)` → `UnrecoverableError` → órfão (mesmo padrão do P0-D2).

**Impacto**
- Duplicidade real sob concorrência, sem depender de `sugerido`.
- O `attempts:5` não protege: a duplicata nasce de dois jobs distintos, não de retry do mesmo.

**Correção mínima**
- Índice parcial: `CREATE UNIQUE INDEX ... ON publish_queue (product_id, channel) WHERE status IN ('pending','processing')`.
- `createPublishJobs` deve fazer `ON CONFLICT DO NOTHING` e devolver o job existente.
- Worker deve adquirir advisory lock por `(product_id, channel)` (`pg_advisory_xact_lock`) e revalidar o vínculo **depois** do lock, imediatamente antes do POST.
- `mark(processing)` deve ser condicional (`WHERE id=$1 AND status='pending'`) e o worker deve abortar se `rowCount=0`.
- Teste: dois `processPublishQueueItem` em paralelo para o mesmo produto → exatamente 1 POST e 1 vínculo.

---

### P0-D4 — O escritor da Nuvemshop não envia imagem, categoria nem atributos

**Arquivos/linhas**
- `apps/api/src/connectors/strategy/nuvemshop-publish.ts:27-41` — `productBody` envia apenas `name`, `published`, `variants[{price, sku, stock_management, stock}]`.
- `apps/api/src/queues/publish-queue.ts:140-150` — `ListingDraft` carrega `title, price, stock, attributes`.
- `apps/api/src/catalog/publish-preview.ts:130-141` — o preview calcula `category_id` e `attributes`, mas o draft não leva `category_id`.
- `apps/api/src/catalog/publish-preview.ts:381-398` — o checklist exige `hasCoverImage`, `green` de categoria/atributos.
- `apps/api/src/connectors/strategy/marketplaces.ts:67` — ML ainda é stub com `images: []`.

**Mecanismo**
- O checklist só fica verde se houver capa elegível (`is_cover_eligible=true`), categoria mapeada e atributos completos.
- O payload real ignora tudo isso. Não há upload de imagem em nenhum caminho do escritor: `nuvemshop-publish.ts` não referencia `images`; não existe chamada a `POST /products/{id}/images` no código.
- O resultado é um produto publicado sem capa, sem categoria e sem atributos — aceito pela API, mas inútil para a loja.

**Impacto**
- O piloto publicaria anúncios incompletos, contrariando o próprio gate.
- Como o checklist já exige capa, o produto só chega aqui depois de o IQRE processar; o esforço é descartado no POST.

**Correção mínima**
- Após criar o produto, subir as imagens (`POST /2025-03/{store}/products/{id}/images` com URL pública ou multipart) na ordem de posição, usando a capa como primeira.
- Enviar `categories` (id do canal) e `attributes` no body.
- Teste de contrato: draft com capa + categoria + 2 atributos → body do POST contém `images[0]`, `categories[0]` e `attributes`.

### Superfície de mídia (`/api/media/:sha256`) — sem achado de traversal

Verificado e **aprovado**:
- `apps/api/src/routes/media.ts:7` — `SAFE_MEDIA_FILENAME = /^([0-9a-f]{64})\.(jpg|jpeg|png|webp)$/`.
- `:52-57` — nome fora do regex devolve 404 **antes** de qualquer acesso ao disco.
- `:64-65` — o caminho é sempre `path.join(dir, candidate)`, com `candidate` montado a partir do hash hex capturado e de extensões fixas (`:60-62`). Não há `..`, barra ou segmento controlado pelo usuário.
- `:68-69` — `Content-Type` derivado da extensão real do arquivo e `Cache-Control: public, max-age=31536000, immutable`.
- O `sha256` é calculado no worker a partir do buffer baixado (`iqre.ts:352-355`), não é confiado de entrada externa.

**Risco residual (P2):** a rota aceita `.jpg` e serve um `.webp`/`.png` com a mesma hash se o `.jpg` não existir (`:60-62`). Não é traversal, mas a URL imutável pode apontar para formato diferente do sufixo. Sem impacto de segurança; apenas cache/CDN semantics.

---

## 5. Testes de caos (análise estática)

### 5.1 Bling retorna 500 no meio do Full Sync — retoma da página correta?

**Depende do tipo de 500.**

- **Falha na listagem da página** (`erp.listCatalogPage`): `runFullCatalogSync` captura em `full-sync.ts:494-497`, marca `status='failed'`; `erp-sync-worker.ts:190-203` lança e **não** grava `last_completed_page`. BullMQ retenta com jitter; na última tentativa vira carta morta. `enqueueErpSync` retoma de `lastCompletedPage+1` mesmo com status `failed` (`:115-117`), e o boot retoma se `processing` (`:282-284`). **Retoma corretamente.**
- **Falha no `pullCatalogProduct` de um produto**: capturada em `full-sync.ts:422-425` (`recordSyncFailure` + `note`), a página continua e é marcada completa. O cursor avança e **aquele produto não é retentado** até um novo Full Sync. **Perde o item no ciclo.**
- Reexecutar a mesma página é seguro: upserts são idempotentes e o estoque tem guarda `isNewerHubSync` (`pipeline.ts:301-313`).

**Conclusão:** retomada de página correta; retry por produto inexistente.

### 5.2 Nuvemshop retorna 429 na publicação — DLQ ou loop infinito?

**DLQ, sem loop.**

- `nuvemshopFetch` serializa e espera o reset (máx. 60 s) antes da chamada (`nuvemshop-http.ts:118-140`).
- `createNuvemshopListing` lança `NuvemshopPublishError(429)`; `isRetryablePublishError` aceita 429/5xx (`nuvemshop-publish.ts:13-16`).
- `processPublishQueueItem` marca `pending`, relança e deixa o BullMQ contar a tentativa (`publish-queue.ts:245-251`), com `attempts:5` e backoff jitter (`:336`).
- Na 5ª, `isFinalQueueAttempt` é verdadeiro, o job falha e o handler grava carta morta (`:367-376`).
- `recordDeadLetter` deduplica por `(queue, payload, status='open')` (`dead-letters.ts:27-45`).

**Conclusão:** sem loop infinito. O risco é o 429 persistente esgotar 5 tentativas e exigir replay manual — comportamento esperado.

### 5.3 Redis cai por 30 s — fail-fast ou continua servindo?

**Continua servindo o catálogo; degrada saúde e limites.**

- Leitura de catálogo é PostgreSQL; a API não depende de Redis para listar/editar (`db/pool.ts`).
- **`/health` pode travar:** o cliente ioredis usa `maxRetriesPerRequest: null` e `lazyConnect` (`lib/redis.ts:18-21`); `checkRedisHealth` faz `await ping()` sem timeout (`:34-42`). Com Redis fora, a promise pode ficar pendente até reconectar; o endpoint não devolve 503 rápido. Orquestrador pode estourar o próprio timeout.
- BullMQ: produtores/workers bloqueiam ou falham; `createPublishJobs` captura a falha de `add` e deixa a linha `pending` (`publish-queue.ts:335-342`) — não perde o job, mas ele não roda até o Redis voltar.
- Limitador do Bling cai para `waitLocal()` por processo (`bling-http-limit.ts:239-244`); com N réplicas, o teto global de ~2,77 req/s vira N×. Risco de 429.
- `nuvemshop-http` idem: relógio local quando o Redis falha (`:100-105`).

**Conclusão:** não é fail-fast; o catálogo continua, mas `/health` não é confiável e a proteção de cota degrada.

### 5.4 Mesmo hash de imagem já processado — deduplica ou insere duplicado?

**Insere duplicado no banco; deduplica parcialmente depois, só dentro do mesmo produto.**

- A fila deduplica por `UNIQUE (master_product_id, url_normalized)` (`0006:47`), não por hash. Duas URLs diferentes com o mesmo conteúdo → **duas linhas**, dois downloads.
- `product_images` também deduplica por `UNIQUE (master_product_id, url_normalized)` (`0006:27`); **não há índice único em `sha256_hash`**. Mesmo hash em URLs distintas → duas linhas.
- O IQRE finaliza por produto e remove duplicatas por Average Hash com Hamming ≤ 5 (`iqre.ts:597,625`), marcando as perdedoras com `is_cover_eligible=false` (`:646-656`).
- Entre produtos diferentes **nunca** deduplica: apenas abre revisão `cross_product_similarity` (`:633-640`).
- O hash de finalização é amostragem de bytes (`image-worker.ts:109-130`), não perceptual; imagens recomprimidas/redimensionadas não colidem.
- No disco, `persistCachedMediaFile` grava uma vez por hash (`routes/media.ts:42-48`).

**Conclusão:** duplicidade lógica no banco e no download; dedupe só intra-produto e pós-download. Sem unique em `sha256_hash`.

### 5.5 Webhook do Bling x Full Sync — ainda se sobrescrevem?

**Não por `updated_at`; a proteção é por `last_bling_sync` + `dataAlteracao`, e é parcial.**

- O webhook grava `last_bling_sync = now()` (relógio do HUB) em `engines/wig.ts:584`.
- O Full Sync compara `changedAt` (campo `dataAlteracao` do Bling) com `last_bling_sync` (`orchestrator/pipeline.ts:94-100`) e, se `stale`, preserva preço, custo, `last_bling_snapshot` e `last_bling_sync` (`:108-127,175-179`).
- Estoque tem o mesmo guard em `applyVariantStockBalancesFromBling` (`pipeline.ts:301-313`).
- **O que ainda sobrescreve:** `name`, `description`, `short_description`, `brand`, `category`, `catalog_status`, `is_active` e `variant_status` são atualizados incondicionalmente (`pipeline.ts:108-121,186-187`). Um Full Sync antigo pode reverter metadados que o webhook acabou de atualizar.
- **Risco de clock skew:** `changedAt` vem do Bling e `last_bling_sync` do HUB. Se o relógio do Bling estiver atrasado, uma alteração genuinamente nova pode ser classificada como `stale` e o preço/estoque novo é ignorado até o próximo ciclo.
- **Não há comparação de `updated_at`** em nenhum dos dois caminhos; `updated_at` é apenas escrito (`now()`), nunca lido como predicado de conflito.

**Conclusão:** a race de preço/estoque do P1-1 está mitigada. A race de metadados e o falso `stale` por skew continuam (P1-D12).

### 5.6 Falha 500 no meio da publicação — reposta ou respeita o `listing_id`?

**Reaproveita o ID se a loja já indexou o anúncio; não é idempotência garantida.**

- Em retry, `createNuvemshopListing` faz `GET /products/sku/{sku}` (`nuvemshop-publish.ts:53-60`). Se a Nuvemshop devolver o produto, retorna `{ reason: 'ja_existia', externalId }` sem segundo POST (`:60`).
- Se a loja ainda não indexou o anúncio do POST anterior (consistência eventual do endpoint de busca), o GET devolve `null` e o worker **POSTa de novo** → duplicata.
- O worker **não** consulta `publish_queue` nem `channel_listing_links` para saber se aquele job já criou um anúncio em uma tentativa anterior; não há chave de idempotência no body nem header.
- Em caso de 500/timeout, `NuvemshopPublishError(5xx)` é retryable (`:13-16`), o item volta para `pending` e o BullMQ retenta até 5 (`publish-queue.ts:245-251`). Na última, carta morta.
- O `listing_id` só é gravado **depois** do POST bem-sucedido (`publish-queue.ts:239-244`), então uma falha entre o POST e o commit deixa o anúncio sem vínculo — exatamente o órfão do P0-D2.

**Conclusão:** a proteção existe, mas depende da visibilidade do anúncio no índice de busca da Nuvemshop. Para o piloto, isso é insuficiente; exige chave de idempotência ou lock/registro “in-flight” antes do POST.

---

## 6. Dívidas técnicas P1 (corrigir em até 30 dias)

| ID | Dívida | Evidência | Risco |
|---|---|---|---|
| **P1-D1** | Allowlist de host do IQRE aceita qualquer `https` com ponto para `bling`/`erp`/`nuvemshop`; hosts de sufixo aceitam `http:` | `engines/iqre.ts:10` (regra declarada) vs `:95-115` (implementação) | SSRF/MITM na busca de imagem; contradiz o próprio header. Exigir allowlist explícita de domínios e `https` sempre. |
| **P1-D2** | Recálculo de completude e `worst_score` fora da transação e sem retry | `queues/enrichment-worker.ts:173-177` (transação) vs `:189-194` (fora); `queues/image-worker.ts:202-213` (catch silencioso); filtro do lote em `enrichment-worker.ts:157-163` | Worker cai entre commit e recálculo → produto excluído do próximo lote → score/capa podem ficar obsoletos até um recálculo manual ou novo evento de imagem; auto-publish não dispara. |
| **P1-D3** | `is_cover_eligible` nunca volta para `false` em re-fetch rebaixado | `iqre.ts:398-408` (upsert não inclui a coluna), `:429-431` (só seta `true`) | Imagem que perdeu qualidade/direitos continua como capa. |
| **P1-D4** | Sem unique em `sha256_hash`; dedupe cross-produto ausente; hash é amostragem de bytes | `0006:27`; `image-worker.ts:109-130`; `iqre.ts:597,625` | Storage e catálogo duplicados; “perceptual” anunciado não é perceptual. |
| **P1-D5** | `/health` pode pendurar com Redis fora | `lib/redis.ts:18-21,34-42` | Orquestrador não recebe 503; restart/alertas falham. Adicionar timeout (`Promise.race`) e `enableOfflineQueue:false`. |
| **P1-D6** | Limitador do Bling cai para limite local por processo | `bling-http-limit.ts:239-244` | N réplicas → N×2,77 req/s → 429 e penalidade global. |
| **P1-D7** | Keyset da reconciliação em `id::text` | `reconciliation.service.ts:262,268` | Varredura + sort textual por página; degrada com 24k+ produtos. Usar `id > $1::uuid` ou cursor composto. |
| **P1-D8** | Jitter pode sortear 1 ms; teto cresce por tentativa mas o piso efetivo é 1 ms | `queues/backoff.ts:19` | Retentativa quase imediata em azar; não é “exponencial” na prática. |
| **P1-D9** | Replay de carta morta executa inline no request HTTP | `queues/dead-letters.ts:82-90` | POST de até 15 s bloqueia a rota; sem timeout de request. Enfileirar e responder 202. |
| **P1-D10** | Teste de arquitetura ignora `__tests__/` e `scripts/` | `__tests__/architecture.test.ts:28-29` | A garantia “0 imports diretos” não cobre scripts operacionais. |
| **P1-D11** | Falha de `pullCatalogProduct` por produto não é retentada | `catalog/full-sync.ts:422-425` | Produto é pulado no ciclo; só volta no próximo Full Sync. Registrar dead letter por produto ou retry no lote. |
| **P1-D12** | Guard `stale` protege preço/estoque, mas não nome/marca/categoria/status | `orchestrator/pipeline.ts:108-121,186-187` vs `:100,122-127` | Snapshot antigo pode sobrescrever metadados mais novos do webhook. Aplicar `CASE WHEN $18 THEN master_products.<campo> ELSE EXCLUDED.<campo> END`. |
| **P1-D13** | `commitCreatedListing` grava `listing_status='Ativo'` fixo e sobrescreve `payload_json` com o draft | `publish-queue.ts:161-170` | Perde o status real do canal e o payload original de auditoria. |
| **P1-D14** | `productBody` não envia `description`/`categories`/`attributes` | `nuvemshop-publish.ts:27-41` | Ver P0-D4; dívida de contrato do escritor. |

---

## 7. Checklist antes de ligar `ENABLE_LIVE_PUBLISHING=true`

Ordem obrigatória; cada item com critério de aceite verificável.

- [ ] **1. Corrigir P0-D1 (fila `'erp'`).** Migration amplia o CHECK ou o Full Sync normaliza para `'bling'`. Aceite: teste com payload real de `midia.imagens` passa; `image_processing_queue` recebe a linha; `enqueuedImagesCount=1`; `report.upserted` incrementa.
- [ ] **2. Corrigir P0-D2 (`sugerido`).** `sugerido` com `listing_id` bloqueia `CREATE` e o `commit` promove a linha em vez de inserir. Aceite: teste de reconciliação com 1 sinal → 0 POSTs; replay não cria órfão.
- [ ] **3. Corrigir P0-D3 (concorrência).** Índice parcial + advisory lock + `mark` condicional + dedupe no `createPublishJobs`. Aceite: teste com dois workers em paralelo → 1 POST, 1 vínculo, 0 cartas mortas.
- [ ] **4. Corrigir P0-D4 (payload).** Upload de imagens + `categories` + `attributes` no `POST`, ou remover esses itens do checklist e registrar a decisão formal. Aceite: contrato do body contém capa/categoria/atributos.
- [ ] **5. Rodar Full Sync em base de staging com 50 produtos reais com imagem.** Aceite: 50/50 com `image_processing_queue`, `product_images` saindo de `pending`, capa elegível e `worst_score` atualizado.
- [ ] **6. Repetir a varredura completa do `erp-sync-queue`** e rodar Reconciliação de Vínculos depois. Aceite: sem produto “Criar” com `sugerido` oculto.
- [ ] **7. Confirmar preparação operacional do piloto:** `hub_categories` + `channel_category_maps` da Nuvemshop, senha dos 2 revisores fiscais trocada, NCM aprovado em duas etapas, capa definida.
- [ ] **8. Piloto de 48 h com ≤ 10 SKUs em `LIVE_PUBLISH_ALLOWLIST`**, `ENABLE_LIVE_PUBLISHING=true` sob supervisão. Critério de abortar: qualquer anúncio duplicado, qualquer produto sem capa, qualquer 23505 em `channel_listing_links`.
- [ ] **9. Pós-piloto:** corrigir P1-D1..D14 e só então abrir o catálogo inteiro. `MERCADO_LIVRE_ACTIVE` continua `false`.

**Não aceitar como evidência de go-live:** “a suíte passou” (185 testes não cobrem P0-D1/D2/D3), “funciona no meu ambiente” ou “o piloto é só 10 SKUs” (os quatro P0 ocorrem dentro de um SKU permitido).

---

## 8. Limites desta auditoria

- **Não** houve inspeção do PostgreSQL/Redis de produção nesta rodada; os achados são de código e de constraint declarada.
- **Não** houve chamada real a Bling/Nuvemshop; os fluxos de 429/500 foram analisados por leitura.
- **Não** houve teste de carga nem concorrência executada; P0-D3 é demonstração lógica a partir da ausência de lock/unique.
- O `pg-mem` é emulação; a prova definitiva é a constraint SQL versionada em `0006:37` e a ausência de migration posterior que a altere.
- O typecheck foi executado nesta rodada; o resultado está registrado no log `C:\Users\DELL\AppData\Local\Temp\opencode\typecheck.log`.

---

## 9. Arquivos-chave citados

| Tema | Arquivo |
|---|---|
| Full Sync / imagens | `apps/api/src/catalog/full-sync.ts`, `apps/api/src/orchestrator/pipeline.ts`, `apps/api/src/engines/iqre.ts` |
| Publicação | `apps/api/src/queues/publish-queue.ts`, `apps/api/src/connectors/strategy/nuvemshop-publish.ts`, `apps/api/src/routes/publish-queue.ts` |
| Checklist / vínculo | `apps/api/src/catalog/publish-preview.ts`, `apps/api/src/catalog/completeness.ts`, `apps/api/src/services/reconciliation.service.ts` |
| Constraints | `apps/api/src/db/migrations/1729080000006_images-and-queues.ts`, `1729080000019_channel-listing-links.ts`, `1729080000026_erp-identity.ts`, `1729080000031_pending-review.ts` |
| Resiliência | `apps/api/src/lib/redis.ts`, `apps/api/src/routes/health.ts`, `apps/api/src/connectors/bling/bling-http-limit.ts`, `apps/api/src/queues/backoff.ts`, `apps/api/src/queues/dead-letters.ts` |
| Testes | `apps/api/src/__tests__/full-sync.test.ts`, `publish-queue.test.ts`, `image-worker.test.ts`, `enrichment-worker.test.ts`, `reconciliation.test.ts`, `architecture.test.ts` |