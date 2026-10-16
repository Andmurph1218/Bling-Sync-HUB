# Revisão do Plano Mestre

Estado em 16 de outubro de 2026.

A spec de desenvolvimento é [plano-mestre.md](plano-mestre.md). Este arquivo é o registro da revisão. Não é prompt de motor e não reabre regra que o plano já fechou.

O briefing `PLANO MESTRE REVISADO` foi substituído. As contradições daquele texto estão unificadas no plano. Código ainda não começou. A Fase 0 é o próximo passo.

A maturidade no fim deste arquivo mede este plano. 80 é o ponto em que a implementação segue uma regra só.

## O que a primeira revisão fechou

Cada item abaixo já está no plano. Onde a primeira redação foi apertada depois, vale a regra atual, não a frase antiga.

| Conflito do briefing | Regra atual |
|---|---|
| CQS com várias ordens de KEEP / REPLACE / SUGGEST | A primeira regra que casar vence. REPLACE automático não ocorre em grade A nem em grade B |
| Matching por soma de pontos | Auto-vínculo exige dois sinais fortes no mesmo candidato e nenhum conflito. EAN sozinho não vale 95. A frase antiga, que deixava SKU ou EAN casar sozinho, não vale |
| Webhook respondia 200 antes de gravar | HMAC, INSERT com SHA-256, fila, e só então HTTP 200 |
| Um push com o produto inteiro | Jobs `STOCK_PRICE`, `CONTENT` e `CREATE`. Cada passo chama um endpoint. Não existe PUT do produto inteiro |
| Eco do enriquecimento reabria push | `hub_writes` com `origin = hub`. Webhook que só repete essa escrita fica `ignored`, motivo `echo` |
| Nome e descrição escolhiam entre Mercado Livre e Nuvemshop | Nome e descrição do Bling não recebem texto de canal. Título de anúncio fica em `channel_content_overrides` |
| Schema não subia no PostgreSQL 16 | PK de partição `(created_at, id)`, `timestamptz`, imagem como entidade, NCM `0000.00.00`. Não existe `sync_queue` nem `final_status` |
| Dupla confirmação sem usuário | `users`, `user_roles`, `sessions`. Revisores são chave estrangeira. A segunda revisão de NCM é outro usuário, com nota de TIPI |

## O que entrou depois

Estes ajustes não estavam na primeira revisão. Também já estão no plano.

- Enquanto a integração nativa do Bling estiver ligada, ela atualiza estoque e preço de anúncio já publicado. O `CREATE` confirmado por uma pessoa envia preço e estoque uma vez, na abertura, e não repete.
- Estoque publicado é o saldo virtual dos depósitos `seller` com `include_in_push`. Depósito `ml_full` não entra. O hub não soma `saldoVirtualTotal` nem subtrai `meli_facility`.
- `product_variants.stock` guarda só essa soma. Nasce nula e o zero só aparece depois de `GET /estoques/saldos`. O canal recebe o `floor`. Inativo, excluído e variante removida mandam quantidade zero no passo e não gravam a coluna. Produto e enrich não copiam `estoque.saldoVirtualTotal`.
- Estoque Full (`meli_facility`) é do Mercado Livre. O hub não grava essa quantidade, nem zero. Variante removida segue a mesma exceção.
- Kit (`formato` E) é um SKU. O saldo é o que o Bling calculou. O hub não explode componente nem recalcula a composição.
- Preço da loja Bling vale na Nuvemshop e, no Mercado Livre, só na condição com `follow_store_price`. As outras conservam o próprio preço e alertam.
- `variant_channel_prices` guarda `store_price` e `store_promotional_price`. O cadastro fica em `product_variants.price` e `promotional_price`. A tabela da loja não recebe cópia do cadastro. Sem a leitura, o passo `price` espera. `store_price` nulo usa o cadastro.
- Peso e dimensão da Nuvemshop vão no passo `measures`, sem preço e sem estoque.
- Preço maior que zero e menor que o custo abre alerta crítico. Estoque, pausa e a escrita do preço seguem.
- Não há `ncm_override` nem `name_override`. O NCM é `master_products.ncm`. O nome do Bling é `master_products.name`.
- Inativo e excluído chegam em `product.updated`. `product.deleted` é a exclusão definitiva e só marca o cadastro local depois de um GET 404.
- Webhook de Mercado Livre e de Nuvemshop tem fluxo próprio. Valor do canal não grava no ERP.
- Cota do Bling é uma só: 3 req/s e 120.000 chamadas por dia.
- Escrita de conteúdo no Bling nasce em shadow, com kill switch, teto por execução e reversão pelo `quality_history`.
- `match_rejections` não expira. Quarentena não devolve o anúncio para `unmatched`.
- Imagens passam por `image_processing_queue`. Dedup não cruza produto. O worker reserva `queued` com `available_at` vencido e `locked_at` nulo pelo índice parcial `image_processing_queue_claim` (`available_at`, `id`).
- `push_jobs_active` é o índice único do job `pending` por produto, variante, plataforma e tipo. `locked` fica de fora, para a janela seguinte poder abrir.
- Mercado Livre em conta `user_product_seller` não publica `variations`. Item antigo fica no legado até a migração.
- `family_confidence` é o score de a `family_id` apontar para um só `master_product`. Dois sinais fortes concordantes valem 95. Conflito de itens da família cai em quarentena e não parte o pai. UPtin copia o `match_confidence` legado.
- EAN válido repetido entre variantes do mesmo produto marca `ean_status = duplicate`. CONTENT e CREATE bloqueiam só essas variantes. O EAN não sai do Bling. EAN igual em produtos diferentes continua na quarentena do PIRE.
- NCM em conflito entre variantes marca `ncm_status = conflict` no pai. Nenhum código vira sugestão nem coluna da variante. CONTENT e CREATE do produto bloqueiam.
- Só admin muda depósito, loja, dono do estoque, modo live e `follow_store_price`. `control_changes` grava quem, quando, valor anterior e valor novo, na mesma transação.
- `follow_store_price` tem histórico em `control_changes`, inclusive o nascimento da condição e a marcação do sync (`origin = system`, `changed_by` nulo). `follow_set_by` é só o último admin que fixou. `target_key` é o `item_id`.
- Credencial OAuth fica em `oauth_tokens`, não no Redis.

## O que continua fora

Pedido, financeiro, emissão de NF-e, cotação de frete, serviço (`tipo` diferente de `P`) e comissão de canal. A nota permanece no Bling. Preço contra custo não é margem depois da tarifa. O peso enviado à Nuvemshop corrige o dado do frete. O hub não cotiza frete.

CEST e origem fiscal não viram motor. A nota usa o cadastro do Bling.

## Duas frases que o plano ainda não tem

São limite de operação, não módulo novo.

1. `cest`, `tax_origin` e `requires_cest` são espelho do Bling. O hub copia, mostra na ficha e não usa esses campos para bloquear push nem para gravar de volta. O anúncio não carrega o dado fiscal da nota, então não há alerta de divergência com o canal.
2. Desligar a sincronização nativa de estoque e preço não desliga a entrada de pedidos no Bling. Sem o pedido, o saldo que o hub lê deixa de se mover.

## Ordem de construção

A tabela viva está na seção 13 do plano. 31–46 dias úteis cobrem a espinha de backend. As telas não cabem nesse intervalo.

| Fase | Fecha quando |
|---|---|
| 0 | Healthcheck e login de dois papéis |
| 0.5 | Mapper cobre simples, variação, kit, 429 e `product.deleted` |
| 1 | Migrations sobem e descem |
| 2 | Dois jobs juntos não passam de 3 req/s. O refresh do token é single-flight |
| 3 | Vetores GS1 e NCM `0000.00.00`. EAN repetido entre variantes do mesmo produto marca `duplicate`. NCM em conflito entre variantes marca `conflict` |
| 4 | EAN compartilhado cai em quarentena. Família User Product com sinais em dois pais também. Conta `user_product_seller` não publica `variations` |
| 5 | A sync enfileira as imagens. O fechamento deduplica sem cruzar produto |
| 6 | Grade A e grade B não sofrem REPLACE |
| 7 | Estoque não lê o score |
| 8 | Restart depois do 200 não perde evento |
| 9 | Eco do PUT do hub não reabre push. Anúncio só Full não recebe PUT de estoque |
| 10 | Réplica extra não duplica limpeza |
| 11 | Dois usuários confirmam o mesmo NCM |
| 12 | Lag de estoque medido |

## Maturidade da spec

Julgamento de 0 a 100. A nota do plano é a média simples das oito áreas: **83**.

| Área | Nota | O que a nota reflete |
|---|---|---|
| Princípios | 92 | Soberania, matching, push e bloqueio fiscal estão numa lista só. A seção 14 trava estoque, preço de loja, família, EAN repetido, NCM em conflito e a trilha de `follow_store_price` |
| Schema | 90 | Variante, eixo, fila, Full, loja, trilha, `family_confidence` e os índices de consumo sobem no PostgreSQL 16. CEST e origem existem como coluna e ainda não têm a frase de espelho |
| Motores | 88 | PIRE, GVE e NVE fecham família, EAN repetido e NCM em conflito. O limiar de marca d'água espera amostra real |
| Fluxos | 90 | Push, Full, kit, preço, estoque nulo, exclusão e convivência fecham. Falta gravar que desligar o estoque nativo mantém a entrada de pedidos |
| Contratos de API | 58 | A seção 11 lista os fixtures. Os arquivos ainda não existem, então o shape do payload não está congelado |
| Auth | 84 | Papel, sessão, OAuth criptografado e refresh em single-flight. A rotação do refresh segue como premissa até a documentação oficial |
| Operação | 84 | Cota única, BullMQ, shadow, alerta, trilha de controle e os índices de consumo. A troca do dono do estoque tem regra e não tem roteiro de operação |
| Cronograma | 78 | 31–46 dias úteis cobrem a espinha de backend. As fases 3 e 4 têm teste de saída para EAN, NCM e família. Tela não tem prazo |
