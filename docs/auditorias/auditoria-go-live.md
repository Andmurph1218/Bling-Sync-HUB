# Auditoria de Go-Live — JH Sync Hub

Auditoria original: 11/11/2026, base `7fcbb49`.  
Última atualização: **13/11/2026** (revisão 3, abaixo). Revisão anterior: **12/11/2026**, produção em `0671858` (`https://hub.jhshopping.com.br`).  
Método: leitura do código da API e da web + conferência somente leitura no PostgreSQL e Redis de produção (`201.79.39.118`, 33 migrations aplicadas).

> ## ✅ Concluído / Resolvido
> **Registro histórico.** As três auditorias abaixo (11/11, 12/11 e revisão 3 de 13/11) estão encerradas. Os P0 e P1 apontados foram corrigidos e verificados; a revisão 3 registra o que ficou como dívida P1 consciente. O estado vigente está em [02-status-e-roadmap.md](../02-status-e-roadmap.md) e a arquitetura em [01-arquitetura.md](../01-arquitetura.md). Nada aqui é pendência.

---

## Revisão 3 — 13/11/2026 (pós-auditoria delta)

Base: `main` em `75f7365`. Verificação local: `npm run typecheck` limpo e `npm test` com **55 suítes / 222 testes aprovados**. Achados de origem em [auditoria-delta-go-live-2026-11-13.md](auditoria-delta-go-live-2026-11-13.md).

### Os 4 P0 da auditoria delta estão resolvidos no código

| ID | Situação | Evidência |
|---|---|---|
| P0-D1 Fila de imagem recusava `source_platform = 'erp'` | **Resolvido** | Migration `0034` amplia o `CHECK`; teste do Full Sync com mídia do ERP. |
| P0-D2 `sugerido` não bloqueava `CREATE` | **Resolvido** | Checklist e worker tratam `sugerido` com `listing_id` como anúncio existente (0 POST); `commitCreatedListing` faz upsert para `vinculado`. |
| P0-D3 Dois jobs criavam dois anúncios | **Resolvido** | Migration `0035` (único parcial em `pending`/`processing`) + reivindicação `UPDATE ... WHERE status = 'pending'`; `publish-queue-concurrency.test.ts`. |
| P0-D4 Escritor sem imagem, categoria e atributos | **Resolvido** | Draft completo (até 3 eixos, todas as variações, `brand`, categoria numérica, capa primeiro) e descrição em HTML sanitizado; contrato em `nuvemshop-product-body.test.ts` e `nuvemshop-draft.test.ts`. |

### Dívidas P1 que continuam abertas

1. **N+1 na criação de anúncio:** antes do `POST`, `findExistingNuvemshopListing` faz até 1 `GET /products/sku/{sku}` por variante (timeout de 5 s cada). Aceito para o piloto; a busca em lote fica para o P1.
2. **Sem `PUT` para anúncio existente:** produto já publicado não recebe atualização de título, descrição, categoria, variação nova ou ordem de imagem. Variação criada no ERP depois da publicação não chega à Nuvemshop.
3. **Imagem reenviada no retry:** a reconciliação compara `src`; se a Nuvemshop reescrever a URL para o CDN, o retry duplica a imagem. P1: mapa `{listing_id, position, sha256}`.
4. **Valor de eixo vazio passa na validação local:** variante sem valor em um eixo vai como `{"pt": ""}`; quem recusa é a Nuvemshop (400), não o HUB.
5. **Limites da Nuvemshop só aparecem no envio real:** mais de 3 eixos e categoria inválida falham no worker em modo real; no modo simulado o job fica `success`. O checklist não verifica esses dois pontos.
6. **Produto encontrado por SKU recebe imagens do HUB:** no caminho `ja_existia`, `syncNuvemshopImages` acrescenta imagens a um anúncio criado fora do HUB.
7. ~~**Acoplamento do núcleo à Nuvemshop**~~ **Resolvido (15/11):** o código foi para `connectors/nuvemshop/`. A fila usa `connector.buildListingDraft` e `isRetryablePublishError`/`ChannelPublishError` de `strategy/types.ts`; a reconciliação usa `connector.createBatchReader`. O `architecture.test.ts` agora cobre Bling, Nuvemshop e Shopee e proíbe qualquer fornecedor em `catalog/`, `queues/`, `engines/`, `orchestrator/` e `services/`. Dívida que sobra: `routes/oauth.ts`, `routes/app-credentials.ts` e a classe legada `connectors/connectors.ts` ainda importam a Nuvemshop direto (allowlist explícita no teste).
8. **P1-D1 a P1-D13 da auditoria delta** (allowlist do IQRE, recálculo fora da transação, capa que não perde elegibilidade, `/health` com Redis fora, `listing_status = 'Ativo'` fixo no commit, entre outros). P1-D14 foi absorvido pelo P0-D4.

### Segurança: chave OAuth rotacionada em 15/11

A conferência no servidor confirmou `OAUTH_ENCRYPTION_KEY` igual à chave padrão publicada em `deploy/remote-deploy.sh`. A rotação foi feita com a API parada: `npm run rotate:oauth-key -- --dry-run` mostrou 5 registros prontos e `--execute` regravou os 5 numa transação, com conferência de cada segredo pela chave nova antes do `COMMIT`. Validação: `GET /produtos` no Bling e `GET /products` na Nuvemshop responderam 200 com os tokens rotacionados; `/health` 200; nenhum erro no `journalctl`.

Atenção: os dumps anteriores (`/root/pre-0035-*.dump`) contêm os segredos cifrados com a chave antiga, que é pública. Apague-os depois de confirmar o piloto, ou trate-os como material sensível.

### Veredito da revisão 3

**Go para o piloto controlado** (até 10 SKUs em `LIVE_PUBLISH_ALLOWLIST`, `ENABLE_LIVE_PUBLISHING=true` sob supervisão), depois de aplicar as migrations `0034` e `0035` na Droplet e confirmar que não há dois jobs abertos para o mesmo produto e canal. **No-Go para o catálogo inteiro** até fechar os itens 1, 2 e 4 acima e concluir o piloto de 48 h.

---

## 1. Veredito agora

**Manter `ENABLE_LIVE_PUBLISHING=false` até preparar o checklist (categoria, capa e NCM) dos SKUs de teste e iniciar o piloto controlado com `LIVE_PUBLISH_ALLOWLIST`.**

O escritor da Nuvemshop está implantado. Com `ENABLE_LIVE_PUBLISHING=true`, somente os SKUs listados em `LIVE_PUBLISH_ALLOWLIST` saem de verdade (lista vazia não publica nenhum item). O botão de pânico em `/configuracoes/geral` pausa a fila imediatamente.

O que ainda resta antes de abrir publicação para o catálogo inteiro:

- **Preparação cadastral dos SKUs do piloto em produção:** os depósitos reais do Bling já estão classificados (`14886768228` e `14888973769`, zero `unclassified`), porém o banco de produção ainda está com `hub_categories = 0` e `channel_category_maps = 0` para Nuvemshop, e `2` usuários iniciais ainda têm `must_change_password = true` (necessário trocar a senha dos dois revisores fiscais para aprovar o NCM dos SKUs do piloto).
- **Escopo de escrita nos canais:** o Mercado Livre permanece desativado (`MERCADO_LIVRE_ACTIVE = false`) e sem `createListing` real; `updateStock` nos dois canais continua recusando escrita (`estoque_na_integracao_nativa`). Não há ainda escritor de atualização de anúncio já publicado na Nuvemshop.
- **Piloto de 48 h:** ainda não iniciado.

---

## 2. Quadro consolidado (alinhado ao código e à produção em `30e088f`)

| Item | Situação | Como está hoje |
|---|---|---|
| P0-1 Estoque publicável | **Implantado e depósitos classificados** | `stock` soma apenas depósitos `seller` com `include_in_push = true`; `catalog_stock` guarda o saldo de exibição. Sem depósito de venda, o checklist bloqueia envio. Depósitos reais do Bling (`14886768228` e `14888973769`) já classificados em produção (zero `unclassified`). |
| P0-2 Não criar anúncio já vinculado | **Implantado** | Checklist e worker bloqueiam `CREATE` quando já existe `listing_id` em `channel_listing_links`. Ainda não há escritor para atualizar anúncio existente. |
| P0-3 NCM e imagem sem validação | **Implantado com ressalva** | NCM importado no enriquecimento nasce `pending_approval` e exige dupla confirmação fiscal em `/fiscal/ncm` (não passa pelo motor automático `NVE`). Imagem entra em `image_processing_queue` com `rights_status = 'pending'` e sem elegibilidade de capa até passar pelo IQRE. |
| P0-4 Cadastro rápido (`+ Produto`) | **Implantado** | Sem `POST /estoques`. `POST /produtos` com timeout não repete. `GET /produtos?codigo=` aborta antes do POST se o SKU já existe no Bling (recuperando o `erp_id` numa segunda tentativa caso a transação local anterior tenha falhado). Timeout sem retorno de ID continua exigindo conferência manual no Bling. |
| P1-1 Marca d'água de preço | **Implantado** | `blingChangedAt` / `isNewerHubSync` impedem o sync de sobrescrever webhook mais recente. Campo `preco` ausente não zera o valor salvo. |
| P1-2 Conflito de vínculo | **Implantado** | Conflito de chave única em `channel_listing_links` é capturado e logado sem abortar `reconcileAll`. |
| P1-3 Paginação e lote da reconciliação | **Implantado** | Cursor keyset por `mp.id` (até `100.000` itens), contagem de capas restrita aos IDs da página, leitura apenas dos canais ativos (`ACTIVE_CATALOG_CHANNELS`) e pré-carga em lote do catálogo da Nuvemshop (`200` produtos/página via `createNuvemshopBatchReader`). Leitura pontual no Bling (`refreshMissingCommerce`) só roda quando há anúncio correspondente e falta preço/estoque. |
| P1-4 Erro transitório e Store ID da Nuvemshop | **Implantado** | Respostas `401`, `429` e `5xx` lançam `NuvemshopListingError` e preservam o retrato em `marketplace_listings_snapshot`; `null` ocorre apenas em `404` ou busca vazia. Timeout de 15 s e sem fallback para `variants[0]`. Descoberta automática do `store_id` (`6667412` validado em `GET /2025-03/{id}/store` e salvo em `sync_cursors`). |
| P1-5 Vínculo por múltiplos sinais | **Implantado** | Dois sinais concordantes (`sku` + `ean` ou título compatível via `collectListingSignals`) gravam `vinculado`. Um único sinal grava `sugerido` e abre item em `/vinculos` (`matching_queue`). Confirmar promove a `vinculado`; recusar remove a sugestão. |
| P1-6 Cota, filtro e retry do Bling | **Implantado** | Agendamento atômico no Redis na chave `bling:rate_limit` (`360 ms` entre chamadas, `<= 2,77 req/s`, zero rajada entre workers, penalidade global compartilhada em `429`) e pausa em 80% da cota diária (`96.000 / 120.000`). Listagem filtra ativos (`tipo=P&criterio=2`, até `5.000` páginas). `GET` respeita `Retry-After` ou backoff exponencial com jitter; `POST` não repete em timeout/`5xx`. |
| P1-7 Transação e retomada da Sync | **Implantado** | Estoque e enriquecimento por produto gravam em transação; `marketplace_listings_snapshot` faz `ON CONFLICT DO UPDATE` (migration 033). Worker `erp-sync-queue` usa `lockDuration = 5 min` (evitando `job stalled` em páginas com 50 itens inéditos ou grades grandes), substitui jobs antigos em `failed`/`completed` ao reenfileirar, não marca `failed` em tentativas intermediárias e retoma `lastCompletedPage + 1` no boot. |
| P1-8 Escritor e fila de publicação | **Implantado na Nuvemshop** | Payload reconstruído na hora da execução, `POST /products` na Nuvemshop, gravação transacional de `listing_id` + status `success`, reaproveitamento de ID se o SKU já existir na loja e 5 tentativas com backoff exponencial com jitter apenas para `429` e `5xx`. Mercado Livre permanece como stub. |
| P1-9 Isolamento do ERP | **Implantado (`architecture.test.ts` verde)** | `ACTIVE_ERP` / `activeErpConnector()`, `readCommerce` (`ErpCommerceSnapshot`), `rate-limit-port.ts` (`acquireErpRequestSlot`, `ErpDailyQuotaPausedError`) e erros neutros em `strategy/types.ts` eliminaram todos os imports diretos de `connectors/bling/*` fora da pasta (`50/50` suítes aprovadas). Apenas `full-sync.ts` ainda lê campos do DTO tipado em `strategy/inbound.ts`. |
| P1-10 Status visual e canais na Home | **Implantado** | Produto vinculado com NCM inválido, ausente, pendente, em conflito ou com risco fiscal aparece em âmbar como **"Vinculado com Pendência"**. Na Visão Geral (`/`), o card **Canais Ativos** agora separa o status da conexão (**`Conectado`** / **`Pausado`**) da contagem de anúncios vinculados, e exibe o total de variações agrupadas abaixo do total de produtos. |
| P2.1 a P2.8 Resiliência e observabilidade | **Implantado (`dd04322`)** | Tabela `dead_letters` (migration 032) com reprocessamento em `/problemas`, backoff exponencial com jitter, pausa por cota diária do Bling, checklist em lote, upsert de snapshot (migration 033), pausa preventiva pelos headers `x-rate-limit-*` da Nuvemshop, métricas de fila com alerta de sync parado > 1 h e detector de `publish_queue` travada > 15 min. |
| Etapa 3 Allowlist e pânico | **Implantado no código** | `LIVE_PUBLISH_ALLOWLIST` e botão de pânico em `/configuracoes/geral` ativos. `ENABLE_LIVE_PUBLISHING` segue `false` em produção. |
| Etapa 4 Gestão de estoque | **Aberto** | Sem leitura de pedidos de venda e sem alertas dedicados de saldo virtual negativo, ruptura ou capital parado. |

---

## 3. Resumo técnico do que foi ajustado

### P0-1. Estoque e conferência dos depósitos em produção
`product_variants.stock` soma exclusivamente depósitos `role = 'seller'` com `include_in_push = true`; `catalog_stock` atende apenas a exibição. Sem depósito de venda classificado, o checklist trava qualquer envio. Em 12/11/2026 a tabela `stock_warehouses` de produção foi inspecionada:
- `14886768228` — **Geral**: `seller`, `include_in_push = true`, `9.934` variantes, saldo virtual total `11.624`.
- `14888973769` — **Depósito 14888973769**: `seller`, `include_in_push = true`, `9.934` variantes, saldo virtual total `0` (requer confirmação de nome/papel pela operação).
- `9001`, `9002`, `9099` — seeds iniciais sem variantes reais vinculadas (`0` variantes).

### P0-2 a P0-4. Duplicidade de anúncio, validação fiscal/mídia e cadastro rápido
- `CREATE` é barrado tanto no checklist quanto no worker quando `channel_listing_links` já possui `listing_id`.
- Enriquecimento de NCM cai em `pending_approval` (dupla revisão fiscal humana) e imagens entram na fila do IQRE sem virar capa automaticamente.
- O cadastro rápido verifica `GET /produtos?codigo=` antes do `POST /produtos`, não lança saldo em `/estoques`, não repete POST em timeout e grava produto/variante/imagem em transação local única.

### P1-1 a P1-5. Marca d'água, reconciliação em lote e vínculo multi-sinal
- O sync respeita `last_bling_sync` vs data de alteração do Bling e ignora preço ausente sem zerar.
- Na Nuvemshop, o servidor resolveu e persistiu automaticamente `nuvemshop-store-id = 6667412` em `sync_cursors`, passou a ler o catálogo da loja em páginas de 200 produtos e já registrou os primeiros vínculos confirmados em produção.
- Apenas dois sinais concordantes confirmam vínculo (`vinculado`); um sinal isolado gera `sugerido` na fila de Vínculos. Erros `401`, `429` e `5xx` preservam o snapshot existente.

### P1-6 e P1-7. Cota do Bling e destravamento da paginação acima de 10.000 itens
- A sincronização de produção havia travado na página `195` (`9.957` produtos) porque o `lockDuration` padrão de 30 s do BullMQ expirava em páginas com 50 `pull` inéditos ou produtos-pai com centenas de variações filhas, deixando o job preso em `failed`.
- Com `lockDuration = 5 min`, remoção de job `failed`/`completed` ao reenfileirar, filtro explícito `criterio=2` e retomada automática no boot, o worker retomou a partir da página `195` em produção sem intervenção manual.

### P1-8 a P1-10 e P2. Publicação Nuvemshop, isolamento parcial e observabilidade
- Publicação na Nuvemshop reconstrói o payload no instante do envio, grava `listing_id` na mesma transação e aplica retry exponencial com jitter apenas em `429`/`5xx`, protegido por `LIVE_PUBLISH_ALLOWLIST` e pelo botão de pânico.
- `dead_letters`, métricas de fila, detector de jobs presos em `processing` > 15 min e upsert de snapshots estão ativos em produção (migrations `032` e `033`).
- `architecture.test.ts` está 100% verde (`0` imports diretos de `connectors/bling/*` fora da pasta do conector; `50/50` suítes / `176/176` testes aprovados).

---

## 4. Gestão de estoque (Etapa 4)

Continua em aberto como evolução futura. O HUB opera em modo catálogo (recusando webhooks de pedido e nota fiscal), portanto não calcula giro nem Curva ABC. Alertas diretos sobre os dados já presentes (`saldo_virtual < 0` por depósito e produtos com estoque no ERP ainda não publicados no canal ativo) podem entrar sem alterar o escopo de pedidos.

---

## 5. Próximos passos objetivos para o Go-Live

1. **Preparar os SKUs do piloto em produção:** criar a categoria em `hub_categories` e o mapeamento Nuvemshop em `/atributos`, concluir a troca de senha inicial dos 2 revisores fiscais (`must_change_password`), aprovar o NCM em duas etapas e definir capa elegível dos SKUs escolhidos.
2. **Aguardar o término da varredura completa do `erp-sync-queue`** e rodar nova rodada de **Reconciliação de Vínculos** após todos os produtos ativos do Bling estarem no banco.
3. **Iniciar o piloto controlado de 48 h:** preencher até 10 SKUs validados em `LIVE_PUBLISH_ALLOWLIST`, ativar `ENABLE_LIVE_PUBLISHING=true` sob acompanhamento humano e monitorar `/problemas` (carta morta, divergências e duplicidades).
4. **Pós-piloto:** escritor de atualização de anúncios existentes (`PATCH`/`PUT` por passo), reativação do Mercado Livre após OAuth com `offline_access` e alertas operacionais de estoque.

### Checklist de Go-Live

- [x] 100% dos depósitos com papel definido e nenhum `unclassified` em produção (`14886768228` e `14888973769` classificados).
- [x] Nenhum produto já vinculado aparece como apto para `CREATE`.
- [x] NCM e imagem só ficam verdes após validação (dupla aprovação fiscal para NCM; processamento IQRE para imagem).
- [x] Publicação idempotente na Nuvemshop validada em testes automatizados, com `LIVE_PUBLISH_ALLOWLIST` e botão de pânico ativos.
- [x] Reconciliação pagina por ID, descobre `store_id` da Nuvemshop, lê em lote sem apagar retrato em `429`/`5xx` e exige 2 sinais para vínculo automático.
- [x] Sync do Bling destravado acima da página 195 com `lockDuration` de 5 min e retomada automática no boot.
- [ ] Verificar se a sincronização dos produtos ativos do Bling travou na página 197 (24.368 itens ativos).
- [x] `architecture.test.ts` sem ofensores (`50/50` suítes e `176/176` testes aprovados).
- [ ] Preparação operacional dos SKUs do piloto em produção: criar categoria em `hub_categories` + mapeamento Nuvemshop em `/atributos`, trocar senha inicial dos 2 revisores fiscais (`must_change_password`), aprovar NCM e definir capa dos SKUs escolhidos.
- [ ] Piloto de 48 h concluído sem *oversell* e sem anúncio duplicado.
