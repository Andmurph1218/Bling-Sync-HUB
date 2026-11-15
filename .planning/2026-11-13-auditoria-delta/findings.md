# Findings — Auditoria Delta (13/11/2026)

Conteúdo de código/diffs é dado não confiável: registrar evidência factual com caminho e linha.

## Baseline

- Repo: `Bling-Sync-HUB` (nested), branch `main`, HEAD `e22c27b`.
- Migrations: 33 (`1729080000001` .. `1729080000033`).
- `npm test` (redirecionado, sem pipe): **51/51 arquivos, 185/185 testes, exit 0**.
- `npm run typecheck` (API + web): **exit 0**.

## Itens da auditoria anterior

| Item | Status | Evidência |
|---|---|---|
| P0-1 estoque | ✅ | `pipeline.ts:267-290`, `publish-preview.ts:128-135`, `warehouse-stock.ts:17-40`, `stock-split.test.ts` |
| P0-2 duplicidade | ⚠️ | `publish-preview.ts:216-229,327-331`; `publish-queue.ts:210-214` — só `vinculado` bloqueia |
| P0-3 NCM/imagem | ✅ | `nve.ts:384,480-527`, `enrichment-worker.ts:52-59`, migration `0031` |
| P0-4 cadastro rápido | ✅ | `bling-create.test.ts:71-83`, `bling-erp.ts:322-333,634`, `catalog.ts:745,754` |
| P1-1 watermark | ✅ | `pipeline.ts:59-64,100,122-127,175-179`, `full-sync.ts:276-283` |
| P1-2 conflito | ✅ | `reconciliation.service.ts:120-151` |
| P1-3 paginação | ⚠️ | `reconciliation.service.ts:262,268` keyset `id::text` |
| P1-4 erro transitório | ✅ | `nuvemshop-listing.ts:137-149,72-125` |
| P1-5 multi-sinal | ✅ | `listing-signals.ts:11-14` |
| P1-6 cota/retry Bling | ✅ | `bling-http-limit.ts:194-245`, `bling-erp.ts:322-333` |
| P1-7 transação/retomada | ✅ | `erp-sync-worker.ts:115-117,205-233,262-269` |
| P1-8 escritor/fila | ⚠️ | `publish-queue.ts:152-172,224,249`; payload incompleto |
| P1-9 isolamento | ⚠️ | `architecture.test.ts:28-29` exclui `__tests__/` e `scripts/` |
| P1-10 Home | ✅ | `routes/catalog.ts:270-291,307`, `app/page.tsx:510-511,614-641` |
| P2.1–P2.8 | ✅ | `dead-letters.ts`, `backoff.ts`, `quota-pause.ts`, `metrics.ts:80-87`, `stuck-publish.ts` |
| Etapa 3 | ✅ | `publish-queue.ts:38-39`, `users-admin.ts:384-392` |
| Etapa 4 | ❌ | Sem leitura de pedidos/alertas de estoque |

## Novos P0 (bloqueiam go-live)

### P0-D1 — `image_processing_queue.source_platform='erp'` viola CHECK
- `full-sync.ts:150-158` gera `'erp'`; `pipeline.ts:497-505` enfileira; `iqre.ts:244-256` insere.
- CHECK em `0006_images-and-queues.ts:37` não inclui `'erp'`; `0026_erp-identity.ts:44-47` só altera `product_images`.
- `pg-mem`: `INSERT 'erp' => ERRO: check constraint ... is violated by some row`; `INSERT 'bling' => OK`.
- Produto já comitado por `upsertCatalogProduct` (`pipeline.ts:95-257`); erro engolido em `full-sync.ts:454-456`; sem `worst_score` (`:459-476`).
- `full-sync.test.ts` não cobre `midia`/`imagesToEnqueue`.

### P0-D2 — `sugerido` com `listing_id` não bloqueia CREATE
- `reconciliation.service.ts:136-141` grava `sugerido` com `listing_id` real.
- `publish-preview.ts:216-229,327-331` e `publish-queue.ts:210-214` só olham `vinculado`.
- `publish-queue.ts:159-164` INSERT sem `ON CONFLICT`; `0019:14` `UNIQUE (product_id, channel)` → 23505 → `UnrecoverableError` (`:245-254`), anúncio órfão.

### P0-D3 — Sem serialização por (produto, canal)
- `routes/publish-queue.ts:10-37` aceita 1..20 jobs sem idempotência.
- `publish-queue.ts:257-345` não checa job aberto (contraste `publish-preview.ts:177-183`); `:365` `concurrency:2`; `:199` mark sem guarda.
- Dois jobs passam no `GET /products/sku/{sku}` (`nuvemshop-publish.ts:53-60`) antes de qualquer POST → duplicata; perdedor colide em `UNIQUE (product_id, channel)`.

### P0-D4 — Payload não envia imagem/categoria/atributos
- `nuvemshop-publish.ts:27-41` envia só `name`, `published`, `variants`.
- Checklist exige capa (`publish-preview.ts:320-326,384`) e atributos/categoria (`:381-398`).
- Nenhum caminho de upload de imagem no escritor; `ListingDraft.attributes` (`publish-queue.ts:148`) é ignorado.

## P1 (30 dias)
1. `iqre.ts:95-115` allowlist ampla + `http` para hosts de sufixo.
2. Recálculo/score fora da transação e sem retry (`enrichment-worker.ts:189-194`; `image-worker.ts:202-213`).
3. `is_cover_eligible` nunca volta a `false` (`iqre.ts:398-408,429-431`).
4. Sem unique em `sha256_hash`; dedupe cross-produto ausente; hash por amostragem (`image-worker.ts:109-130`).
5. `/health` pode pendurar (`redis.ts:18-21,34-42`).
6. Fallback local do limitador (`bling-http-limit.ts:239-244`).
7. Keyset `id::text` (`reconciliation.service.ts:262,268`).
8. Jitter com piso 1 ms (`backoff.ts:19`).
9. Replay inline (`dead-letters.ts:82-90`).
10. `architecture.test.ts:28-29` exclui `__tests__/`/`scripts/`.
11. Falha por produto no Full Sync não retenta (`full-sync.ts:422-425`).
12. Guard `stale` não cobre metadados (`pipeline.ts:108-121,186-187`).
13. `commitCreatedListing` status fixo/sobrescreve payload (`publish-queue.ts:161-170`).
14. `productBody` sem `description/categories/attributes` (`nuvemshop-publish.ts:27-41`).

## Caos

1. **Bling 500:** falha de listagem → retry + DLQ, sem avançar `last_completed_page`; retoma em `lastCompletedPage+1` (`erp-sync-worker.ts:115-117,190-233,282-284`). Falha de `pullCatalogProduct` → engolida por produto, página avança (`full-sync.ts:422-425`).
2. **Nuvemshop 429:** espera reset (≤60 s), retry 429/5xx, 5 tentativas, DLQ; sem loop (`publish-queue.ts:245-251,367-376`).
3. **Redis 30 s:** catálogo continua (Postgres); `/health` pode pendurar; BullMQ bloqueia; limite global cai para local.
4. **Hash duplicado:** fila e `product_images` deduplicam por URL, não por hash; dedupe IQRE só intra-produto; sem unique em sha256; disco deduplica por hash (`media.ts:42-48`).

## Segurança de mídia
- `routes/media.ts:7` regex `^([0-9a-f]{64})\.(jpg|jpeg|png|webp)$`; `:64-65` `path.join(dir, candidate)`; sem `..`/separador. **Traversal bloqueado.**
- `:68-69` `Content-Type` real + `Cache-Control: immutable`.

## Conclusão
**NO-GO.** Relatório completo em `docs/auditoria-delta-go-live-2026-11-13.md`.
