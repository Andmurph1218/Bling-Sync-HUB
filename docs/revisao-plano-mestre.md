# Revisão do Plano Mestre

Estado em 15 de outubro de 2026.

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
- Estoque Full (`meli_facility`) é do Mercado Livre. O hub não grava essa quantidade, nem zero. Variante removida segue a mesma exceção.
- Kit (`formato` E) é um SKU. O saldo é o que o Bling calculou. O hub não explode componente nem recalcula a composição.
- Preço da loja Bling vale na Nuvemshop e, no Mercado Livre, só na condição com `follow_store_price`. As outras conservam o próprio preço e alertam.
- Peso e dimensão da Nuvemshop vão no passo `measures`, sem preço e sem estoque.
- Preço maior que zero e menor que o custo abre alerta crítico. Estoque, pausa e a escrita do preço seguem.
- Não há `ncm_override` nem `name_override`. O NCM é `master_products.ncm`. O nome do Bling é `master_products.name`.
- Inativo e excluído chegam em `product.updated`. `product.deleted` é a exclusão definitiva e só marca o cadastro local depois de um GET 404.
- Webhook de Mercado Livre e de Nuvemshop tem fluxo próprio. Valor do canal não grava no ERP.
- Cota do Bling é uma só: 3 req/s e 120.000 chamadas por dia.
- Escrita de conteúdo no Bling nasce em shadow, com kill switch, teto por execução e reversão pelo `quality_history`.
- `match_rejections` não expira. Quarentena não devolve o anúncio para `unmatched`.
- Imagens passam por `image_processing_queue`. Dedup não cruza produto.
- Mercado Livre em conta `user_product_seller` não publica `variations`. Item antigo fica no legado até a migração.
- Só admin muda depósito, loja, dono do estoque, modo live e `follow_store_price`. `control_changes` grava quem, quando, valor anterior e valor novo, na mesma transação.
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
| 3 | Vetores GS1 e NCM `0000.00.00` |
| 4 | EAN compartilhado cai em quarentena. Conta `user_product_seller` não publica `variations` |
| 5 | A sync enfileira as imagens. O fechamento deduplica sem cruzar produto |
| 6 | Grade A e grade B não sofrem REPLACE |
| 7 | Estoque não lê o score |
| 8 | Restart depois do 200 não perde evento |
| 9 | Eco do PUT do hub não reabre push. Anúncio só Full não recebe PUT de estoque |
| 10 | Réplica extra não duplica limpeza |
| 11 | Dois usuários confirmam o mesmo NCM |
| 12 | Lag de estoque medido |

## Maturidade da spec

Julgamento de 0 a 100. A nota do plano é a média simples das oito áreas: **81**.

| Área | Nota | O que a nota reflete |
|---|---|---|
| Princípios | 92 | Soberania, matching, push e bloqueio fiscal estão numa lista só. A seção 14 do plano trava o que não volta |
| Schema | 86 | Variante, eixo, fila, Full, loja e trilha sobem no PostgreSQL 16. CEST e origem existem como coluna e ainda não têm a frase de espelho |
| Motores | 84 | Cada motor tem predicado e saída neste plano. O limiar de marca d'água espera amostra real |
| Fluxos | 88 | Push, Full, kit, preço, exclusão e convivência fecham. Falta gravar que desligar o estoque nativo mantém a entrada de pedidos |
| Contratos de API | 58 | A seção 11 lista os fixtures. Os arquivos ainda não existem, então o shape do payload não está congelado |
| Auth | 84 | Papel, sessão, OAuth criptografado e refresh em single-flight. A rotação do refresh segue como premissa até a documentação oficial |
| Operação | 80 | Cota única, BullMQ, shadow, alerta e trilha de controle. A troca do dono do estoque tem regra e não tem roteiro de operação |
| Cronograma | 76 | 31–46 dias úteis cobrem a espinha de backend, com teste de saída por fase. Tela não tem prazo |
