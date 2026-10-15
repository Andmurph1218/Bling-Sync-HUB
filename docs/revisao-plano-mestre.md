# Revisão do Plano Mestre

Fonte: `PLANO MESTRE REVISADO` (briefing do hub Bling ERP, Mercado Livre e Nuvemshop).

O modelo de soberania, os dez motores e o corte de escopo sustentam o projeto. A Parte 8 do plano ainda não serve como prompt de implementação: as regras que o código precisa seguir aparecem de formas diferentes no mesmo documento.

Fase 0 pode abrir (monorepo, Docker, pool, Redis, papéis). Schema, matching, enriquecimento e push esperam os ajustes P0.

## O que permanece

- Grupos A, A.5, B, C e D.
- NCM sem auto-preenchimento e com dupla confirmação.
- EAN com dígito GS1 e fila humana.
- Variante como entidade, não como JSON.
- Payload lido do Bling no momento da execução.
- Watermark por campo e arquivo fiscal separado de log operacional.
- Fora de escopo: pedido, financeiro, NF-e e frete.

## Premissas a fixar no topo do plano

- Uma conta Bling, um seller Mercado Livre, uma loja Nuvemshop.
- Produto simples é uma variante default. Todo produto tem ao menos uma linha em `product_variants`.
- Preço publicado é o preço de venda do Bling. Promoção só entra com flag explícita.
- Estoque publicado é a soma de uma lista configurável de depósitos.
- Moeda: BRL.
- A defasagem aceita de estoque é a do job P1, inferior a 2 minutos, enquanto o push de estoque não estiver bloqueado.

## P0 — aplicar antes de codar

### 1. Uma ordem só para o enriquecimento (CQS)

Trechos em conflito: seção 2.1, seção 5.2, mandamentos 33–37 e o prompt da Fase 5.

A tabela de delta, a grade B e o mandamento da grade A não dizem a mesma coisa. A primeira regra que casar vence:

1. Externo grade F, ou score externo menor que 15: KEEP.
2. Bling grade A (81–100): KEEP.
3. Bling grade F (0–20) e externo pelo menos C: REPLACE.
4. Bling grade D (21–40), externo B ou A, delta de pelo menos 15: REPLACE.
5. Delta de pelo menos 30 com Bling em C ou D: REPLACE e registro em `quality_history`.
6. Delta 15–29, ou Bling grade B com qualquer delta: SUGGEST.
7. Qualquer outro caso: KEEP.

REPLACE automático não ocorre em grade A nem em grade B.

### 2. Matching por predicado (PIRE e VIR)

Trechos em conflito: seções 5.1 e 5.6 e mandamento 24.

Os pontos não são somados para auto-vínculo. Casa sozinho apenas:

- vínculo manual já confirmado
- SKU normalizado com um único candidato no Bling
- EAN com GVE válido e um único dono no catálogo

Preço, peso e nome fuzzy só ordenam a fila de sugestão. O score exibido é o maior sinal, com o breakdown em `match_signals`. Dois candidatos no mesmo patamar vão para quarentena.

EAN de anúncio compara com a variante. Um GTIN compartilhado não promove o `master_product`.

### 3. Webhook: gravar antes de confirmar (WIG)

Trechos em conflito: fluxo 6.3, prompt da Fase 9 e mandamento 91.

Ordem fixa:

1. Ler o raw body.
2. Validar HMAC com comparação de tempo constante. Assinatura inválida responde 401 e não persiste.
3. Inserir em `webhook_events` com o SHA-256 completo (64 hex). Conflito de chave responde 200 e para.
4. Enfileirar no BullMQ.
5. Só então responder HTTP 200.

O worker aplica lock, watermark e comparação de conteúdo. `setImmediate` sai do prompt. O fluxo que responde 200 antes da assinatura aceita chamada inválida e perde o evento se o processo cair.

### 4. Três tipos de push (APE)

Trechos em conflito: princípio P6, seções 5.3, 5.4 e 6.2, mandamentos 10 e 18.

| Tipo | Segue quando |
|---|---|
| STOCK_PRICE | Sempre, exceto preço menor ou igual a zero. Preço zero bloqueia só o preço. |
| CONTENT | Vínculo confirmado e sem bloqueio fiscal |
| CREATE | O de CONTENT, mais o threshold do CRE no canal |

Estoque de anúncio já publicado não espera correção de NCM.

### 5. Corte do eco de enriquecimento

O enriquecimento faz PUT no Bling. O webhook dessa escrita não pode reabrir push.

- Toda escrita do hub grava `origin=hub` e o id da request.
- Webhook cujo diff é só essa escrita fica `ignored`, motivo `echo`.
- Não devolver um campo à plataforma de origem se o valor já é igual.
- O método no prompt passa a se chamar `applyToBling`.
- Grupo A continua sem escrita externa.

### 6. Desempate entre Mercado Livre e Nuvemshop

| Campo | Ordem |
|---|---|
| Nome | Mercado Livre, depois Nuvemshop |
| Descrição | Nuvemshop, depois Mercado Livre |
| Marca | Maior grade. Empate permanece no Bling e vira SUGGEST |
| Peso e dimensões | Só entram com as três medidas e concordância dentro de 5%. Senão, SUGGEST |
| Categoria de canal | Vai para `product_category_mappings`. Não sobrescreve a categoria do Bling |

Fonte inválida pelo CQS é pulada.

### 7. Schema que sobe no PostgreSQL 16

- PK das tabelas particionadas: `(created_at, id)`.
- `UNIQUE` que inclui `variant_id` usa `NULLS NOT DISTINCT`, ou uma variante sentinela para produto simples.
- `TIMESTAMP` vira `timestamptz`.
- Remover `images` JSONB de `master_products` e a coluna `completeness_score`.
- Máscara de NCM: `0000.00.00` (a coluna `VARCHAR(10)` já cabe). O exemplo `XX.XX.XX` sai do prompt.
- Apagar `sync_queue` do DLM. A limpeza de push usa a coluna `status`, não `final_status`.

### 8. Usuários para a dupla confirmação

Tabelas `users` e `user_roles` antes do fiscal.

Papéis: `operator`, `fiscal_approver`, `admin`.

`second_review_by` referencia `users` e é diferente de `first_review_by`, com checagem no banco. A nota de consulta à TIPI é obrigatória. `confirmed_by` e `resolved_by` viram chave estrangeira. O dashboard exige sessão.

## P1 — antes de publicar de verdade

### Contratos das APIs

Congelar fixtures sanitizados: produto simples, produto com variação, webhook de estoque, webhook de preço e erro 429, para Bling, Mercado Livre e Nuvemshop. O mapper fecha contra esses arquivos antes de qualquer motor.

Registrar os limites oficiais de Mercado Livre e Nuvemshop no limiter, junto com os 3 req/s do Bling. O full enrich diário persiste um cursor para retomar.

### Modelo de publicação do Mercado Livre

Criar item, atualizar item, grade, foto e estoque são operações diferentes. Vários campos ficam imutáveis depois da criação. O builder é por canal e por operação (`create`, `update`, `stock`, `price`, `pictures`), não um DTO único.

`product_category_mappings` guarda a categoria verificada e os atributos obrigatórios. CREATE no Mercado Livre espera essa categoria. Estoque e preço de item existente não esperam.

### Preço, depósito e token

Preço e estoque seguem as premissas do topo deste documento.

Agenda só via jobs repetíveis do BullMQ. `node-cron` dentro do processo dispara em dobro com duas réplicas.

Tabela `oauth_tokens` com refresh criptografado. Redis fica para cache e lock.

Log estruturado, profundidade da fila, idade do webhook e latência de push. Job com falha tem replay pelo id, sem reprocessar chave de idempotência já concluída.

### Imagens

Dedup só dentro do mesmo `master_product`. O algoritmo descrito no plano é average hash 8x8. Hash entre produtos diferentes no máximo sugere revisão.

Heurística de marca d'água vai para a fila até o limiar ser medido em amostra real.

Download só de hosts do Bling, Mercado Livre e Nuvemshop, com timeout e tamanho máximo.

### Cronograma

Tratar 31–46 dias úteis como a espinha de backend. As 13 telas não cabem em 4–5 dias. Cada fase fecha com um teste nomeado.

## P2

- Coluna `seo_slug`. `keywords` cumprem o papel de tags no score da Nuvemshop.
- O arquivo de NCM e EAN por 5 anos é política do hub. A NF-e permanece no Bling. A citação da Lei 9.430/96 vale para o documento fiscal, que está fora deste escopo.
- `raw_payload` de webhook tem TTL curto.
- Nome de operador fica em `users`.

## Ordem de construção

| Fase | Entrega | Fecha quando |
|---|---|---|
| 0 | Monorepo `api` + `web`, Docker, usuários e papéis | Healthcheck e login de dois papéis |
| 0.5 | Fixtures sanitizados das três APIs | Mapper cobre simples, variação, 429 e webhook |
| 1 | Schema com PK, UNIQUE e `timestamptz` corrigidos | Migrations sobem e descem |
| 2 | Conectores com limiter e token persistido | Contrato verde contra fixture |
| 3 | GVE e NVE puros, sem I/O | Vetores GS1 e NCM `0000.00.00` |
| 4 | PIRE e VIR por predicado | EAN compartilhado cai em quarentena |
| 5 | IQRE com dedup no produto | Duas cores parecidas não colapsam |
| 6 | CQS com a ordem única e a matriz de fonte | Grade A e grade B não sofrem REPLACE |
| 7 | CRE com bloqueio só de CREATE e CONTENT | Estoque não lê o score |
| 8 | WIG: HMAC, INSERT, fila, 200 | Restart depois do 200 não perde evento |
| 9 | APE em três tipos de job | Echo do PUT do hub não reabre push |
| 10 | DLM em job repetível do BullMQ | Uma réplica extra não duplica limpeza |
| 11 | Dashboard: matching e fiscal primeiro | Dois usuários confirmam o mesmo NCM |
| 12 | Ensaio com recorte real do catálogo | Lag de estoque medido |

## Maturidade da spec

Julgamento de 0 a 100. 80 é o ponto em que um agente implementa sem escolher entre regras conflitantes.

| Área | Nota |
|---|---|
| Princípios | 80 |
| Schema | 55 |
| Motores | 50 |
| Fluxos | 45 |
| Contratos de API | 20 |
| Auth | 25 |
| Operação | 35 |
| Cronograma | 40 |
