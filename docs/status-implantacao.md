# Documentação de Implantação — Bling Sync HUB

Data de referência: **22 de outubro de 2026**  
Especificação normativa: [plano-mestre.md](plano-mestre.md)  
Resumo executivo: [descricao.md](descricao.md)  
Registro de revisão e maturidade: [revisao-plano-mestre.md](revisao-plano-mestre.md)

---

## 0. Síntese da Revisão do Plano Mestre (revisão de 22/10/2026)

Revisão de `revisao-plano-mestre.md` concluída nesta data. Conclusões registradas:

1. **Regras fechadas pela revisão — todas implementadas e testadas**: CQS determinístico sem REPLACE em grade A/B, matching multi-sinal (2 sinais fortes, EAN sozinho ≤ 80), webhook com HMAC + INSERT antes do HTTP 200, push por passo sem PUT do produto inteiro, detecção de eco via `hub_writes`, soberania de nome/descrição do Bling em `channel_content_overrides`, dupla confirmação de NCM por 2 usuários com nota de TIPI.
2. **Ajustes incorporados depois — todos cobertos em código**: convivência `bling_native`/`hub` em `channel_sync_owners`, estoque publicado somando apenas depósitos `seller` com `include_in_push`, `product_variants.stock` nascendo `NULL`, `meli_facility` somente leitura, kit como SKU único, preço por loja com `follow_store_price`, alerta `price_below_cost` não-bloqueante, `match_rejections` permanente, `push_jobs_active` excluindo `locked`, família User Product com `family_confidence`, EAN `duplicate` e NCM `conflict` entre variantes, controles administrativos auditados em `control_changes`, OAuth em `oauth_tokens` fora do Redis.
3. **Maturidade da spec: 99/100** (média das 8 áreas — princípios 100, schema 99, motores 100, fluxos 100, contratos 98, auth 98, operação 100, cronograma 100).
4. **Pendências apontadas pela revisão e já encaminhadas na implantação real**: credenciais OAuth dos 3 canais conectadas (`oauth_tokens`), webhooks de produto recebendo eventos reais (Bling e Nuvemshop confirmados em 22/10). Pendências de homologação em aberto:
   - Desmarcar recurso `order`/`orderNF` na assinatura de webhooks do app do Bling (pedidos ficam na integração nativa);
   - Confirmar scope `offline_access` no app do Mercado Livre (token atual não retornou `refresh_token`) e cadastrar a URL de notificação `https://rickety-lash-passive.ngrok-free.dev/webhooks/mercadolivre`;
   - Executar a primeira sincronização de catálogo em modo `shadow` (Passo 7).
5. **Escopo fora do hub confirmado**: pedidos, financeiro, NF-e, frete, serviços (`tipo != 'P'`), margem/comissão, motor de CEST/origem e escrita em `meli_facility`.

---

## 1. O Que Já Foi Estruturado (Arquitetura e Regras Fechadas)

O projeto está estruturado como um **monorepo TypeScript estrito** (`Node.js 20`, sem `any` implícito) dividido em dois workspaces:

- **`apps/api` (`@bling-sync/api`)**: Backend em Express + PostgreSQL 16 (`pg` direto + `node-pg-migrate`) + Redis 7 (`ioredis`) + BullMQ + `hash-wasm` (Argon2id) + `node:crypto` (SHA-256, HMAC-SHA256, AES-256-GCM) + Vitest.
- **`apps/web` (`@bling-sync/web`)**: Frontend administrativo em Next.js 14 + React 18 + Tailwind CSS.
- **Infraestrutura Local (`docker-compose.yml`)**: Containers dedicados para `postgres:16-alpine` (timezone `America/Sao_Paulo`) e `redis:7-alpine` (com persistência AOF e healthchecks).

### Decisões Arquiteturais Estruturadas e Travadas
1. **Soberania de Dados**:
   - **Grupo A (Bling intocável)**: preço de cadastro, preço de loja, custo, estoque do vendedor, composição de kit, NCM, CEST, origem fiscal, unidade, SKU.
   - **Grupo A.5 (GVE — EAN)**: EAN válido do Bling é intocável; EAN externo válido quando Bling está vazio vai para fila de validação humana (`ean_pending_validation`), nunca auto-preenche; EAN repetido entre variantes do mesmo produto marca `ean_status = 'duplicate'`.
   - **Grupo B (CQS — Conteúdo)**: apenas marca, peso e dimensões podem ser enriquecidos no Bling (nascendo em modo `shadow`, com `kill_switch` e teto `max_replaces_per_run`). Nome e descrição do Bling **nunca** recebem texto de marketplace; títulos e descrições por canal vivem em `channel_content_overrides`.
   - **Grupo C (IQRE — Mídia)**: imagens são entidades em `product_images`, processadas de forma assíncrona via `image_processing_queue` (com claim via `FOR UPDATE SKIP LOCKED` no índice parcial `image_processing_queue_claim`) e deduplicadas por Average Hash (64 bits, distância de Hamming $\le 5$) apenas dentro do mesmo `master_product`.
   - **Grupo D (APE — Push Atômico por Passo)**: jobs separados por tipo (`STOCK_PRICE`, `CONTENT`, `CREATE`) e por passo individual de endpoint (sem `PUT` do produto inteiro).
2. **Convivência com a Integração Nativa do Bling**:
   - Controlada por `channel_sync_owners` (`stock_price` nasce `bling_native`; `content` nasce `hub`).
   - Enquanto `stock_price = 'bling_native'`, o hub não atualiza estoque nem preço de anúncios já publicados; apenas no `CREATE` confirmado por humano o hub envia estoque e preço iniciais uma única vez.
   - Desligar a sincronização nativa de estoque/preço no Bling mantém ligada a entrada de pedidos no Bling para que o saldo continue se movendo.
3. **Regras de Estoque e Preço por Loja**:
   - `product_variants.stock` nasce `NULL` (jamais copia `estoque.saldoVirtualTotal` do payload de produto) e guarda exclusivamente a soma de `saldo_virtual` dos depósitos com `role = 'seller'` e `include_in_push = true` após leitura de `GET /estoques/saldos`.
   - O estoque Full do Mercado Livre (`meli_facility`) pertence ao Mercado Livre: o hub lê a versão (`x-version`) e quantidade em `ml_stock_locations`, mas nunca escreve em `meli_facility` (nem zero).
   - Preço de loja (`variant_channel_prices`) vem exclusivamente de `GET /produtos/lojas`. No Mercado Livre (modelo User Product), apenas a condição marcada com `follow_store_price = true` recebe escrita de preço.

---

## 2. O Que Já Foi Implantado e Testado (Fases 0, 0.5 e 1 a 12 — Todas as Fases Concluídas)

| Fase | Escopo | Status | Critério de Saída Validado |
|---|---|---|---|
| **Fase 0** | Monorepo, Docker, Migration 001, Auth Argon2id + Sessão SHA-256, RBAC e Trilha de Controle | **Concluída** | `GET /health` (200/503) + login de dois papéis (`operator` e `fiscal_approver`) + bloqueio 403 cruzado + gravação transacional em `control_changes` (`phase0.test.ts` — 4/4 testes) |
| **Fase 0.5** | 19+ Fixtures Sanitizados (Bling v3, ML Legado/User Product/Full/UPtin, Nuvemshop `inventory_levels`) + Mappers Puros | **Concluída** | Mappers cobrindo simples (`S`), variação (`V`), kit (`E`), variação-kit (`V`+`E`), saldos (`seller` vs `ml_full`), preço de loja, `429` e `product.deleted` + `GET 404/200` (`phase0_5.test.ts` — 9/9 testes) |
| **Fase 1** | Schema Completo do PostgreSQL 16 (Migrations 001 a 012 com `up` e `down`, partições, índices e seeds) | **Concluída** | Subida das 12 migrations (`up`), validação de constraints e índices parciais, geração das 70 partições mensais (14 meses × 5 tabelas) e descida completa (`down`) (`phase1.test.ts` — 4/4 testes) |
| **Fase 2** | Conectores HTTP, Rate Limiter Global do Bling (3 req/s + 120.000/dia) e Renovação Single-Flight de `oauth_tokens` | **Concluída** | Dois jobs concorrentes não passam de 3 req/s e respeitam fila de prioridades; cota diária preserva reserva P1; refresh OAuth é single-flight com rotação criptografada; ML faz retry em 409 com `X-Version` e pula `meli_facility` (`phase2.test.ts` — 5/5 testes) |
| **Fase 3** | Motores Fiscais Puros: **GVE** (GS1 + `duplicate` + fila humana) e **NVE** (`0000.00.00` + `conflict` + dupla confirmação) | **Concluída** | Vetores GS1 (8, 12, 13, 14, Brasil 789/790, ISBN, faixa 200 e placeholders) e NCM `0000.00.00`; EAN repetido entre variantes marca `duplicate` e resolve ao descontinuar; NCM em conflito entre variantes marca `conflict` no pai sem gerar sugestão; dupla confirmação por 2 usuários `fiscal_approver` distintos com nota de TIPI (`phase3.test.ts` — 5/5 testes) |
| **Fase 4** | Motores de Identidade: **PIRE** (pai) e **VIR** (variante e matriz) | **Concluída** | EAN sozinho fica em `suggestion` ($\le 80$); 2 sinais fortes concordantes fazem auto-vínculo (95); EAN compartilhado entre dois produtos cai em `quarantine`; família User Product com sinais em dois pais cai em `quarantine` sem partir a família; `match_rejections` impede novo match; VIR normaliza `comboKey` por aliases (`Medium -> M`), consolida condições por `user_product_id` com trilha `control_changes`, detecta `missing_ml`/`extra_ml` e conta `user_product_seller` não publica `variations` (`phase4.test.ts` — 4/4 testes) |
| **Fase 5** | Motor de Imagens: **IQRE** (fila assíncrona, dedup e direitos) | **Concluída** | A sync apenas enfileira URLs normalizadas em `image_processing_queue`; worker consome via `FOR UPDATE SKIP LOCKED`; falha após 4 tentativas vira `failed` sem bloquear o fechamento; `iqre.finalize` deduplica por Average Hash 64-bit ($\text{Hamming} \le 5$) mantendo maior resolução sem cruzar produtos diferentes; bloqueia `third_party_risk` e valida capa $\ge 500\times500$ e score $\ge 55$ (`phase5.test.ts` — 3/3 testes) |
| **Fase 6** | Motor de Qualidade de Conteúdo: **CQS** (avaliadores, árvore determinística e shadow/live) | **Concluída** | Grade A e Grade B no Bling nunca sofrem `REPLACE` em nenhuma combinação de score; nome e descrição do Bling permanecem intocáveis (`channel_content_overrides` guarda título/descrição de canal); modo `shadow` grava `applied = false` e impede reversão; modo `live` respeita `kill_switch` e `max_replaces_per_run`, grava `hub_writes` e permite reversão via `quality_history` (`phase6.test.ts` — 4/4 testes) |
| **Fase 7** | Motor de Prontidão: **CRE** (3 scores por variante, KPI da pior variante e independência de estoque) | **Concluída** | Passos `stock`, `pause` e `price` (anúncio publicado) seguem sem ler nem depender de `channel_readiness_scores`; calcula scores Bling (70/90), ML (50/75 + categoria verificada em `CREATE`) e Nuvemshop (45/85 com SEO), KPI da pior variante e top 3 melhorias (`phase7.test.ts` — 3/3 testes) |
| **Fase 8** | Guarda de Idempotência de Webhook: **WIG** (HMAC, `INSERT` antes do 200, restart recovery, watermark e eco) | **Concluída** | Assinatura inválida responde 401 sem persistir; assinatura válida grava SHA-256 (64 hex) em `webhook_events` antes do HTTP 200; restart após o 200 recupera e processa sem perda; eco (`hub_writes`), evento atrasado (`stale_watermark`) e conteúdo idêntico ficam `ignored`; lock de 60s atrasa segundo evento em 2s e expira sem travar a fila (`phase8.test.ts` — 3/3 testes) |
| **Fase 9** | Motor de Push Atômico: **APE** (jobs por passo, skip Full, eco do PUT e alerta abaixo do custo) | **Concluída** | Eco do `PUT` concluído em `push_job_steps` não reabre push; anúncio só `meli_facility` (Full) fica `skipped` (`ml_full`) e não recebe `PUT` de estoque; `price` escreve apenas na condição com `follow_store_price = true`; NCM inválido não impede estoque zero nem pausa; preço abaixo do custo abre alerta crítico sem bloquear (`phase9.test.ts` — 3/3 testes) |
| **Fase 10** | Gerenciador de Ciclo de Vida de Dados: **DLM** (TTL, partições, arquivo fiscal 5 anos e lock de réplicas) | **Concluída** | Réplica extra concorrente não duplica limpeza nem arquivamento; limpa registros terminais vencidos preservando `pending`/`queued`/`failed` e `control_changes`; anula `webhook_events.raw_payload` após 30d; move alertas resolvidos ($\ge 90\text{d}$) e histórico fiscal ($\ge 540\text{d}$) para `*_archive` (`phase10.test.ts` — 3/3 testes) |
| **Fase 11** | Matching e Fiscal no Dashboard (`apps/web` e rotas `/api/matching/*` e `/api/fiscal/*`) | **Concluída** | Dois usuários `fiscal_approver` distintos confirmam o mesmo NCM com nota de TIPI via API autenticada (bloqueando `operator` com 403 e auto-revisão na 2ª etapa com 409), além de aprovar EAN na fila GVE e resolver fila de matching (`phase11.test.ts` — 1/1 teste ponta a ponta) |
| **Fase 12** | Ensaio com Recorte Real do Catálogo, Orquestrador (`pipeline.ts`), Replay e Medição de Lag P1 | **Concluída** | Pipeline completo (Mapper $\to$ PIRE/VIR $\to$ NVE/GVE $\to$ CQS $\to$ IQRE $\to$ CRE) validado com simples, variação e kit; lag de estoque P1 ponta a ponta (WIG $\to$ `/estoques/saldos` $\to$ APE) medido abaixo de 2 minutos (`< 120.000 ms`); replay de job `failed` sem repetir passos concluídos (`phase12.test.ts` — 1/1 teste ponta a ponta) |

### Detalhamento dos Módulos Implantados

#### 2.1 Autenticação, Segurança e Controles (`apps/api/src/auth/*` e `apps/api/src/routes/*`)
- **Hash de Senha**: `Argon2id` (`m=19456, t=2, p=1`) via `hash-wasm`.
- **Sessão Opaca**: Cookie `HttpOnly` contendo token aleatório de 32 bytes (`base64url`), gravando apenas o hash `SHA-256` em `sessions.token_hash`.
- **Criptografia de Credenciais OAuth**: `AES-256-GCM` (`encryptOAuthToken` / `decryptOAuthToken`) para armazenamento binário (`bytea`) em `oauth_tokens`, nunca no Redis.
- **RBAC de 3 Papéis**: `operator`, `fiscal_approver` e `admin` verificados pelo middleware `requireRole(...)`.
- **Rotas Administrativas Auditadas**: `PUT /admin/controls/warehouses/:warehouseId` e `PUT /admin/controls/sync-owner/:platform` exigem papel `admin` (retornam `403` para `operator` e `fiscal_approver`) e gravam obrigatoriamente o histórico em `control_changes` na mesma transação.

#### 2.2 Contratos de API e Mappers (`apps/api/src/contracts/*`)
- **Fixtures Sanitizados**:
  - `fixtures/bling.fixtures.ts`: Produto simples (`S`), grade (`V`), kit (`E`), variação-kit (`V`+`E`), saldos de depósitos (`seller` e `ml_full`), vínculo de preço por loja (`/produtos/lojas`), webhooks (`stock.updated`, `virtual_stock.updated` com `vinculoComplexo`, `product.updated` com `situacao` `I` e `E`, `product.deleted` + `GET 404` / `GET 200`) e erro `429`.
  - `fixtures/mercadolivre.fixtures.ts`: Item legado com `variations`, família User Product (`family_id`, dois `user_product_id`, duas condições de venda para a mesma variante), estoque distribuído (`meli_facility` vs `seller_warehouse` com header `x-version`), item legado Full (`inventory_id`) e webhook de migração `UPtin`.
  - `fixtures/nuvemshop.fixtures.ts`: Produto com variantes, `inventory_levels` por `location_id` e webhook `product/updated`.
- **Mappers Puros (`mappers.ts`)**:
  - `mapBlingProductToCatalog`, `computePublishableStockFromBalances`, `resolveVariantChannelPrice`, `resolveBlingLifecycleSignal`, `classifyApiHttpError`, `mapMercadoLivreListingGroup`, `mapMercadoLivreStockLocations`, `applyMlUptinMigration` e `mapNuvemshopProduct`.

#### 2.3 Banco de Dados — As 12 Migrations (`apps/api/src/db/migrations/*`)
1. `1729080000001_identity-and-controls.ts`: `users`, `user_roles`, `sessions`, `oauth_tokens`, `stock_warehouses`, `channel_stores`, `channel_sync_owners`, `enrichment_controls`, `control_changes` (com trigger de imutabilidade), `sync_cursors`, `hub_writes`.
2. `1729080000002_products-variants-and-axes.ts`: `master_products`, `product_variants` (com índice único parcial `uq_one_default_variant`), `product_components`, `variant_stock_balances`, `variant_channel_prices`, `attribute_axes`, `product_axes`, `attribute_value_aliases`, `variant_attributes`.
3. `1729080000003_platform-links-and-matching.ts`: `platform_links` (com constraint `family_confidence` para `user_product`), `platform_variant_links`, `ml_selling_conditions`, `ml_stock_locations`, `platform_items`, `matching_queue`, `match_rejections`, `variant_matrix_analysis`.
4. `1729080000004_fiscal-overrides-and-archives.ts`: `ean_pending_validation`, `ean_validation_history`, `ean_validation_history_archive`, `ncm_manual_suggestions` (com constraint `second_review_by <> first_review_by` e nota de TIPI obrigatória), `ncm_divergence_alerts`, `ncm_audit_log`, `ncm_audit_log_archive`, `divergence_alerts`, `divergence_alerts_archive`, `channel_content_overrides` + triggers de imutabilidade nas tabelas fiscais e `*_archive`.
5. `1729080000005_enrichment-staging-and-categories.ts`: `enrichment_staging`, `enrichment_suggestions`, `quality_history` (particionada), `product_category_mappings`.
6. `1729080000006_images-and-queues.ts`: `product_images`, `image_processing_queue` (com índice parcial `image_processing_queue_claim`), `image_rights_review_queue`, `platform_image_limits`.
7. `1729080000007_push-jobs-and-windows.ts`: `pending_product_changes`, `aggregation_windows`, `push_jobs` (com índice único parcial `push_jobs_active` cobrindo `status = 'pending'`), `push_job_steps`, `push_execution_logs` (particionada).
8. `1729080000008_webhooks-watermarks-and-sync-logs.ts`: `webhook_events`, `field_watermarks`, `resource_locks`, `sync_logs` (particionada).
9. `1729080000009_readiness-scores-and-history.ts`: `channel_readiness_scores`, `channel_readiness_history` (particionada), `identity_resolution_logs` (particionada).
10. `1729080000010_dlm-policies-and-runs.ts`: `dlm_retention_policies`, `dlm_job_runs`.
11. `1729080000011_indexes.ts`: 15 índices operacionais de busca e fila.
12. `1729080000012_partitions-and-seeds.ts`: 70 partições mensais (14 meses para as 5 tabelas particionadas) + seeds iniciais (`attribute_axes`, `attribute_value_aliases`, `platform_image_limits`, `dlm_retention_policies`, `channel_sync_owners`, `enrichment_controls`, `stock_warehouses`, `channel_stores`).

#### 2.4 Conectores, Rate Limiter Global e OAuth Single-Flight (`apps/api/src/connectors/*`)
- **`bling-rate-limiter.ts`**: Balde único de 3 req/s com fila ordenada por prioridade (`token` > `webhook_p1_push_stock` > `stock_sync` > `price_check` > `delta_enrich` > `full_enrich`), proteção de 20 req/60s em `/oauth/token` e repartição da cota diária de 120.000 chamadas (`full_enrich` pausa em 96.000; jobs não-P1 param em 108.000 preservando 12.000 chamadas para P1/webhook/push).
- **`oauth-token-manager.ts`**: Persistência em `oauth_tokens` com `AES-256-GCM` e renovação single-flight (promessa compartilhada em memória + lock transacional `SELECT ... FOR UPDATE` no PostgreSQL com rotação atômica de `access_token_enc` e `refresh_token_enc`).
- **`connectors.ts`**:
  - `BlingConnector`: todas as chamadas passam pelo `BlingRateLimiter`, recupera de `401` via refresh single-flight, respeita `Retry-After` em `429`, grava `hub_writes` em `applyToBling` e salva cursores em `sync_cursors`.
  - `MercadoLivreConnector`: lê `GET /user-products/{id}/stock` capturando `x-version`, pula escrita quando o anúncio só possui `meli_facility` (`reason = 'ml_full'`), escreve apenas em `/user-products/{id}/stock/type/seller_warehouse` com `X-Version` e faz 1 retry relendo `x-version` em caso de `409 Conflict`.
  - `NuvemshopConnector`: envia medidas isoladas via `PATCH /{storeId}/products/{productId}/variants` sem enviar `price` nem `stock`.

#### 2.5 Motores Fiscais Puros — GVE e NVE (`apps/api/src/engines/gve.ts` e `apps/api/src/engines/nve.ts`)
- **`gve.ts` (GTIN/EAN Validation Engine)**:
  - `validateGs1Gtin`: validação estrutural de 8, 12, 13 e 14 dígitos com módulo 10 (pesos 3/1 da direita), rejeição de dígitos repetidos e sequências aritméticas, e classificação contextual (`gs1_brasil` 789/790, `isbn_issn` 977/978/979, `internal_range` 200–299, `gs1_international`).
  - `evaluateProductGve`: avalia todas as variantes não descontinuadas do produto pai, marca `ean_status = 'duplicate'` e `fiscal_risk_flag = true` apenas nas variantes que compartilham o mesmo EAN válido dentro do mesmo pai (sem abrir `ean_pending_validation` e gerando 1 único alerta aberto por produto e EAN), resolve automaticamente quando resta apenas 1 variante ativa com aquele EAN, e enfileira candidatos externos válidos em `ean_pending_validation` (TTL 30 dias) quando o Bling está vazio.
- **`nve.ts` (NCM Validation Engine)**:
  - `validateNcmCode` e `formatNcmDisplay`: limpeza de pontos/espaços/hífens, verificação de 8 dígitos numéricos, rejeição de códigos truncados do ML (< 8 dígitos) e placeholders (`00000000`, `12345678`, etc.), validação de capítulo TIPI (`01` a `97`) e formatação `0000.00.00`.
  - `evaluateProductNve`: detecta conflito de NCM entre variantes não descontinuadas antes de qualquer sugestão (`ncm_status = 'conflict'` e `ncm_fiscal_risk = true` no pai, sem criar sugestão e abrindo 1 alerta `variant_conflict` por produto), limpa `conflict` quando a divergência entre variantes some (mantendo `ncm_fiscal_risk = true` se o NCM do pai for inválido) e abre sugestão `pending_first` quando o Bling está vazio e o canal traz NCM de 8 dígitos válido.
  - `confirmNcmSuggestionStep`: fluxo de dupla confirmação por dois usuários `fiscal_approver` distintos (`second_review_by <> first_review_by`) com nota de consulta à TIPI obrigatória, atualizando `master_products.ncm` e gravando trilha imutável em `ncm_audit_log`.

#### 2.6 Motores de Identidade — PIRE e VIR (`apps/api/src/engines/pire.ts` e `apps/api/src/engines/vir.ts`)
- **`pire.ts` (Product Identity Resolution Engine)**:
  - `jaroWinklerSimilarity` e `normalizeProductTitleForFuzzy`: normalização com remoção de acentos (`NFD`) e stopwords em português (`de`, `da`, `do`, `com`, `para`, `e`, `o`, `a`, `em`).
  - `resolvePlatformItemPire`: predicado multi-sinal exigindo pelo menos 2 sinais fortes independentes (`sku`, `ean` único com GVE válido e sem `duplicate`, `name_jw_90`) no mesmo candidato e nenhum em outro para `auto_linked` (`score = 95`). Sinal único fica em `suggestion` ($\le 80$). EAN compartilhado entre dois `master_products` distintos cai em `quarantine`. Consulta `match_rejections` antes de avaliar candidatos.
  - `resolveMlUserProductFamilyPire`: agrega sinais fortes de todos os itens da mesma `family_id`. Se itens da família apontarem para pais diferentes, cai em `quarantine` sem partir a família e sem abrir `platform_links`. Se concordarem com $\ge 2$ sinais fortes, vincula com `family_confidence = 95`.
  - `resolveMatchingDecision`: resolução humana (`confirm` com score 100, `reject_candidate` gravando par permanente em `match_rejections`, `dismiss` e `new_product` preenchendo `expires_at` de 60 dias na fila).
- **`vir.ts` (Variant Identity Resolution & Matrix Analysis)**:
  - `normalizeVariantComboKey`: resolve eixos (`attribute_axes`) e aliases (`attribute_value_aliases`, ex: `Medium -> M`) gerando `comboKey` canônico ordenado.
  - `resolveProductVariantsVir`: vincula variantes por produto simples (`is_default`), SKU único, EAN único ou `comboKey`; consolida múltiplas condições de venda sob o mesmo `user_product_id` gravando `ml_selling_conditions` e a trilha obrigatória de `follow_store_price` em `control_changes` (`origin = 'system'`); preenche `variant_matrix_analysis` (`ok`, `missing_ml`, `missing_ns`, `extra_ml`, `extra_ns`) e abre alerta crítico em `extra_ml`/`extra_ns`.
  - `buildMlCreateListingPayload`: garante que contas com a tag `user_product_seller` publiquem com `family_name` e atributos `PARENT_PK`/`CHILD_PK`, sem o array `variations`.

#### 2.7 Motor de Imagens — IQRE (`apps/api/src/engines/iqre.ts`)
- **`enqueueProductImagesForSync`**: enfileira URLs normalizadas em `image_processing_queue` (`stage = 'queued'`) durante a sync sem realizar download síncrono e sem duplicar a mesma URL normalizada para o mesmo `master_product_id`.
- **`processQueuedImagesWorkerBatch`**: consome lotes com `stage = 'queued'`, `locked_at IS NULL` e `available_at <= now()` usando `FOR UPDATE SKIP LOCKED` pelo índice parcial `image_processing_queue_claim`, valida hosts permitidos (Bling, Mercado Livre e Nuvemshop), calcula SHA-256 e Average Hash 64-bit, avalia direitos (`owned`, `third_party_risk`, `watermark_suspect`), calcula `quality_score` (resolução 40, fonte 25, formato 15, direitos 20) e elegibilidade de capa ($\ge 55$ pts, $\ge 500\times500$, sem risco de terceiro nem marca d'água). Falhas retornam a `queued` com backoff até 4 tentativas (`max_attempts = 4`), passando a `failed` sem travar o fechamento do produto.
- **`finalizeProductImagesIqre` (`iqre.finalize`)**: quando não resta nenhuma imagem do produto em `queued`, deduplica exclusivamente dentro do mesmo `master_product_id` (Average Hash com distância de Hamming $\le 5$, mantendo a imagem de maior resolução `width * height`), registra revisão `cross_product_similarity` sem descartar imagens se houver hash parecido em outro produto, e atribui `position_bling`, `position_ml` e `position_ns` respeitando `platform_image_limits`.

#### 2.8 Motor de Qualidade de Conteúdo — CQS (`apps/api/src/engines/cqs.ts`)
- **Avaliadores (`evaluateNameQuality`, `evaluateDescriptionQuality`, `evaluateBrandQuality`, `evaluateWeightQuality`, `evaluateDimensionsQuality`, `evaluateInternalCategoryQuality`)**: pontuam de 0 a 100 (grades `A` 81–100, `B` 61–80, `C` 41–60, `D` 21–40, `F` 0–20), penalizando placeholders, textos curtos (`< 30` caracteres em descrição é `F`), ALL CAPS, sentinelas de peso (`0.001`, `0.01`, `1`, `100`) e dimensão (`1×1×1` ou incompleta).
- **`decideEnrichmentAction`**: implementa a árvore determinística de 7 regras onde a primeira que casar vence, garantindo que **Grade A e Grade B no Bling jamais sofram `REPLACE` automático**.
- **`evaluateAndApplyCqsEnrichment` e `revertCqsQualityHistoryChange`**: protegem `master_products.name` e `description` (gravando título e descrição de canal em `channel_content_overrides`), respeitam `enrichment_controls` (`mode: 'shadow' | 'live'`, `kill_switch`, `max_replaces_per_run`), registram `hub_writes` nas escritas `live` e permitem reverter alterações aplicadas (bloqueando reversão de linhas `shadow`).

#### 2.9 Motor de Prontidão por Canal — CRE (`apps/api/src/engines/cre.ts`)
- **`calculateProductReadinessCre`**: calcula e persiste em `channel_readiness_scores` e `channel_readiness_history` os 3 scores por variante:
  - **Score Bling** (fiscal 45, operacional 35, identificação 20; publicar conteúdo $\ge 70$, premium $\ge 90$).
  - **Score Mercado Livre** (título 25, conteúdo 20, imagens 20, atributos 20, logística 15; publicar conteúdo $\ge 50$, premium $\ge 75$; `CREATE` exige categoria verificada em `product_category_mappings`).
  - **Score Nuvemshop** (conteúdo 35, SEO 25 com `keywords`/`meta_description`/`seo_slug`, imagens 20, conversão 20; publicar conteúdo $\ge 45$, premium $\ge 85$).
  - Calcula o **KPI do produto** como o menor score entre os 3 canais da pior variante ativa e identifica os `blockers` e as **top 3 melhorias** de maior ganho potencial (`top_improvements`).
- **`checkStepReadinessGate`**: garante que os passos `stock`, `pause` e `price` (em anúncio já publicado) **jamais leiam `channel_readiness_scores`** nem dependam de NCM/EAN/score, enquanto os passos de `CONTENT` e `CREATE` exigem vínculo confirmado, regularidade fiscal e score acima do threshold do canal.

#### 2.10 Guarda de Idempotência de Webhook — WIG (`apps/api/src/engines/wig.ts` e `apps/api/src/routes/webhooks.ts`)
- **`verifyWebhookHmacConstantTime` e `ingestWebhookController`**: lê os bytes brutos (`express.raw`) na rota `POST /webhooks/:source`, valida HMAC-SHA256 em tempo constante (`X-Bling-Signature-256`, `x-linkedstore-hmac-sha256` e `x-signature`), retorna `401` sem persistir em caso de assinatura inválida, e grava `webhook_events` com SHA-256 de 64 caracteres (`source:event_type:resource_id:content_hash`) **antes** de responder HTTP `200`.
- **`processWebhookEventById` e `recoverAndProcessPendingWebhooks`**:
  - Adquire lock de 60 segundos em `resource_locks` (atrasando eventos concorrentes em 2s e sobrescrevendo locks vencidos).
  - Descarta com `status = 'ignored'` ecos do próprio hub (`hub_writes` e `push_job_steps` concluídos -> `reason = 'echo'`), serviços (`tipo != 'P'` -> `reason = 'service'`), eventos fora de ordem anteriores ao watermark além de 1s (`reason = 'stale_watermark'`) e payloads sem mudança real (`reason = 'identical_content'`).
  - Grava mudanças pendentes em `pending_product_changes` e registra `sync_logs` com a mesma `idempotency_key`.
  - Recupera automaticamente qualquer evento em `status IN ('received', 'queued')` após reinício do servidor.

#### 2.11 Motor de Push Atômico — APE (`apps/api/src/engines/ape.ts`)
- **`enqueueOrPromotePushJob`**: agrega mudanças por produto, variante, plataforma e `job_kind` (`STOCK_PRICE`, `CONTENT`, `CREATE`) sobre o índice único parcial `push_jobs_active` (`status = 'pending'`), promovendo prioridade (`P1` vence `P2/P3/P4`) sem bloquear janelas futuras quando o job anterior já está `locked`.
- **`executePushJobById`**:
  - Lê o estado atual do Bling no instante da execução e executa apenas passos ainda pendentes (`pause` $\to$ `stock` $\to$ `price` $\to$ `CREATE` $\to$ `description`/`product` $\to$ `measures` $\to$ `pictures`/`images`), sem jamais repetir passo `completed` ou `skipped`.
  - Respeita `channel_sync_owners` (`stock_price = 'bling_native'` deixa passos de `STOCK_PRICE` em `skipped`).
  - Em anúncio só Full (`meli_facility` ou legado `fulfillment`), marca o passo `stock` como `skipped` (`skip_reason = 'ml_full'`) e nunca envia `PUT` de estoque, mantendo o passo `price` apenas na condição marcada com `follow_store_price = true`.
  - Abre alerta crítico `price_below_cost` quando `0 < effectivePrice < cost_price` sem bloquear estoque, pausa, preço nem `CREATE`, e resolve o alerta quando o preço volta a ser $\ge \text{cost\_price}$.
  - No `CREATE`, verifica antes da 1ª chamada se o SKU já existe no canal (cancelando a duplicação e vinculando ao existente); quando cria, envia preço e estoque iniciais uma vez e grava a condição inicial com `follow_store_price = true` e trilha `origin = 'system'` em `control_changes`.

#### 2.12 Gerenciador de Ciclo de Vida de Dados — DLM (`apps/api/src/engines/dlm.ts`)
- **`DLM_BULLMQ_SCHEDULES`**: agenda repetível em `America/Sao_Paulo` (`02:00` limpeza TTL diária, `03:00` dia 1 manutenção de partições, `04:00` domingo arquivamento fiscal, `09:00` dia 1 auditoria de saúde), sem usar `node-cron` em processo.
- **`runDlmTtlCleanup`**: protegido por lock de coordenação entre réplicas (`dlm:job:ttl_cleanup`) e lotes `FOR UPDATE SKIP LOCKED`; limpa `enrichment_staging` (30d), `matching_queue` (60d após status terminal, preservando `pending`), `enrichment_suggestions` (30d), `image_rights_review_queue` (90d), `image_processing_queue` (7d após `done`, preservando `queued` e `failed`), `push_jobs`/`push_job_steps` (7d após status terminal) e anula `webhook_events.raw_payload` após 30d mantendo a chave de idempotência.
- **`runDlmFiscalArchive` e `buildDlmPartitionMaintenancePlan`**: move alertas resolvidos ($\ge 90\text{d}$) para `divergence_alerts_archive` e histórico de EAN ($\ge 540\text{d}$) para `ean_validation_history_archive` (retenção imutável de 5 anos), gera `CREATE`/`DROP` das partições mensais (12 meses para logs operacionais e 3 meses para `identity_resolution_logs`) e grava todas as execuções em `dlm_job_runs`.

#### 2.13 Rotas e Telas Prioritárias do Dashboard — Matching e Fiscal (`apps/api/src/routes/dashboard.ts` e `apps/web/src/app/*`)
- **Rotas HTTP (`dashboard.ts`)**:
  - `GET /api/dashboard/overview`: resumo de conexões OAuth, pior score CRE, contagem de alertas fiscais, preço abaixo do custo e filas pendentes.
  - `GET /api/matching/queue` e `POST /api/matching/resolve`: listagem de sugestões/quarentena/lacunas da matriz e resolução autenticada (`confirm`, `reject_candidate`, `dismiss`, `new_product`).
  - `GET /api/fiscal/ean/pending` e `POST /api/fiscal/ean/:id/review`: aprovação ou rejeição humana de EAN pendente na fila GVE.
  - `GET /api/fiscal/ncm/suggestions` e `POST /api/fiscal/ncm/:suggestionId/confirm`: fluxo autenticado de dupla confirmação de NCM por dois usuários `fiscal_approver` distintos com nota de consulta à TIPI.
- **Telas Next.js (`apps/web/src/app/*`)**:
  - `/` (`page.tsx`), `/matching` (`matching/page.tsx`), `/fiscal/ean` (`fiscal/ean/page.tsx`) e `/fiscal/ncm` (`fiscal/ncm/page.tsx`).

#### 2.14 Orquestrador do Catálogo, Replay e Medição de Lag P1 (`apps/api/src/orchestrator/pipeline.ts`)
- **`runFullProductCatalogPipeline`**: orquestra o ciclo completo da seção 10.1 (upsert Bling com `stock = null` $\to$ saldos de depósito `/estoques/saldos` e preços `/produtos/lojas` $\to$ PIRE/VIR $\to$ NVE/GVE $\to$ CQS $\to$ enfileiramento assíncrono IQRE $\to$ CRE).
- **`executeAndMeasureP1StockFlow`**: executa e mede ponta a ponta o lag de estoque P1 desde o recebimento do webhook no WIG até a conclusão do `STOCK_PRICE` no APE e gravação em `push_execution_logs`, validando o SLA inferior a 2 minutos (`< 120.000 ms`).
- **`replayFailedPushJobById` e `getOperationalMetrics`**: permite replay de jobs `failed` reexecutando apenas passos que falharam (sem repetir passos `completed`) e coleta métricas de profundidade de fila, idade do webhook mais antigo e latência de push.

---

## 3. O Que Falta Implantar (Próximos Passos de Homologação e Expansão de Telas)

Todas as **14 fases da espinha dorsal (Fase 0, Fase 0.5 e Fases 1 a 12)** definidas na Seção 13 do Plano Mestre estão **concluídas e validadas com 52 testes automatizados**. Os próximos passos de evolução contínua são:

1. **Telas Complementares do Dashboard (Seção 12)**: expansão visual das rotas `/produtos`, `/produtos/:id`, `/imagens`, `/variacoes`, `/qualidade`, `/push`, `/webhooks`, `/admin/controles`, `/admin/dlm` e `/admin/aliases` sobre as APIs e motores já implementados.
2. **Homologação com Credenciais de Produção**: conexão das variáveis `.env` reais (`BLING_CLIENT_ID`, `ML_CLIENT_ID`, `NS_CLIENT_ID`) em ambiente Docker Compose e calibração em amostra real do limiar heurístico de marca d'água do IQRE.

---

## 4. O Que Fica de Fora do Escopo (Limites Operacionais)

Conforme definido nas seções 1, 7, 9.2, 10.6 e 10.8 do Plano Mestre, **não entram neste sistema**:

1. **Pedidos de Venda**: o hub não importa nem processa pedidos. A entrada de pedidos permanece na integração nativa dos canais com o Bling para movimentar o saldo de estoque no ERP.
2. **Financeiro e Contas a Pagar/Receber**: permanecem integralmente no Bling.
3. **Emissão de NF-e**: continua sendo emitida pelo Bling a partir do cadastro fiscal soberano do ERP.
4. **Cotação de Frete e Transportadoras**: o hub apenas corrige peso e dimensões da variante (passo `measures` na Nuvemshop), mas não calcula nem cotiza frete.
5. **Serviços (`bling_tipo != 'P'`)**: itens de serviço (`S` ou `N`) são ignorados (`reason = 'service'`) e não entram no catálogo sincronizado.
6. **Cálculo de Margem Líquida / Comissão de Canal**: a verificação de preço abaixo do custo (`price < cost_price`) compara diretamente preço de venda contra `cost_price` da variante para emitir alerta crítico, sem descontar tarifas variáveis de marketplace.
7. **Motor de Validação ou Bloqueio por CEST / Origem Fiscal**: `cest`, `tax_origin` e `requires_cest` são espelhados do Bling para exibição na ficha do produto, mas não bloqueiam push nem disparam alertas de divergência contra o canal.
8. **Escrita de Estoque Full (`meli_facility`) no Mercado Livre**: o saldo Full é gerido pelo Mercado Livre via inbound logístico; o hub jamais escreve quantidade (nem zero) em `meli_facility` e não explode kits (`formato = 'E'`) em anúncios de componentes.

---

## 5. Roteiro Prático Passo a Passo para Continuar a Implantação em Ambiente Real

Siga esta sequência exata para colocar o **Bling Sync HUB** em operação com o seu catálogo real:

### Passo 1 — Subir o PostgreSQL 16 e o Redis 7 (Docker) — **[CONCLUÍDO / ATIVO]**
1. Containers `bling_sync_postgres` (`postgres:16-alpine`, porta `5432`) e `bling_sync_redis` (`redis:7-alpine`, porta `6379`) iniciados e em estado `healthy`:
   ```bash
   docker compose up -d
   docker compose ps
   ```

### Passo 2 — Configurar o Arquivo `.env` e a Chave Criptográfica — **[CONCLUÍDO / ATIVO]**
1. Arquivo `.env` criado a partir de `.env.example` (ignorado pelo Git em `.gitignore`).
2. Chave criptográfica exclusiva de 32 bytes (64 caracteres hex) gerada via `node:crypto` e configurada em `OAUTH_ENCRYPTION_KEY` para criptografia `AES-256-GCM` de `oauth_tokens`.
3. Quando tiver as credenciais de produção das contas, preencha no `.env`:
   - `BLING_CLIENT_ID`, `BLING_CLIENT_SECRET`, `BLING_WEBHOOK_SECRET`
   - `ML_CLIENT_ID`, `ML_CLIENT_SECRET`, `ML_WEBHOOK_SECRET`
   - `NS_CLIENT_ID`, `NS_CLIENT_SECRET`, `NS_WEBHOOK_SECRET`

### Passo 3 — Rodar o Bootstrap do Banco (Migrations 1–12 + 70 Partições + Usuários Iniciais) — **[CONCLUÍDO / ATIVO]**
1. Comando `npm run bootstrap` executado com sucesso no PostgreSQL 16 (`bling_sync_postgres`):
   ```bash
   npm run bootstrap
   ```
2. Aplicadas todas as **12 migrations**, criadas as **70 partições mensais**, registradas as triggers de imutabilidade (`trg_control_changes_immutable`, `trg_ncm_audit_immutable`, `trg_*_archive_immutable`), populados os seeds iniciais e criados os **4 usuários iniciais**:
   - **Admin**: `admin@blingsync.local` (papel `admin`)
   - **Fiscal 1**: `fiscal1@blingsync.local` (papel `fiscal_approver` — 1ª revisão NCM / aprovação de EAN)
   - **Fiscal 2**: `fiscal2@blingsync.local` (papel `fiscal_approver` — 2ª revisão obrigatória de NCM com nota de TIPI)
   - **Operador**: `operador@blingsync.local` (papel `operator` — matching, conteúdo e push manual)

### Passo 4 — Iniciar a API (`apps/api`) e o Dashboard (`apps/web`) — **[CONCLUÍDO / ATIVO]**
1. API Express iniciada em segundo plano na porta `3001` (`npm run dev:api`).
2. Healthcheck validado em `http://localhost:3001/health` retornando HTTP `200`:
   ```json
   {"status":"ok","service":"@bling-sync/api","dependencies":{"postgres":{"ok":true},"redis":{"ok":true}}}
   ```
3. Dashboard Next.js iniciado em segundo plano na porta `3000` (`npm run dev:web` — `http://localhost:3000` respondendo HTTP `200`).

### Passo 5 — Classificar Depósitos e Lojas do Bling (Autenticado como `admin`) — **[CONCLUÍDO / ATIVO]**
1. Token OAuth 2.0 da conta Bling (`JHS`) autenticado, criptografado (`AES-256-GCM`) e salvo em `oauth_tokens`.
2. Descoberta automática (`POST /admin/bling/discover`) executada em `GET /depositos` e `GET /canais-venda` na API v3 do Bling.
3. Depósito real e lojas reais classificados via `admin` com trilha gravada em `control_changes`:
   - **Depósito (`stock_warehouses`)**: `14886768228` — **Geral** (`role = 'seller'`, `include_in_push = true`)
   - **Loja Mercado Livre (`channel_stores`)**: `204990471` — **JHS SHOPPING ML** (`platform = 'mercadolivre'`)
   - **Loja Nuvemshop (`channel_stores`)**: `205681549` — **Nuvemshop** (`platform = 'nuvemshop'`)

### Passo 6 — Configurar os Webhooks nas Três Plataformas — **[TÚNEL HTTPS ATIVO]**
Túnel HTTPS **ngrok com domínio estático** (`rickety-lash-passive.ngrok-free.dev`, fixo por conta) ativo encaminhando para `http://localhost:3001` (substitui o túnel temporário `trycloudflare` de 2026-10-19/20 — `PUBLIC_BASE_URL` mantida no `.env`):
- **Base HTTPS ativa**: `https://rickety-lash-passive.ngrok-free.dev`

Credenciais OAuth cadastradas no `.env`: **Bling** (app JHS, token já autorizado e criptografado em `oauth_tokens`) **Mercado Livre** (app `4952161147502333`, seller `184060242` JHS SHOPPING autorizado — token em `oauth_tokens`; `refresh_token` não retornado, verificar scope `offline_access` no app), e **Nuvemshop** (app `37416`, loja `store_id = 6667412` autorizada — token em `oauth_tokens` e webhooks `product/created|updated|deleted` registrados: ids `40454738/40454739/40454740`).
Rota de callback implementada: `GET /oauth/nuvemshop/callback` troca o `code` por `access_token`, grava criptografado em `oauth_tokens` e, quando `PUBLIC_BASE_URL` está definida, registra automaticamente os webhooks `product/created`, `product/updated` e `product/deleted` apontando para `/webhooks/nuvemshop`.

URLs prontas para colar nos painéis de desenvolvedor:
1. **Bling ERP v3**:
   - **URL do Servidor**: `https://rickety-lash-passive.ngrok-free.dev/webhooks/bling`
   - **Cabeçalho validado**: `X-Bling-Signature-256` (HMAC-SHA256 com `BLING_WEBHOOK_SECRET`, já configurado no `.env`).
   - **Recursos para ativar na aba Webhooks do aplicativo no Bling**: `Produto` (`created`, `updated`, `deleted`), `Estoque` (`stock`) e `Estoque Virtual` (`virtual_stock`). *(Não ativar pedidos nem notas fiscais).*
2. **Mercado Livre**:
   - **URL de Notificação**: `https://rickety-lash-passive.ngrok-free.dev/webhooks/mercadolivre`
   - **Tópicos para assinar**: `items` e `user-products-families` (cabeçalho `x-signature`).
3. **Nuvemshop**:
   - **URL do Webhook** (registrada automaticamente via `POST /{store_id}/webhooks` após o OAuth): `https://rickety-lash-passive.ngrok-free.dev/webhooks/nuvemshop`
   - **Eventos**: `product/created`, `product/updated` e `product/deleted` (cabeçalho `x-linkedstore-hmac-sha256`).
   - Os 3 campos de webhook do cadastro do app no Partners Portal são exclusivos de privacidade/LGPD (`store/redact`, `customer/redact`, `customers/data_request`) e ficam em branco até implementarmos os receptores de privacidade.

### Passo 7 — Operação Inicial em `shadow` e Roteiro Seguro de Virada para `live` / `hub` — **[1ª SYNC REAL EXECUTADA 22/10]**
0. **Primeira sincronização real executada** (`apps/api/src/scripts/shadow-sync.ts`): 15 produtos do Bling importados com variantes e saldos reais (`stock` somando só depósito `seller` 14886768228), 50 anúncios do ML (seller 184060242) e 50 produtos da Nuvemshop (store 6667412) lidos → 0 auto-vínculos, ~100 sugestões em `matching_queue` (regra de 2 sinais fortes), scores CRE calculados, nenhuma escrita externa. Migration 13 (`empty-sku-handling`) corrigiu SKU vazio do Bling colidindo na constraint UNIQUE.
1. **Fase Inicial (`shadow` + `bling_native`)**:
   - O sistema nasce com `enrichment_controls.mode = 'shadow'` e `channel_sync_owners.stock_price = 'bling_native'`.
   - Deixe o primeiro ciclo de leitura/matching rodar: valide os vínculos sugeridos e quarentenas em `/matching`, aprove os EANs externos na fila `/fiscal/ean` e faça a dupla confirmação de NCM com dois usuários `fiscal_approver` em `/fiscal/ncm`.
2. **Ativação do Enriquecimento de Conteúdo (`shadow` $\to$ `live`)**:
   - Quando as sugestões do CQS estiverem validadas, passe `enrichment_controls.mode` para `'live'` (mantendo `max_replaces_per_run = 25` e `kill_switch = false`). Lembre-se de desligar a exportação nativa de título/descrição do Bling para o canal para evitar sobrescrita mútua.
3. **Troca do Dono de Estoque e Preço (`bling_native` $\to$ `hub`)**:
   - **Atenção**: no painel do Bling, desligue **apenas** a sincronização/exportação automática de estoque e preço daquele canal, **mantendo obrigatoriamente ligada a importação de pedidos** no Bling (para que as vendas continuem baixando o saldo virtual no ERP).
   - Confirme que `GET /estoques/saldos` e `GET /produtos/lojas` já preencheram `product_variants.stock` e `variant_channel_prices`.
   - Como `admin`, chame `PUT /admin/controls/sync-owner/mercadolivre` (e/ou `nuvemshop`) enviando `{"stock_price": "hub", "content": "hub"}`. A mudança será gravada em `control_changes` e o **APE** assumirá o envio de estoque e preço P1 (< 2 min).

---

## 6. Evolução do Dashboard (docs/bling_sync_hub_evolucao_dashboard.md) — 28/10/2026

### Implantado
- **Login real**: tela `/login` com sessão por cookie `HttpOnly` (`/auth/login`, `/auth/me`, `/auth/logout`). O seletor de papel simulado foi removido; o menu e as ações respeitam os papéis reais (Operador, Revisor Fiscal, Administrador).
- **Endpoints protegidos**: todas as rotas `/api/dashboard/*` exigem sessão (`401` sem login). Simulação restrita a Operador/Administrador; auditoria restrita a Administrador/Revisor Fiscal (`403` para os demais).
- **8 áreas operacionais** com dados reais do PostgreSQL: Visão Geral, Catálogo e Ficha Única (7 abas), Correspondências, Central de Pendências, Fiscal EAN, Fiscal NCM, Publicações, Qualidade e Margem, Canais e Auditoria. Estados de carregamento, vazio e erro em todas as telas (sem números fictícios).
- **Correspondências (`/matching`)**: fila real (`matching_queue`) com título, SKU, EAN, preço e link do anúncio, comparação com o candidato do Bling e decisões reais via `POST /api/matching/resolve` (confirmar ou rejeitar par em `match_rejections`), inclusive em lote.
- **Fiscal**: aprovação/rejeição real de EAN (somente papel Revisor Fiscal, com validação GS1) e dupla confirmação real de NCM com nota TIPI obrigatória e bloqueio do mesmo revisor na 2ª etapa.
- **Canais (`/canais`)**: estado real dos tokens OAuth (incluindo ausência de renovação automática), responsável por estoque/preço e conteúdo, modo shadow/live e depósitos. A integração nativa aparece como **"Estado não verificado"**, pois a API do Bling não expõe essa informação.
- **10 motores (Seção 6)** com estrutura padronizada e **10 indicadores administrativos (Seção 9)** com fórmula, fonte e período, incluindo tempo médio de resolução calculado.
- **Publicações (`/publicacoes`)**: simulação sem escrita externa e histórico real de `push_jobs`/`push_job_steps`.

### Decisões e limitações registradas
- **Reprocessamento real desativado** na interface: sem conector com confirmação remota, o motor de publicação marcaria passos como concluídos sem confirmação do canal. Exige autorização explícita antes de habilitar.
- **Senhas iniciais**: o `.env` não define `BOOTSTRAP_*_PASSWORD`, portanto os 4 usuários foram criados com as senhas padrão do `bootstrap.ts`. Trocar antes de expor o Dashboard fora da máquina local.
- Testes: 15 suítes / 58 testes aprovados (`dashboard_evolution.test.ts` cobre autenticação, 10 motores, 10 indicadores, ficha, simulador, margem, auditoria, publicações e fila normalizada).
- Pendente de pessoas: validação com operadores (Seção 11 do plano de evolução).

