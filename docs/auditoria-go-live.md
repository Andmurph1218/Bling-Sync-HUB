# Auditoria de Go-Live — JH Sync Hub

Data: 11/11/2026. Base auditada: `7fcbb49` (produção) mais o redesign do dashboard ainda não commitado.
Método: leitura estática do código da API (`apps/api/src`). O banco de produção não foi consultado; números de volume são estimativas a partir do catálogo (~9.955 produtos ativos).

---

## 1. Resumo executivo

**Veredito: não ligar `ENABLE_LIVE_PUBLISHING=true` agora.**

São dois motivos, e o primeiro surpreende:

1. **Ligar a flag hoje não publica nada.** `createListing` dos dois canais ativos é um stub que sempre devolve `performed: false` com o motivo `escrita_ao_vivo_desligada` ([marketplaces.ts:19-21](../apps/api/src/connectors/strategy/marketplaces.ts#L19), [:74-76](../apps/api/src/connectors/strategy/marketplaces.ts#L74), [:103-105](../apps/api/src/connectors/strategy/marketplaces.ts#L103)). Com a flag ligada, o worker chama esse stub e marca cada item como `failed` ([publish-queue.ts:105-109](../apps/api/src/queues/publish-queue.ts#L105)). O efeito é inundar a tela de Problemas com falhas falsas. `updateStock` também recusa sempre ([marketplaces.ts:23-25](../apps/api/src/connectors/strategy/marketplaces.ts#L23)).
2. **Quando o escritor real for implementado, as travas atuais deixariam passar erros graves:** anúncio duplicado de produto que já existe no canal, estoque somando depósitos que não são de venda (incluindo possivelmente o Full), NCM e imagem promovidos sem validação, e payload congelado no momento do enfileiramento.

**Soberania do ERP:** o HUB não tem nenhuma rota que altere preço no Bling, e nenhuma tela edita `product_variants.price`. Há dois caminhos que escrevem no Bling:
- O cadastro rápido (`POST /api/catalog/products`) cria o produto e lança **saldo de estoque** em um depósito escolhido automaticamente (P0-4).
- `BlingConnector.applyToBling` (PATCH de marca, peso e dimensões) está dormente: nenhum chamador em produção passa o callback do CQS ([cqs.ts:740-741](../apps/api/src/engines/cqs.ts#L740)).

| Dimensão | Situação |
|---|---|
| Soberania de preço | Respeitada (não há escrita de preço no Bling) |
| Soberania de estoque | Violada no cadastro rápido; estoque do HUB contaminado por depósitos não classificados |
| Integridade transacional | Boa no sync de estoque; fraca em enriquecimento, reconciliação e cadastro rápido |
| Resiliência a falhas | Média: checkpoint por página existe, mas sem backoff exponencial, sem limitador global e erro transitório vira "anúncio não existe" |
| Prontidão para publicação ao vivo | Não pronta (escritor inexistente e quatro bloqueadores P0) |

---

## 2. Pontos críticos

### P0 — bloqueiam o go-live

#### P0-1. O estoque do catálogo soma depósitos não classificados e pode incluir o Full

- Quando nenhum depósito `seller` com `include_in_push` está configurado, `catalogStockFromBalances` soma o saldo virtual de **todos os depósitos que não são `ml_full`**. Se a lista de depósitos vier vazia, usa `saldoVirtualTotal`, que inclui o Full ([pipeline.ts:218-235](../apps/api/src/orchestrator/pipeline.ts#L218)).
- Todo depósito novo é inserido como `unclassified` ([pipeline.ts:256-266](../apps/api/src/orchestrator/pipeline.ts#L256)). O único Full semeado tem id `9099` ([migration 12:115](../apps/api/src/db/migrations/1729080000012_partitions-and-seeds.ts#L115)). Se o id real do depósito Full no Bling for outro, o saldo do Full entra na soma.
- Esse valor vai para `product_variants.stock` e também volta como `publishableFloor` ([pipeline.ts:280-292](../apps/api/src/orchestrator/pipeline.ts#L280)). Daí vira `available_quantity` no payload de publicação ([publish-preview.ts:127-133](../apps/api/src/catalog/publish-preview.ts#L127)).
- Isso contradiz o contrato do próprio projeto: "Depósitos ml_full, other e unclassified nunca entram na soma" ([contracts/mappers.ts:110](../apps/api/src/contracts/mappers.ts#L110)).
- **Risco:** vender estoque de mostruário, avaria ou Full na Nuvemshop, o que leva a overselling. Hoje isso também gera alertas falsos de "Vendeu X no canal" na reconciliação.
- **Correção:**
  - Separar o estoque em duas colunas: `stock` (publicável, só depósitos seller) e `catalog_stock` (exibição).
  - Fazer o checklist bloquear a publicação quando não houver depósito seller classificado.

#### P0-2. Publicar cria anúncio duplicado de produto que já está no canal

- `checklistForChannel` não consulta `channel_listing_links` nem `platform_links` ([publish-preview.ts:214-310](../apps/api/src/catalog/publish-preview.ts#L214)).
- `enqueueAutoPublish` só evita duplicar itens `pending` ou `processing` na própria fila ([publish-preview.ts:176-183](../apps/api/src/catalog/publish-preview.ts#L176)).
- Exemplo concreto: o ATL-368, já vinculado ao anúncio 1578151393, é considerado "pronto para criar".
- **Correção:**
  - Bloquear a criação quando existir vínculo e encaminhar o item para um fluxo de atualização.
  - Gravar o `listing_id` devolvido pelo canal na mesma transação que marca `success`.

#### P0-3. O enriquecimento promove NCM e imagem sem validação

- `saveNcmAndCategory` grava `ncm_status = 'valid'` e `ncm_fiscal_risk = false` sem passar pelo NVE nem pela aprovação em duas etapas ([enrichment-worker.ts:57-71](../apps/api/src/queues/enrichment-worker.ts#L57)).
- `saveImages` marca a primeira imagem como capa elegível com `rights_status = 'owned'` sem passar pelo IQRE ([enrichment-worker.ts:32-55](../apps/api/src/queues/enrichment-worker.ts#L32)). Isso vale também para links de `midia.imagens.externas`, que podem ser de fornecedor.
- Os dois campos alimentam diretamente o checklist ([publish-preview.ts:294-307](../apps/api/src/catalog/publish-preview.ts#L294)). Com `AUTO_PUBLISH_ENABLED=true`, o `recalculateCompleteness` chamado pelo worker enfileira a publicação sozinho ([publish-preview.ts:166](../apps/api/src/catalog/publish-preview.ts#L166)).
- **Correção:**
  - Gravar o NCM vindo do Bling como `pending_approval`, ou rodar o NVE antes de marcar `valid`.
  - Enviar as imagens para a fila do IQRE em vez de marcá-las como capa direto.

#### P0-4. O cadastro rápido escreve estoque no Bling e pode duplicar o produto

- `POST /api/catalog/products` (perfis operator e admin) chama `create` ([catalog.ts:660-705](../apps/api/src/routes/catalog.ts#L660)). Essa função:
  - Faz `POST /produtos`.
  - Faz `POST /estoques` com `operacao: 'B'` (balanço) no **primeiro depósito ativo** que o Bling devolver ([bling-erp.ts:359-376](../apps/api/src/connectors/bling/bling-erp.ts#L359)). Esse depósito pode ser o Full ou um depósito de avaria.
  - Grava `estoque.maximo = quantidade`, um campo sem relação com o saldo.
- O laço de retry de `LiveBlingCatalogReader.call` também repete **POST** em caso de timeout ou erro de rede ([bling-erp.ts:221-243](../apps/api/src/connectors/bling/bling-erp.ts#L221)). Um timeout depois de o Bling aceitar cria o produto duas vezes.
- Se a gravação local falhar depois da criação no Bling, o produto fica órfão no ERP ([catalog.ts:717-728](../apps/api/src/routes/catalog.ts#L717)). O próximo sync recupera o produto, mas sem o vínculo de imagem.
- **Correção:**
  - Remover o lançamento de estoque, ou exigir que o usuário escolha explicitamente um depósito `seller`.
  - Nunca repetir POST automaticamente.
  - Antes de criar, procurar o SKU no Bling (`GET /produtos?codigo=`).

### P1 — corrigir antes de escalar

#### P1-1. Concorrência entre o sync completo e o webhook (última escrita vence)

- O webhook passa por `field_watermarks` com tolerância de 1 s ([wig.ts:479-539](../apps/api/src/engines/wig.ts#L479)).
- O sync completo e o `refreshMissingCommerce` sobrescrevem `price = EXCLUDED.price` sem comparar a marca d'água ([pipeline.ts:137-139](../apps/api/src/orchestrator/pipeline.ts#L137), [full-sync.ts:336-350](../apps/api/src/catalog/full-sync.ts#L336)).
- Cenário: uma página lida em T0, um webhook de preço em T1 e a gravação da página em T2. O preço antigo volta.
- Se o payload vier sem `preco`, `asCatalogPrice` devolve 0 e **zera o preço** ([mappers.ts:110](../apps/api/src/connectors/bling/mappers.ts#L110), [:183](../apps/api/src/connectors/bling/mappers.ts#L183)).
- **Correção:**
  - Gravar só quando a data de alteração do Bling for mais nova que `last_bling_sync`.
  - Tratar campo ausente como "não alterar" em vez de 0.
- Observação: o caso "operador muda preço no HUB enquanto chega webhook" não existe, porque o HUB não edita preço. Isso é correto pela regra de soberania.

#### P1-2. Um conflito de vínculo derruba a reconciliação inteira

- `linkIfMissing` trata apenas o conflito em `(product_id, channel)` ([reconciliation.service.ts:48-60](../apps/api/src/services/reconciliation.service.ts#L48)).
- Dois produtos do HUB com o mesmo SKU de variante (por exemplo, um duplicado) apontam para o mesmo anúncio. O segundo insert viola a chave única `(channel, listing_id)` e lança erro fora do `try` ([reconciliation.service.ts:227-228](../apps/api/src/services/reconciliation.service.ts#L227)). Isso aborta o `reconcileAll` no meio.
- **Correção:** usar `ON CONFLICT DO NOTHING` sem alvo e registrar o caso como "conflito de vínculo" em Problemas.

#### P1-3. A paginação da reconciliação pula ou repete produtos e cresce de forma quadrática

- A paginação usa `OFFSET` sobre `ORDER BY mp.updated_at DESC` ([reconciliation.service.ts:154-179](../apps/api/src/services/reconciliation.service.ts#L154)). Durante a execução, o `refreshMissingCommerce` altera o `updated_at`, e a ordem muda entre páginas.
- Cada página de 80 carrega **todas** as variantes do catálogo e faz um scan completo de `product_images` ([:180-185](../apps/api/src/services/reconciliation.service.ts#L180)). São cerca de 125 páginas, o que dá ~125 leituras completas por execução ([:240-255](../apps/api/src/services/reconciliation.service.ts#L240)).
- **Correção:** cursor por `id` (keyset), `DISTINCT ON (mp.id)` no SQL e contagem de capas só para os ids da página.

#### P1-4. Um erro transitório do canal vira "anúncio não existe"

- `fetchNuvemshopListing` devolve `null` para qualquer resposta que não seja 2xx: 429, 5xx ou 401 ([nuvemshop-listing.ts:126-127](../apps/api/src/connectors/strategy/nuvemshop-listing.ts#L126)). A reconciliação então **apaga o snapshot** ([reconciliation.service.ts:220-225](../apps/api/src/services/reconciliation.service.ts#L220)).
- O `fetch` não tem timeout nem respeita o limite da Nuvemshop.
- Quando nenhuma variante bate com o SKU, a comparação usa `variants[0]` ([nuvemshop-listing.ts:78](../apps/api/src/connectors/strategy/nuvemshop-listing.ts#L78)). Isso gera alerta de preço contra a variante errada.
- **Correção:**
  - Lançar erro em 429, 5xx e 401, e só devolver `null` em 404 ou em busca vazia.
  - Usar `AbortSignal.timeout`.
  - Não usar `variants[0]` como fallback.

#### P1-5. Vínculo automático com um único sinal (risco de falso positivo)

- Nuvemshop: o vínculo é feito só por SKU, sem diferenciar maiúsculas de minúsculas.
- Mercado Livre: cai para busca **só por EAN** quando o SKU não encontra nada ([ml-listing-search.ts:71](../apps/api/src/connectors/strategy/ml-listing-search.ts#L71), [:120](../apps/api/src/connectors/strategy/ml-listing-search.ts#L120)). EAN compartilhado entre kit e unidade, ou entre cores, vincula o produto errado.
- O vínculo nasce `vinculado`, sem revisão, o que contradiz a regra de dois sinais do PIRE.
- **Correção:** SKU mais EAN (ou mais similaridade de título) cria `vinculado`. Um sinal só cria `sugerido`, que vai para a tela de Vínculos.

#### P1-6. O limite de taxa do Bling não é global

- Cada `createErpConnector('bling')` cria um `LiveBlingCatalogReader` novo, com seu próprio `lastCallAt` ([bling-erp.ts:217-228](../apps/api/src/connectors/bling/bling-erp.ts#L217), [register.ts:11](../apps/api/src/connectors/bling/register.ts#L11)).
- A reconciliação cria um conector por produto ([reconciliation.service.ts:193](../apps/api/src/services/reconciliation.service.ts#L193)).
- Sync, enriquecimento e reconciliação podem rodar juntos e passar de 3 req/s.
- O retry é linear (1, 2 e 3 s), ignora `Retry-After` e não repete em 5xx.
- `pullCatalogProduct` faz uma chamada extra de estoque por produto ([bling-erp.ts:455](../apps/api/src/connectors/bling/bling-erp.ts#L455)) além do `stockForBatch` em lote ([full-sync.ts:491-494](../apps/api/src/catalog/full-sync.ts#L491)). Isso quase dobra o consumo da cota diária de 120 mil chamadas.
- **Correção:**
  - Um limitador compartilhado no Redis (token bucket), reaproveitando o `ScheduledLimiter` que já existe em [connectors.ts:44](../apps/api/src/connectors/connectors.ts#L44).
  - Remover a chamada de estoque redundante.

#### P1-7. Escritas sem transação

| Fluxo | Situação | Arquivo |
|---|---|---|
| Sync de estoque | Em transação (correto) | [pipeline.ts:249](../apps/api/src/orchestrator/pipeline.ts#L249) |
| Enriquecimento | Imagens, NCM e score em comandos separados | [enrichment-worker.ts:110-121](../apps/api/src/queues/enrichment-worker.ts#L110) |
| Snapshot da reconciliação | `DELETE` seguido de `INSERT` sem transação | [reconciliation.service.ts:62-83](../apps/api/src/services/reconciliation.service.ts#L62) |
| Cadastro rápido | Grava no Bling e depois no banco local | [catalog.ts:698-735](../apps/api/src/routes/catalog.ts#L698) |

**Se um lote de 50 falha no meio:**
- **Sync:** cada produto tem `try/catch` e o checkpoint `last_completed_page` só avança no fim da página. Porém, se a página falhar, o worker marca `failed` e **retorna sem lançar erro** ([erp-sync-worker.ts:180-190](../apps/api/src/queues/erp-sync-worker.ts#L180)). As 5 tentativas do BullMQ nunca são usadas, e o sync para até o operador clicar de novo. A retomada continua da página certa, o que está correto.
- **Enriquecimento:** a falha é isolada por produto e o cursor é `erp_id`. Um produto que falhou fica para a próxima execução. Isso está aceitável.

#### P1-8. A fila de publicação não tem retry, idempotência nem payload atualizado

- `add('publish')` não define `attempts` ([publish-queue.ts:196](../apps/api/src/queues/publish-queue.ts#L196)). Um erro 500 marca `failed` de imediato e aparece em Problemas ([problem-panel.ts:206](../apps/api/src/catalog/problem-panel.ts#L206)). **Não há loop infinito**, mas também não há nova tentativa para falha transitória.
- Um job travado (stalled) é reexecutado pelo BullMQ e chamaria `createListing` duas vezes.
- Preço e estoque são congelados no `payload_json` no momento do enfileiramento ([publish-preview.ts:186-199](../apps/api/src/catalog/publish-preview.ts#L186), [publish-queue.ts:138-148](../apps/api/src/queues/publish-queue.ts#L138)). Um item que fica pendente publica valores antigos.
- **Correção:**
  - Reconstruir o payload na execução.
  - Usar uma chave de idempotência (vínculo gravado antes de marcar `success`).
  - Configurar `attempts: 5` com backoff exponencial só para 429 e 5xx.

#### P1-9. Vazamentos de isolamento entre o core e o conector do Bling

- Código do core lê campos do Bling (`preco`, `codigo`, `estoqueSaldos`) em [full-sync.ts:262-274](../apps/api/src/catalog/full-sync.ts#L262) e [:336-361](../apps/api/src/catalog/full-sync.ts#L336).
- `'bling'` está fixo em [reconciliation.service.ts:193](../apps/api/src/services/reconciliation.service.ts#L193), [erp-sync-worker.ts:236](../apps/api/src/queues/erp-sync-worker.ts#L236) e [enrichment-worker.ts:164](../apps/api/src/queues/enrichment-worker.ts#L164).
- O pipeline se chama `upsertCatalogProductFromBlingPayload`.
- Isso não bloqueia o go-live, mas bloqueia a entrada de um segundo ERP. **Correção:** o conector devolve um DTO neutro (`ErpCommerceSnapshot { sku, price, balances[] }`) e o ERP ativo vem da configuração.

#### P1-10. Status "Integrado" esconde bloqueio fiscal

Um produto vinculado aparece como `connected` mesmo com NCM bloqueado ([integration-status.ts](../apps/api/src/catalog/integration-status.ts)). Para o operador, "verde" deveria significar "vinculado e sem pendência". **Correção:** mostrar "Vinculado com pendência" em âmbar.

### Segurança e tokens — sem achados críticos

- Os tokens OAuth são cifrados com AES-256-GCM ([auth/crypto.ts:46-75](../apps/api/src/auth/crypto.ts#L46)) e lidos pelo `OAuthTokenManager`.
- Não encontrei log de token, segredo ou senha nos `logger.*`.
- O webhook usa HMAC em tempo constante.
- Memória: o sync trabalha em páginas de 50 e o enriquecimento em lotes de 50. O único ponto que carrega o catálogo inteiro na memória é a reconciliação (P1-3).

---

## 3. Melhorias de performance e resiliência (P2)

1. **Dead letter queue:** uma tabela `dead_letters` (fila, payload, erro, tentativas) e um card em Problemas com botão "Reprocessar". `replayFailedPushJobById` já existe para `push_jobs` ([pipeline.ts:560](../apps/api/src/orchestrator/pipeline.ts#L560)) e serve de modelo.
2. **Backoff exponencial com jitter** em todas as filas. Hoje é fixo em 5 s ([erp-sync-worker.ts:94](../apps/api/src/queues/erp-sync-worker.ts#L94), [enrichment-worker.ts:144](../apps/api/src/queues/enrichment-worker.ts#L144)). O IQRE já usa `2^n × 15` ([iqre.ts:405](../apps/api/src/engines/iqre.ts#L405)).
3. **Contador de cota do Bling no Redis** (por dia), com pausa automática das filas em 80% da cota.
4. **Cache de categorias e atributos de canal:** `checklistForChannel` faz de 3 a 5 consultas por produto e por canal. Uma versão em lote (`checklistForChannels(ids[])`) em uma única consulta resolve o recálculo de completude do enriquecimento e do sync.
5. **Snapshot com `ON CONFLICT DO UPDATE`** em vez de `DELETE` e `INSERT`.
6. **Nuvemshop:** ler os cabeçalhos `x-rate-limit-remaining` e `x-rate-limit-reset` e pausar antes do 429.
7. **Observabilidade:** métricas por fila (aguardando, ativos, falhos, latência) e alerta quando o sync ficar em `failed` por mais de 1 h.
8. **Detector de jobs travados** em `publish_queue.status = 'processing'` por mais de 15 min.

---

## 4. Visão de negócios — gestão de estoque

### Situação atual

O HUB opera em **modo catálogo** e recusa eventos de pedido e nota ([marketplaces.ts:27-31](../apps/api/src/connectors/strategy/marketplaces.ts#L27), [catalog-mode.ts:8](../apps/api/src/connectors/strategy/catalog-mode.ts#L8)). Por isso **não há histórico de vendas**, e sem esse histórico não dá para calcular giro.

O que já existe nos dados:
- Saldo físico e virtual por depósito (`variant_stock_balances`).
- Papel de cada depósito (`stock_warehouses.role`).
- Preço, custo, vínculo por canal e snapshot do canal.

### O que dá para entregar já, sem dado novo

1. **Alerta de estoque negativo:** `saldo_virtual < 0` em qualquer depósito, normalmente um pedido reservado sem saldo físico, o que indica venda acima do disponível. Mostrar por SKU e depósito em Problemas.
2. **Divergência entre canal e ERP:** a reconciliação já detecta "Vendeu X no canal, estoque do Bling não baixou" ([reconciliation.service.ts:107-115](../apps/api/src/services/reconciliation.service.ts#L107)). Esse alerta só fica confiável depois da correção P0-1.
3. **Full do Mercado Livre:** quando o canal voltar, comparar o saldo do depósito `ml_full` com o estoque do anúncio Full. Diferença negativa aponta avaria ou extravio no CD.
4. **Ruptura:** produto vinculado e ativo no canal com estoque publicável igual a 0. Isso é venda perdida e queda de ranking.
5. **Capital parado:** estoque maior que 0 e nenhum vínculo em canal, valorizado como `estoque × custo`. Uma lista ordenada por valor mostra o que precisa ser anunciado primeiro.
6. **Margem:** preço comparado com custo mais tarifa do canal. A tela "Saúde e margem" já existe e pode ganhar o filtro "margem < X%".

### Sugestão de compra por giro (exige ingestão de vendas somente leitura)

- Ler os pedidos de venda do Bling (`GET /pedidos/vendas`) sem escrever nada, o que mantém a soberania.
- Fórmula:
  - Demanda diária média = vendas de 30, 60 ou 90 dias ÷ dias.
  - Estoque de segurança = z × σ(demanda diária) × √(prazo do fornecedor).
  - Ponto de pedido = demanda diária × prazo + estoque de segurança.
  - Sugestão de compra = (demanda diária × (prazo + cobertura alvo) + estoque de segurança) − (estoque disponível + em trânsito).
- Classificação ABC (faturamento) cruzada com XYZ (variabilidade). Itens AX recebem cobertura curta e reposição frequente; itens CZ ficam sob encomenda.
- Saída: lista de sugestão exportável. O pedido de compra continua sendo criado no Bling pelo comprador.

### Indicadores para o painel do gestor

Cobertura em dias, giro mensal, % de SKUs em ruptura, capital imobilizado sem canal, % de depósitos classificados e % de SKUs com divergência entre canal e ERP.

---

## 5. Próximos passos recomendados

**Etapa 1 — bloqueadores (antes de pensar em ligar a publicação)**
1. Classificar os depósitos reais do Bling (seller, Full, outros) e separar `stock` publicável de `catalog_stock` de exibição (P0-1).
2. O checklist passa a bloquear a criação quando há vínculo, e o fluxo de atualização fica separado (P0-2).
3. Enriquecimento: NCM vai para `pending_approval` ou passa pelo NVE, e imagem vai para o IQRE (P0-3).
4. Cadastro rápido: sem lançamento de estoque automático e sem retry de POST (P0-4).

**Etapa 2 — robustez**
5. Implementar o `createListing` real da Nuvemshop com idempotência e payload montado na execução (P1-8).
6. Reconciliação: keyset, tratamento de conflito, distinguir 404 de erro transitório e exigir dois sinais (P1-2 a P1-5).
7. Limitador global do Bling no Redis, backoff exponencial e remoção da chamada de estoque redundante (P1-6).
8. Marca d'água nas escritas do sync e "campo ausente não zera preço" (P1-1).

**Etapa 3 — piloto controlado**
9. Criar `LIVE_PUBLISH_ALLOWLIST` (10 SKUs) e um kill switch na tela de Configurações.
10. Ligar `ENABLE_LIVE_PUBLISHING=true` só para a lista de piloto, acompanhar 48 h (falhas, divergência de estoque, duplicados) e depois ampliar em ondas.

**Etapa 4 — gestão de estoque**
11. Alertas de estoque negativo, ruptura e capital parado (dados já disponíveis).
12. Ingestão somente leitura de pedidos de venda, depois sugestão de compra e curva ABC/XYZ.

### Critério de go-live

- [ ] 100% dos depósitos com papel definido e nenhum `unclassified` com saldo.
- [ ] Nenhum produto vinculado aparece como "pronto para criar".
- [ ] NCM e imagem só ficam verdes depois do NVE e do IQRE.
- [ ] Publicação idempotente testada com job reexecutado.
- [ ] Reconciliação completa sem abortar e sem apagar snapshot em 429 ou 5xx.
- [ ] Piloto de 48 h sem oversell e sem anúncio duplicado.
