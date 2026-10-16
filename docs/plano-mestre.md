# Plano Mestre — Bling Sync HUB

Versão de desenvolvimento. Substitui o briefing `PLANO MESTRE REVISADO`.
As regras que se contradiziam naquele texto estão unificadas aqui.
Os prompts por motor ficam de fora: a implementação segue este documento.

Hub de catálogo entre Bling ERP v3, Mercado Livre e Nuvemshop.
O Bling é a fonte soberana de preço, do estoque do vendedor e do dado fiscal. O estoque Full do Mercado Livre fica com o Mercado Livre.
Os canais enriquecem conteúdo e mídia quando o Bling está vazio ou com qualidade baixa.
Enquanto a integração nativa do Bling com o Mercado Livre e a Nuvemshop estiver ligada, ela é quem atualiza estoque e preço de anúncio já publicado. O hub não disputa essa escrita. Na criação confirmada de um anúncio que ainda não existe, o hub envia preço e estoque uma vez, porque a API do canal exige, e não volta a gravá-los.

## 1. Escopo

Entra:

- identidade de produto e variante
- validação de EAN (GS1) e NCM
- qualidade de conteúdo e de imagem
- score de prontidão por canal
- push de conteúdo
- atualização de estoque e preço só com a integração nativa desligada
- criação de anúncio confirmada por uma pessoa, com preço e estoque iniciais enviados uma vez
- kit do Bling (`formato` E) como um SKU vendável, sem explodir os componentes no anúncio
- saldo por depósito e preço da loja Bling de cada canal
- idempotência de webhook, inclusive `product.updated`, `product.deleted`, `stock` e `virtual_stock`
- retenção operacional e arquivo de NCM/EAN

Fica de fora: pedidos, financeiro, emissão de NF-e, frete e serviço (`tipo` diferente de `P`). A nota permanece no Bling.

## 2. Premissas

- Uma conta Bling, um seller Mercado Livre, uma loja Nuvemshop.
- Moeda BRL.
- Todo produto `tipo` P tem ao menos uma variante, conferida no fim da transação. O código do pai (`master_products.bling_sku`) só identifica o cadastro no Bling. O código vendável é `product_variants.bling_sku`. No produto simples (`formato` S) e no kit sem grade (`formato` E) os dois códigos são iguais e a única variante é `is_default`. Na grade (`formato` V), cada variação tem o próprio código e o próprio `bling_variant_id`. Peso e dimensões ficam só na variante. Serviço não entra no cadastro.
- Preço de cadastro é `product_variants.price` e `product_variants.promotional_price`, com `use_promotional`. Preço de loja é `variant_channel_prices.store_price` e `store_promotional_price`, gravados só por `GET /produtos/lojas`. A tabela da loja não guarda o cadastro. Sem `channel_stores`, o canal usa o cadastro e o dashboard mostra a loja como não configurada. Com a loja configurada e sem linha de preço, o passo `price` espera a leitura. `store_price` nulo, depois da leitura, usa o cadastro. `store_price` preenchido é o preço da loja, mesmo quando o número é igual ao cadastro. Promocional da loja entra se `store_promotional_price` for maior que zero. Promocional do cadastro entra se `use_promotional` e o valor for maior que zero. Na Nuvemshop esse preço vai à variante. No Mercado Livre, só à condição com `follow_store_price`. As outras guardam o próprio preço e geram alerta.
- `product_variants.stock` é a soma de `saldo_virtual` dos depósitos com `role = seller` e `include_in_push = true`. A coluna nasce nula e só recebe número depois de `GET /estoques/saldos`. Zero é essa soma já lida. Depósito `ml_full`, `other` ou `unclassified` fica de fora. `estoque.saldoVirtualTotal` não entra na coluna. O passo `stock` e o CREATE enviam o `floor` dessa soma. Com a coluna nula, esse envio espera a leitura. Produto inativo, excluído ou variante `discontinued` envia quantidade zero no anúncio comum e deixa a coluna como está. Lista de depósitos `seller` marcados vazia, depois da leitura, grava zero e abre alerta. O inteiro enviado não é o saldo em `meli_facility`.
- A defasagem aceita de estoque é a do job P1, inferior a 2 minutos, e só vale enquanto o push de estoque não estiver bloqueado. Não vale para o saldo em `meli_facility`, que o hub não escreve.
- A cota do Bling é da conta, não de cada job: 3 req/s, 120.000 chamadas por dia e um limiter só. O full enrich usa o saldo do dia e retoma pelo cursor.

## 3. Princípios

1. Dado fiscal e financeiro do Bling não é sobrescrito por canal.
2. Campo preenchido com lixo vale menos que campo vazio. Todo valor passa por avaliação de qualidade.
3. Identidade é multi-sinal. Um sinal só, inclusive o EAN, não chega a 95 nem vincula sozinho. Auto-vínculo exige dois sinais independentes no mesmo candidato e nenhum sinal forte apontando para outro.
4. Há um job ativo de push por produto, variante, plataforma e tipo. Cada job chama só os endpoints daquele tipo, com os campos do diff lidos do Bling na hora. Não existe PUT do produto inteiro.
5. Toda operação pode ser reexecutada com o mesmo resultado.
6. EAN inválido, NCM divergente ou preço menor ou igual a zero bloqueiam criação, conteúdo e o passo de preço. Estoque e pausa de anúncio já publicado seguem mesmo assim. Preço maior que zero e menor que o custo abre alerta crítico e não bloqueia estoque, pausa nem o passo de preço.
7. Toda operação registra origem, instante, responsável e resultado.
8. Histórico de NCM e EAN não é apagado. O arquivo do hub guarda esses registros por 5 anos. A NF-e continua no Bling.

## 4. Arquitetura

```
Entrada
  Webhook (WIG) · jobs BullMQ · ação manual no dashboard
        │
Identidade
  PIRE (pai) · VIR (variante)
        │
Fiscal
  GVE (EAN) · NVE (NCM)
        │
Enriquecimento
  CQS (conteúdo) · IQRE (imagens)
        │
Prontidão
  CRE · três scores por variante
        │
Push
  APE · STOCK_PRICE · CONTENT · CREATE
        │
Dados
  PostgreSQL 16 · Redis 7 (cache e lock) · arquivo fiscal
        │
  Bling ERP v3 · Mercado Livre · Nuvemshop
```

Escrita do hub no Bling grava `hub_writes` com `origin = hub`.
Webhook que só repete essa escrita é ignorado (`reason = echo`) e não abre push.

## 5. Stack

| Camada | Escolha |
|---|---|
| Runtime | Node.js 20, TypeScript estrito, sem `any` implícito |
| API | Express |
| Dashboard | Next.js, Tailwind, shadcn/ui |
| Banco | PostgreSQL 16 |
| Cache e lock | Redis 7 |
| Fila e agenda | BullMQ, inclusive jobs repetíveis |
| Queries | `pg` direto |
| Migrations | node-pg-migrate, com `up` e `down` |
| Imagens | Sharp |
| Crypto | `node:crypto` (HMAC e SHA-256) |
| Repo | `apps/api` e `apps/web` |
| Ambiente | Docker Compose em desenvolvimento |

Agenda não usa `node-cron` dentro do processo. Duas réplicas disparariam o mesmo horário duas vezes.

Token OAuth fica em `oauth_tokens`, criptografado. Redis guarda cache e lock de fila, não credencial. Perder o Redis não exige reautorizar o Bling nem o Mercado Livre.

Log é estruturado. Métricas mínimas: profundidade da fila, idade do webhook mais antigo e latência de push. Job `failed` tem replay pelo id e não reprocessa chave de idempotência já concluída.

## 6. Papéis

| Papel | Pode |
|---|---|
| `operator` | matching, sugestão de conteúdo, imagens, push manual |
| `fiscal_approver` | aprovar ou rejeitar EAN e NCM |
| `admin` | papéis, depósitos, loja do canal, dono do estoque, modo live, condições que seguem o preço da loja, limites de imagem, aliases |

O login confere `password_hash` (Argon2id) e abre uma linha em `sessions`. O cookie leva o identificador opaco. O banco guarda só o hash desse identificador. Não há aprovação fiscal anônima e não existe coluna `reviewed_by` em texto.

`confirmed_by`, `resolved_by`, `first_review_by` e `second_review_by` são `uuid` de `users`. A segunda revisão de NCM é outro usuário, com `CHECK` no banco, papel `fiscal_approver` nos dois, e nota de consulta à TIPI obrigatória.

Operador e aprovador fiscal não alteram depósito, loja do canal, dono do estoque, modo de enriquecimento nem `follow_store_price`. Essas chamadas respondem 403. A mudança e a linha em `control_changes` acontecem na mesma transação. Sem a linha, a mudança não grava.

## 7. Propriedade dos dados

| Grupo | Dono | Regra |
|---|---|---|
| A | Bling | Preço de venda, preço da loja, custo, estoque por depósito, composição do kit, NCM, CEST, origem fiscal, unidade, fornecedor, SKU. Canal não grava. Divergência gera alerta. |
| A.5 | GVE | EAN da variante. Bling válido é intocável. Bling vazio e externo válido vão para fila humana. Nunca auto-preenche. EAN repetido entre variantes do mesmo produto não vale como dono único |
| B | CQS | Marca, peso e dimensões podem ir ao Bling, só com a rede da seção 8.5. Nome e descrição do Bling não recebem texto de canal. Título e descrição por canal ficam em `channel_content_overrides`. |
| C | IQRE | Imagens, keywords, vídeos e atributos extras. União, sem substituir o que o Bling já tem de atributo. |
| D | APE | Bling envia aos canais. Payload lido na execução. |

Categoria de canal não é o campo `category` do produto. Ela vive em `product_category_mappings`.

### Matriz de fonte (Grupo B)

A primeira fonte válida pelo CQS vence. Fonte grade F ou score menor que 15 é pulada.

| Campo | Ordem |
|---|---|
| Nome do Bling | Não é sobrescrito. Título de SEO do Mercado Livre não entra no cadastro, porque o nome pode ir para a descrição do item da NF-e. Confirmar com o contador antes de qualquer exceção |
| Descrição do Bling | Não é sobrescrita por texto de anúncio |
| Título e descrição do canal | `channel_content_overrides`, por plataforma. Não gravam em `master_products` |
| Marca | Maior grade. Empate fica no Bling e vira SUGGEST |
| Peso e dimensões | Só com as três medidas preenchidas e concordância dentro de 5%. Senão, SUGGEST |
| Categoria interna | Bling permanece. Path de canal não sobrescreve |

### Decisão de enriquecimento

A primeira regra que casar vence. Grades: F 0–20, D 21–40, C 41–60, B 61–80, A 81–100.

1. Externo grade F, ou score externo menor que 15: KEEP.
2. Bling grade A: KEEP.
3. Bling grade F e externo pelo menos C: REPLACE.
4. Bling grade D, externo B ou A, delta de pelo menos 15: REPLACE.
5. Delta de pelo menos 30 com Bling em C ou D: REPLACE, com `quality_history`.
6. Delta 15–29, ou Bling grade B com qualquer delta: SUGGEST.
7. Qualquer outro caso: KEEP.

REPLACE automático não ocorre em grade A nem em grade B.

Avaliadores:

- Nome: penaliza genérico ("produto", "item", "a definir"), menos de 10 caracteres e ALL CAPS.
- Descrição: menos de 30 caracteres é F; "a definir", "consulte" e "ver imagem" penalizam.
- Marca: penaliza "genérico", "sem marca", "n/a", 1–2 caracteres e string muito longa.
- Peso: penaliza 0, valores sentinela (0.001, 0.01, 1, 100) e acima de 50 kg.
- Dimensões: as três medidas ou nenhuma. Penaliza zeradas e 1×1×1.
- Categoria interna: penaliza "geral" e "outros".

## 8. Motores

| Motor | Responsabilidade |
|---|---|
| PIRE | Vínculo do produto pai |
| VIR | Vínculo da variante e lacunas da matriz |
| GVE | EAN/GTIN |
| NVE | NCM |
| CQS | Qualidade e KEEP / REPLACE / SUGGEST |
| IQRE | Imagens |
| CRE | Três scores por variante |
| APE | Push |
| WIG | Webhook |
| DLM | Retenção, partição e arquivo |

### 8.1 PIRE

Sinais fortes e independentes: SKU normalizado com um único candidato em `product_variants.bling_sku`, EAN com GVE válido e um único dono, nome com Jaro-Winkler de pelo menos 0,90 no mesmo candidato. Preço (±10%) e peso (±15%) não contam como um desses dois. EAN de anúncio compara com a variante. GTIN compartilhado não é sinal.

Auto-vínculo, com score 95, só quando pelo menos dois sinais fortes apontam para o mesmo candidato e nenhum sinal forte aponta para outro. Um sinal só fica em sugestão, com score no máximo 80. EAN sozinho não vale 95. Conflito entre sinais vai para quarentena. Vínculo manual confirmado vale 100.

O score gravado leva o breakdown em `match_signals`. Dois candidatos no mesmo patamar vão para quarentena.

Quarentena não expira. O anúncio fica em `platform_items` com status `quarantine` ou `suggestion` até uma pessoa decidir. `matching_queue` guarda o payload e as sugestões dessa decisão, com `expires_at` nulo enquanto está pendente. Sessenta dias na fila não mudam o status, não devolvem o pai para `unmatched` e não apagam `platform_product_id`.

A resolução grava a decisão em `platform_items` antes de liberar a fila:

- confirmar cria `platform_links` e marca o item como `linked`
- rejeitar um candidato grava o par em `match_rejections` e tira esse pai da sugestão; o anúncio continua em `suggestion` ou `quarantine`
- produto novo ou ignorar o anúncio inteiro marca `new_product` ou `dismissed`, sem `master_product_id`

O PIRE consulta `match_rejections` antes do auto-vínculo e antes de montar a sugestão. Um par rejeitado não volta a casar nem a aparecer no dashboard, mesmo que SKU ou EAN coincidam na rodada seguinte. Candidato novo, que não esteja nessa tabela, ainda pode ser sugerido. A recusa sai só por ação explícita de desfazer.

O sync seguinte não abre outra fila para item `linked`, `dismissed` ou `new_product`. Em item ainda aberto, atualiza as sugestões já sem os pares recusados. O DLM apaga só o payload da `matching_queue` 60 dias depois do status terminal. O item, o vínculo e as recusas permanecem.

Nome fuzzy usa Jaro-Winkler depois de minúsculas, remoção de acento e stopwords (`de`, `da`, `do`, `com`, `para`, `e`, `o`, `a`, `em`). Similaridade a partir de 0.90 entra na sugestão com peso maior que a faixa 0.70–0.89. Abaixo de 0.70 o nome não sugere.

No anúncio legado, o SKU da variação sai de `seller_sku`, `seller_custom_field` ou `attributes[SELLER_SKU]`, nessa ordem. No User Product o SKU sai do item da variação, pelos mesmos campos. O campo usado fica em `platform_sku_field`. O PIRE agrupa os itens da mesma `family_id` num único `master_product`. Dois itens da mesma família não viram dois produtos pai.

`family_id` não é um quarto sinal forte. `family_confidence` mede se os itens dessa chave apontam para o mesmo `master_product`. O cálculo junta os sinais fortes de todos os itens da família. Dois sinais fortes no mesmo candidato, e nenhum em outro, valem 95 e abrem um `platform_links` com `platform_product_id = family_id`. Um sinal forte só fica em sugestão, com score no máximo 80, sem `platform_links`. Sinais fortes em candidatos diferentes vão para quarentena: a família não se parte e não nasce vínculo. Confirmação manual da família vale 100. `family_id` ausente deixa `family_confidence` nulo e o item não entra em família. O breakdown fica em `match_signals.family_id`, com os itens que concordam e os que conflitam. No User Product há um `platform_items` por `family_id`, e o `best_score` da fila é esse número.

Item novo com `family_id` já vinculada entra no pai existente. Sinal forte para outro pai manda só esse item à quarentena. Não abre segundo pai e não baixa o `family_confidence` já gravado. Na migração UPtin, `family_confidence` recebe o `match_confidence` do vínculo legado e o PIRE não recalcula a família.

CREATE só com vínculo confirmado por uma pessoa, para lacuna `missing_ml` ou `missing_ns`. Vale com a integração nativa dona do estoque e do preço. O preço e o estoque iniciais vão nessa criação. Enquanto `stock_price = bling_native`, isso não abre atualização contínua. Enriquecimento, ainda em shadow, só com vínculo confirmado ou com auto-vínculo de score pelo menos 95 e dois sinais fortes. Abaixo disso não há REPLACE nem override.

### 8.2 VIR

Roda depois do pai resolvido. Auto-vínculo da variante:

- SKU da variante com um único candidato
- EAN da variante com GVE válido e um único dono
- `comboKey` com todos os eixos normalizados e um único candidato

`comboKey` ordena os eixos pelo nome canônico e concatena, por exemplo `cor:Azul|tamanho:M`. Alias é obrigatório antes do match (`Medium` e `Médio` viram o mesmo valor). Eixo ou valor desconhecido vai para revisão e não casa sozinho.

Produto simples liga na variante `is_default`. No legado, simples é o item sem `variations`. No User Product, simples é a família com um único `user_product_id`.

O Mercado Livre tem dois formatos. A conta com a tag `user_product_seller` publica e sincroniza no formato atual. Item antigo permanece no legado até a notificação de migração.

| | Legado | User Product |
|---|---|---|
| Grade | um item e um array `variations` | uma família (`family_id`, `family_name`) de vários itens |
| Variante vendável | `variation_id` | `user_product_id` |
| Preço | na variação | em cada item, que é uma condição de venda |
| Estoque | na variação | no `user_product_id` |
| CREATE | inclui a variação no item | cria outro item com o mesmo `family_name`, sem array `variations` |

Atributos `PARENT_PK` são iguais em todos os itens da família. O `comboKey` sai dos atributos `CHILD_PK` com tag `allow_variations`. Vários itens com o mesmo `user_product_id` são condições de venda da mesma variante, não linhas novas na matriz. `family_name` não passa do `max_title_length` do domínio e só muda se nenhuma condição de venda tiver venda.

A notificação de migração (UPtin) troca o `variation_id` antigo pelos novos `item_id` e `user_product_id`, no mesmo `variant_id` do Bling. Não cria outro `master_product`. `family_confidence` copia o `match_confidence` já gravado.

Lacunas em `variant_matrix_analysis`:

| Status | Significado |
|---|---|
| `missing_ml` / `missing_ns` | existe no Bling e falta no canal; candidato a CREATE |
| `extra_ml` / `extra_ns` | existe no canal sem Bling; alerta crítico (venda sem lastro de estoque e de nota) |

### 8.3 GVE

Validação estrutural: 8, 12, 13 ou 14 dígitos, dígito GS1 (pesos 3/1 da direita, módulo 10), rejeição de placeholder e de sequência. Validação contextual: prefixo GS1 Brasil 789/790, ISBN/ISSN, faixa interna 200–299.

| Situação | Ação |
|---|---|
| Bling com EAN válido | Intocável. Externo diferente: alerta crítico e bloqueio de CONTENT/CREATE do produto |
| Bling vazio e externo válido | `ean_pending_validation`. Nunca auto-preenche. Expira em 30 dias |
| Bling com checksum inválido | `fiscal_risk_flag = true` e bloqueio de CONTENT/CREATE |
| EAN válido repetido entre variantes do mesmo produto | `ean_status = duplicate` e `fiscal_risk_flag = true` em cada variante que carrega esse EAN. CONTENT e CREATE bloqueiam só essas variantes. O EAN permanece no Bling e não entra em `ean_pending_validation`. Não é sinal forte |
| Placeholder | Descarte e log técnico |

A comparação usa só os dígitos. EAN vazio não conta. Variante `discontinued` não entra. As variantes do mesmo pai com outro EAN seguem a própria linha do GVE. O alerta é um por produto e EAN. Quando o GVE seguinte encontra uma única variante não descontinuada com esse EAN, `duplicate` sai e `fiscal_risk_flag` cai se o checksum for válido. EAN igual em produtos diferentes continua no PIRE: não é sinal e cai em quarentena. Não usa esta linha.

STOCK_PRICE de anúncio já publicado não espera essa fila.

### 8.4 NVE

NCM do Mercado Livre não entra no enriquecimento automático. Formato exibido: `0000.00.00` (8 dígitos). A limpeza remove ponto, espaço e hífen. Capítulo válido: 01–97. Placeholder (`00000000`, `99999999`, `12345678`) é inválido.

| Situação | Ação |
|---|---|
| ML truncado ou placeholder | Descarte e log |
| Bling com NCM válido | Mantém o Bling. Divergência: alerta crítico e bloqueio de CONTENT/CREATE |
| Bling vazio e ML com 8 dígitos válidos | Sugestão com duas confirmações de usuários diferentes, nota de TIPI e TTL de 15 dias |
| Bling inválido | `ncm_fiscal_risk = true` e bloqueio de CONTENT/CREATE |
| NCM em conflito entre variantes | `ncm_status = conflict` e `ncm_fiscal_risk = true` no pai. CONTENT e CREATE do produto bloqueiam. Nenhum dos códigos em conflito vira sugestão nem substitui o `master_products.ncm` já gravado |

NCM não é alterado por processo automático. Cada decisão gera linha imutável em `ncm_audit_log`. A variante não tem NCM próprio. A sugestão aprovada grava em `master_products.ncm`, que é o valor do Bling.

O conflito compara o NCM de cada variante não descontinuada na mesma passagem: o código que veio no payload da variação no Bling e o atributo de NCM do anúncio vinculado no Mercado Livre. A limpeza é a desta seção. Placeholder e código inválido não entram na conta. Dois códigos válidos diferentes no mesmo pai são o conflito. Código vazio não conta. O mesmo código em todas as variantes não é conflito. O alerta é um por produto, em `ncm_divergence_alerts`. Essa linha é avaliada antes da sugestão. Quando o NVE seguinte não encontra dois códigos válidos diferentes, `conflict` sai. `ncm_fiscal_risk` permanece se o NCM do pai for inválido.

### 8.5 CQS

Aplica a decisão da seção 7 a marca, peso e dimensões. Nome e descrição do Bling ficam de fora. Título e descrição de canal vão para `channel_content_overrides`. Grupo A não é escrito.

O modo padrão é `shadow`. A decisão e o valor proposto ficam em `quality_history` com `applied = false`. Não chama `applyToBling` e não faz push do texto proposto. Peso e dimensão que já estão na variante do Bling seguem para a Nuvemshop pelo passo `measures`, mesmo em `shadow`. Estoque, pausa e preço não passam por esse modo.

`enrichment_controls` tem um kill switch por plataforma. Com o switch ligado, aquela origem não gera escrita nem push de conteúdo. O padrão de `max_replaces_per_run` limita quantos REPLACE em modo `live` uma execução aplica. O restante vira SUGGEST e espera o ciclo seguinte.

Em `live`, o REPLACE chama `applyToBling`, grava `hub_writes` e marca `quality_history.applied = true`. Reverter um campo lê o `old_value` dessa linha, grava de volta no Bling e abre outra linha em `quality_history` com `source = revert`. Linha de shadow não é revertida, porque não chegou a ser escrita.

### 8.6 IQRE

Imagem é linha em `product_images`, não JSON no produto. O enriquecimento não processa as imagens na mesma chamada. Ele grava uma linha em `image_processing_queue` por URL e segue. Um worker BullMQ consome a fila, uma imagem por vez, com `FOR UPDATE SKIP LOCKED`, pela ordem de `available_at` no índice parcial da seção 9.5.

Para um catálogo de 5.000 produtos e 8 imagens, são 40.000 downloads. A sync do produto não espera esse volume. O CRE dessa rodada usa o score de imagem que já existir. Quando o fechamento do produto termina, um job recalcula o CRE só desse produto.

Etapas:

1. Coleta grava url, fonte, seller e posição na fila. URL já normalizada do mesmo produto não abre outra linha.
2. O worker baixa, calcula o average hash e valida formato, tamanho e dimensão. A linha passa a `fetched`. Download só de hosts do Bling, Mercado Livre e Nuvemshop, com timeout e tamanho máximo.
3. Quando nenhuma imagem daquele produto resta em `queued`, um job `iqre.finalize` deduplica só dentro do `master_product`. O fingerprint é average hash 8×8 (64 bits). Distância de Hamming até 5 trata como a mesma imagem e mantém a maior resolução. Hash parecido entre produtos diferentes no máximo sugere revisão.
4. Direitos: seller nosso é `owned`; seller diferente vai para `image_rights_review_queue`; heurística de marca d'água também vai para essa fila, até o limiar ser medido em amostra real. Imagem de terceiro não é publicada sem aprovação.
5. Score: resolução 40, fonte 25, formato 15, direitos 20.
6. Ordenação pelo score. As linhas da fila passam a `done`. Capa exige score de pelo menos 55, direitos que não sejam `third_party_risk`, sem marca d'água pendente, e pelo menos 500×500.

Falha no download ou na validação incrementa `attempts`, devolve a linha a `queued` com atraso e, após 4 tentativas, fica `failed`. `failed` permanece para replay. Não bloqueia o fechamento das outras imagens do produto.

Limites iniciais, editáveis em `platform_image_limits`:

| Plataforma | Máximo | Mínimo | Observação |
|---|---|---|---|
| Mercado Livre | 10 | 500×500 | Capa com fundo neutro |
| Nuvemshop | 50 | 200×200 | Alt text recomendado |
| Bling | 10 | 100×100 | Até 10 imagens |

### 8.7 CRE

Três scores de 0 a 100 por variante. O KPI do produto é o menor score entre os canais da pior variante.

Score Bling (fiscal 45, operacional 35, identificação 20). Publicar conteúdo: 70. Premium: 90.

Score Mercado Livre (título 25, conteúdo 20, imagens 20, atributos 20, logística 15). Publicar conteúdo: 50. Premium: 75. CREATE espera categoria verificada e atributos obrigatórios em `product_category_mappings`.

Score Nuvemshop (conteúdo 35, SEO 25, imagens 20, conversão 20). Publicar conteúdo: 45. Premium: 85. SEO usa `keywords` como tags, `meta_description` e `seo_slug`.

O score não bloqueia STOCK_PRICE. Bloqueia CONTENT abaixo do threshold e CREATE quando o canal não está publicável.

Cada cálculo guarda bloqueios e as três melhorias de maior ganho. Histórico vai para `channel_readiness_history`.

### 8.8 APE

Tipos de job:

| Tipo | Quando segue |
|---|---|
| `STOCK_PRICE` | Sempre em anúncio já publicado, exceto preço menor ou igual a zero, que bloqueia só o preço |
| `CONTENT` | Vínculo confirmado, sem bloqueio fiscal e score do canal acima do threshold |
| `CREATE` | O de CONTENT, mais categoria verificada no Mercado Livre quando o canal for ML. Independe de quem atualiza estoque e preço do anúncio já publicado |

O corpo não fica gravado no job. Na execução o worker lê o Bling e monta só o passo que ainda não concluiu. No retry, lê de novo e não repete passo `completed`.

Uma chamada com o produto inteiro não serve. Preço, estoque, descrição e imagens são endpoints diferentes, e um corpo completo regrava edição feita no canal em campo que o hub não ia mexer. Cada passo envia somente os campos daquele endpoint que estão no diff do job. Campo ausente do corpo permanece como está no canal. Campo imutável depois da criação não entra no update.

| Canal | Passo | Envia |
|---|---|---|
| Mercado Livre | `stock` | `floor` de `product_variants.stock` só no local que a seção 10.8 permite escrever. `meli_facility` não entra. Coluna nula espera a leitura |
| Mercado Livre | `price` | preço da seção 10.7 só na condição com `follow_store_price`. Condição sem a marca não é escrita |
| Mercado Livre | `description` | descrição do `channel_content_overrides` em modo `live`, não o nome do Bling |
| Mercado Livre | `pictures` | a lista de imagens, só se o conjunto mudou |
| Nuvemshop | `stock` | `floor` de `product_variants.stock`, sem preço e sem peso. Coluna nula espera a leitura |
| Nuvemshop | `price` | preço publicado da seção 10.7, sem estoque e sem peso |
| Nuvemshop | `measures` | peso e dimensões da variante, sem preço e sem estoque |
| Nuvemshop | `product` | título e descrição do override em modo `live`; marca e SEO só se estiverem no diff |
| Nuvemshop | `images` | imagens à parte, só se o conjunto mudou |

`STOCK_PRICE` abre `stock`, `pause` e `price` somente quando `channel_sync_owners.stock_price = hub`, e só em anúncio já publicado. Com `bling_native`, esses passos nascem `skipped` e nenhum job de estoque ou preço é criado para anúncio existente. Anúncio com estoque só em `meli_facility`, ou item legado com `logistic_type = fulfillment`, também deixa o passo `stock` em `skipped`, motivo `ml_full`, mesmo com dono `hub`. Preço desse anúncio continua no passo `price`. `CONTENT` abre os passos de texto, de imagem e, na Nuvemshop, `measures` quando o diff citar peso ou dimensão. `measures` usa `PATCH /products/{id}/variants` com `id`, `weight`, `width`, `height` e `depth`. Não envia `price`, `promotional_price` nem `stock`. Não usa `PUT /products/{id}/variants`: esse PUT troca a coleção e apaga a variante que ficar de fora. Preço e estoque da Nuvemshop saem só nos passos `price` e `stock`, e só com `stock_price = hub`. Na criação, o corpo que nasce a variante pode levar peso e dimensão junto do preço e do estoque iniciais. Na atualização, os passos não se misturam. `CREATE` não depende de `stock_price`. Segue a ordem que a API exige para nascer o anúncio (item, depois descrição, imagens e variante), ainda em chamadas separadas. O passo que abre o item leva o preço publicado da seção 10.7 e o estoque publicado do Bling, lidos na execução, porque o canal não cria anúncio sem esses dois. O estoque inicial é o do vendedor. Não escreve `meli_facility` e não nasce anúncio Full. Esse envio é único: ao concluir, se `stock_price = bling_native`, não abre `STOCK_PRICE`. Quem passa a atualizar estoque e preço é a integração nativa. Se `stock_price = hub`, os jobs seguintes seguem a regra do anúncio já publicado. Antes da primeira chamada, o worker busca o SKU no canal. Se o anúncio já existir, o CREATE fica `cancelled` e o vínculo usa o anúncio encontrado. Não nasce um segundo. No User Product, a variação nova é um item na família, não um POST em `variations`.

Prioridade e janela de agregação:

| Prioridade | Campos | Janela | Teto de execução |
|---|---|---|---|
| P1 | preço, estoque | 1 s | 2 min |
| P2 | EAN, título, ativo | 5 s | 15 min |
| P3 | peso, dimensões, marca, descrição | 30 s | 1 h |
| P4 | imagens, atributos, keywords, vídeos | 60 s | 4 h |

Há no máximo uma janela aberta por produto, variante, plataforma e tipo. O índice único `push_jobs_active` cobre `status = pending`. Job P1 novo com job P1 ainda `pending` promove o mesmo job. Job já `locked` não entra nesse índice e não é alterado; a mudança abre outra janela.

Retry de erro transitório (timeout, 429, 5xx): imediato, 30 s, 5 min, 1 h. Depois, `failed` e alerta. Lock do job expira em 5 minutos. Locks vencidos voltam a `pending` a cada minuto.

Bloqueio fiscal não é falha transitória e não é um portão na frente do job inteiro. `checkPushBlockers()` roda por passo, não incrementa `attempts` e não é chamado em `stock` nem em `pause`.

| Passo | NCM, EAN, score ou vínculo | Preço menor ou igual a zero |
|---|---|---|
| `stock` | segue | segue, inclusive estoque zero |
| `pause` | segue | segue |
| `price` | segue no anúncio já publicado | `blocked`, sem retry |
| `description`, `pictures`, `product`, `images`, `measures` | `blocked`, sem retry | `measures` não leva preço, então preço zero não o bloqueia. Os outros ficam `blocked` se levarem preço |
| `CREATE` | `blocked`, sem retry | `blocked` |

Um NCM inválido não impede o estoque zero nem a pausa de chegar ao Mercado Livre. O job fica `blocked` só quando não resta passo executável. Passo `stock` ou `pause` concluído não é desfeito pelo bloqueio dos outros. O alerta é um por produto, plataforma, passo e motivo. A mesma causa não abre outro. Quando o motivo some, o próximo delta cria um job novo. O passo antigo não volta para `pending`.

Preço abaixo do custo não entra nessa tabela. `cost_price` nulo não compara. Preço maior que zero e menor que `cost_price` abre um alerta crítico por variante, plataforma e preço à venda. A mesma causa não abre outro. Quando o preço fica igual ou acima do custo, o alerta resolve. Estoque, pausa, o passo `price` e o CREATE seguem. Comissão de canal não entra na conta.

Não devolver um campo à plataforma que o originou se o valor já é igual.

### 8.9 WIG

Ordem do controller:

1. Ler o raw body.
2. Validar HMAC com comparação de tempo constante. Assinatura inválida responde 401 e não persiste.
3. Inserir `webhook_events` com SHA-256 completo (64 hex). Chave: `source:event_type:resource_id:content_hash`. Conflito de chave responde 200 e para.
4. Enfileirar no BullMQ.
5. Só então responder 200.

O worker, depois do 200:

1. Lock do produto por 60 s. Lock vencido não segura a fila. Segundo evento espera com atraso de 2 s.
2. Ordem pelo `event_timestamp` do Bling, com tolerância de 1 s. Evento mais antigo que o watermark do campo fica `ignored`.
3. Conteúdo idêntico ao último processado daquele recurso fica `ignored`.
4. `detectChanges`, agregação, watermark, snapshot e `sync_logs` com a mesma chave de idempotência.
5. Liberar o lock no `finally`.

`setImmediate` não é fila. Restart depois do 200 não perde o evento, porque o INSERT já aconteceu.

Os passos acima são o worker de `source = bling`. Mercado Livre e Nuvemshop entram pela mesma ordem do controller, com o segredo de assinatura de cada um, e seguem o fluxo 10.5. Esse worker não lê o evento como mudança do Bling e não abre push a partir do payload do canal.

### 8.10 DLM

| Alvo | Retenção | Método |
|---|---|---|
| `enrichment_staging` | 30 dias depois de aplicado | DELETE em lote |
| `matching_queue` | 60 dias depois do status terminal; pendente não expira | DELETE em lote |
| `enrichment_suggestions` | 30 dias depois de resolvido | DELETE em lote |
| `image_rights_review_queue` | 90 dias depois de resolvido | DELETE em lote |
| `image_processing_queue` | 7 dias depois de `done`; `failed` e `queued` não expiram | DELETE em lote |
| `push_jobs` e `push_execution` operacional | 7 dias depois do status terminal | DELETE em lote |
| `webhook_events.raw_payload` | 30 dias depois de concluído | DELETE em lote |
| `sync_logs`, `quality_history`, `channel_readiness_history`, `push_execution_logs` | 12 meses | DROP da partição |
| `identity_resolution_logs` | 3 meses | DROP da partição |
| `divergence_alerts` resolvido | 90 dias, depois arquivo | MOVE |
| `ncm_audit_log`, `ean_validation_history` | 18 meses operacionais, depois arquivo por 5 anos | MOVE |
| tabelas `*_archive` | 5 anos, sem UPDATE e sem DELETE | — |
| `dlm_job_runs` | permanente | — |
| `control_changes` | permanente | — |

Não existe tabela `sync_queue`. A limpeza de push usa a coluna `status` (`completed`, `failed`, `blocked`, `superseded`, `cancelled`).

Lote com `LIMIT` e `FOR UPDATE SKIP LOCKED`. Toda execução vai para `dlm_job_runs`. Falha dispara alerta.

Horários em America/Sao_Paulo, via BullMQ:

- limpeza TTL, diária, 02:00
- partições, dia 1, 03:00 (cria o mês seguinte e remove o que passou da retenção)
- arquivo, domingo, 04:00
- saúde, dia 1, 09:00

## 9. Schema

Timestamps são `timestamptz`. PK de tabela particionada é `(created_at, id)`. Produto simples usa a variante default, então `variant_id` operacional é `NOT NULL`.

```
master_products
  ├── product_variants
  │     └── variant_attributes ──► attribute_axes
  │                                   └── attribute_value_aliases
  └── product_axes ──────────────► attribute_axes
```

`product_axes` é a grade declarada do pai. `variant_attributes` é o valor daquela variante em cada eixo. Não há array de UUID no produto.

### 9.1 Identidade e acesso

```sql
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE,
  name          text NOT NULL,
  password_hash text NOT NULL,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_roles (
  user_id uuid NOT NULL REFERENCES users(id),
  role    text NOT NULL CHECK (role IN ('operator', 'fiscal_approver', 'admin')),
  PRIMARY KEY (user_id, role)
);

CREATE TABLE sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id),
  token_hash    text NOT NULL UNIQUE,
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE oauth_tokens (
  provider            text PRIMARY KEY CHECK (provider IN ('bling', 'mercadolivre', 'nuvemshop')),
  access_token_enc    bytea NOT NULL,
  refresh_token_enc   bytea,
  expires_at          timestamptz NOT NULL,
  rotated_at          timestamptz,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE stock_warehouses (
  bling_warehouse_id text PRIMARY KEY,
  name               text NOT NULL,
  role               text NOT NULL DEFAULT 'unclassified'
                       CHECK (role IN ('unclassified', 'seller', 'ml_full', 'other')),
  include_in_push    boolean NOT NULL DEFAULT false,
  CHECK (role = 'seller' OR include_in_push = false)
);

CREATE TABLE channel_stores (
  platform      text PRIMARY KEY CHECK (platform IN ('mercadolivre', 'nuvemshop')),
  bling_loja_id text NOT NULL UNIQUE,
  name          text NOT NULL
);

CREATE TABLE control_changes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target      text NOT NULL CHECK (target IN (
                'stock_warehouse', 'channel_store', 'channel_sync_owner',
                'enrichment_control', 'selling_condition'
              )),
  target_key  text NOT NULL,
  field       text NOT NULL,
  old_value   text,
  new_value   text,
  origin      text NOT NULL DEFAULT 'admin' CHECK (origin IN ('admin', 'system')),
  changed_by  uuid REFERENCES users(id),
  changed_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (origin = 'admin' AND changed_by IS NOT NULL)
    OR (
      origin = 'system'
      AND changed_by IS NULL
      AND target = 'selling_condition'
      AND field = 'follow_store_price'
    )
  )
);

CREATE TABLE sync_cursors (
  job_name     text PRIMARY KEY,
  cursor_value text,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE hub_writes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bling_id       text NOT NULL,
  request_id     text NOT NULL UNIQUE,
  changed_fields text[] NOT NULL,
  written_at     timestamptz NOT NULL DEFAULT now()
);
```

A chave de criptografia fica no ambiente, não no Redis. `access_token_enc` e `refresh_token_enc` não são texto puro.

A renovação trava a linha com `SELECT … FOR UPDATE`. Se a resposta trouxer outro refresh token, os dois valores novos são gravados na mesma transação, antes de soltar o lock. O refresh anterior deixa de ser usado. Bling e Mercado Livre são tratados como se rotacionassem o refresh a cada renovação, até a documentação de cada um confirmar o contrário. Duas réplicas não renovam o mesmo token. A Nuvemshop usa a mesma tabela, com `refresh_token_enc` nulo. O segredo de HMAC do webhook continua no ambiente.

`control_changes` é a trilha do princípio 7 para o que move estoque e preço. Uma linha por campo alterado, com `old_value`, `new_value`, `origin`, `changed_by` e `changed_at`. Com `origin = admin`, `changed_by` é o usuário da sessão. `origin = system` e `changed_by` nulo só valem para `follow_store_price`. O `target_key` de `selling_condition` é o `item_id`. `old_value` e `new_value` desse campo são `true` ou `false`.

| Alvo | Campos |
|---|---|
| `stock_warehouse` | `role`, `include_in_push` |
| `channel_store` | `bling_loja_id`, `name` |
| `channel_sync_owner` | `stock_price`, `content` |
| `enrichment_control` | `mode`, `kill_switch`, `max_replaces_per_run` |
| `selling_condition` | `follow_store_price` |

A tabela não recebe UPDATE nem DELETE. O DLM não a limpa. Depósito novo vindo da API, ainda `unclassified`, não gera linha. A classificação feita pelo admin gera. O seed inicial grava `old_value` nulo. Cada gravação de `follow_store_price`, inclusive o INSERT da condição, gera uma linha nesta tabela na mesma transação. `old_value` nulo marca o nascimento. Valor igual ao anterior não gera outra linha. Sem a linha, `follow_store_price` não muda.

### 9.2 Produto e variante

```sql
CREATE TABLE master_products (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bling_id            text NOT NULL UNIQUE,
  bling_sku           text NOT NULL UNIQUE,
  ncm                 varchar(8),
  cest                text,
  tax_origin          smallint,
  unit                varchar(10),
  requires_cest       boolean NOT NULL DEFAULT false,
  ncm_status          text NOT NULL DEFAULT 'unknown',
  ncm_validated_at    timestamptz,
  ncm_validated_by    uuid REFERENCES users(id),
  ncm_fiscal_risk     boolean NOT NULL DEFAULT false,
  bling_tipo          text NOT NULL DEFAULT 'P' CHECK (bling_tipo IN ('P', 'S', 'N')),
  bling_formato       text NOT NULL DEFAULT 'S' CHECK (bling_formato IN ('S', 'V', 'E')),
  name                text,
  description         text,
  short_description   text,
  brand               text,
  category            text,
  meta_description    varchar(160),
  seo_slug            text,
  warranty_months     smallint,
  keywords            text[],
  videos              jsonb NOT NULL DEFAULT '[]',
  extra_attributes    jsonb NOT NULL DEFAULT '{}',
  matching_status     text NOT NULL DEFAULT 'unmatched',
  catalog_status      text NOT NULL DEFAULT 'active' CHECK (catalog_status IN ('active', 'inactive', 'deleted')),
  status_changed_at   timestamptz,
  last_bling_snapshot jsonb,
  last_bling_sync     timestamptz,
  last_ml_sync        timestamptz,
  last_ns_sync        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE product_variants (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  master_product_id  uuid NOT NULL REFERENCES master_products(id),
  bling_variant_id   text UNIQUE,
  bling_sku          text NOT NULL UNIQUE,
  is_default         boolean NOT NULL DEFAULT false,
  bling_formato      text NOT NULL DEFAULT 'S' CHECK (bling_formato IN ('S', 'E')),
  stock_mode         text CHECK (stock_mode IN ('physical', 'virtual')),
  price              numeric(10,2),
  promotional_price  numeric(10,2),
  use_promotional    boolean NOT NULL DEFAULT false,
  cost_price         numeric(10,2),
  stock              numeric(12,3),
  net_weight         numeric(8,3),
  gross_weight       numeric(8,3),
  height             numeric(8,2),
  width              numeric(8,2),
  depth              numeric(8,2),
  ean                varchar(14),
  ean_status         text NOT NULL DEFAULT 'unknown',
  ean_validated_at   timestamptz,
  ean_validated_by   uuid REFERENCES users(id),
  fiscal_risk_flag   boolean NOT NULL DEFAULT false,
  quality_scores     jsonb NOT NULL DEFAULT '{}',
  is_active          boolean NOT NULL DEFAULT true,
  variant_status     text NOT NULL DEFAULT 'active' CHECK (variant_status IN ('active', 'inactive', 'discontinued')),
  last_bling_sync    timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_one_default_variant
  ON product_variants (master_product_id)
  WHERE is_default;
```

`bling_sku` da variante já é único no catálogo. Um segundo `UNIQUE (master_product_id, bling_sku)` não restringe nada. Não há `ncm_override` nem `name_override`. O NCM que vale é `master_products.ncm`. O nome que vale no Bling, e o que pode ir para a NF-e, é `master_products.name`. Título de canal fica em `channel_content_overrides` e não substitui esse nome. `cest`, `tax_origin` e `requires_cest` são espelho do Bling: o hub copia, mostra na ficha e não usa esses campos para bloquear push nem para gravar de volta. O anúncio não carrega o dado fiscal da nota, então não há alerta de divergência com o canal.

Forma conferida por trigger adiada, no commit:

- Produto simples: pai `formato` S, uma variante `formato` S, `is_default`, `bling_variant_id` nulo, `bling_sku` igual ao do pai, sem linha em `variant_attributes` nem em `product_components`.
- Kit sem grade: pai `formato` E, uma variante `formato` E e `is_default`, `stock_mode` preenchido. Componentes ficam em `product_components`.
- Grade: pai `formato` V, nenhuma variante `is_default`, toda variante com `bling_variant_id` e `formato` S ou E, e os eixos de cada variante iguais aos de `product_axes`. Variante E tem `stock_mode` e componentes.

`has_variants` não é coluna. Há grade quando existe variante com `bling_variant_id`. PIRE usa o SKU do pai só para achar o `master_product`. Preço, estoque, EAN, peso e dimensões saem da variante. `product_variants.stock` é o cache da seção 10.7: nulo até a primeira leitura de saldo e, depois, a soma. Não guarda o `floor` enviado ao canal. `stock_mode` só existe em variante com `bling_formato = E` e não muda o que a coluna guarda.

```sql
CREATE TABLE product_components (
  kit_variant_id       uuid NOT NULL REFERENCES product_variants(id),
  component_bling_id   text NOT NULL,
  component_variant_id uuid REFERENCES product_variants(id),
  quantity             numeric(12,4) NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (kit_variant_id, component_bling_id),
  CHECK (kit_variant_id IS DISTINCT FROM component_variant_id)
);

CREATE TABLE variant_stock_balances (
  variant_id         uuid NOT NULL REFERENCES product_variants(id),
  bling_warehouse_id text NOT NULL REFERENCES stock_warehouses(bling_warehouse_id),
  saldo_fisico       numeric(12,3) NOT NULL DEFAULT 0,
  saldo_virtual      numeric(12,3) NOT NULL DEFAULT 0,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (variant_id, bling_warehouse_id)
);

CREATE TABLE variant_channel_prices (
  variant_id              uuid NOT NULL REFERENCES product_variants(id),
  platform                text NOT NULL REFERENCES channel_stores(platform),
  store_price             numeric(10,2),
  store_promotional_price numeric(10,2),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (variant_id, platform)
);
```

`product_variants.price`, `promotional_price` e `use_promotional` são o preço de cadastro. `variant_channel_prices` é só o vínculo da loja: `store_price` e `store_promotional_price`. Não há coluna de cadastro nessa tabela, e o `GET /produtos/lojas` não copia `product_variants.price` para ela. A escolha entre os dois está na seção 10.7.

### 9.3 Atributos e vínculos

```sql
CREATE TABLE attribute_axes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name  text NOT NULL UNIQUE,
  display_name    text NOT NULL,
  bling_key       text,
  ml_attribute_id text,
  ns_option_name  text,
  sort_order      smallint NOT NULL DEFAULT 0
);

CREATE TABLE product_axes (
  master_product_id uuid NOT NULL REFERENCES master_products(id),
  axis_id           uuid NOT NULL REFERENCES attribute_axes(id),
  sort_order        smallint NOT NULL DEFAULT 0,
  PRIMARY KEY (master_product_id, axis_id)
);

CREATE TABLE attribute_value_aliases (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  axis_id         uuid NOT NULL REFERENCES attribute_axes(id),
  canonical_value text NOT NULL,
  aliases         text[] NOT NULL,
  sort_order      smallint NOT NULL DEFAULT 0,
  UNIQUE (axis_id, canonical_value)
);

CREATE TABLE variant_attributes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id      uuid NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  axis_id         uuid NOT NULL REFERENCES attribute_axes(id),
  canonical_value text NOT NULL,
  sort_order      smallint NOT NULL DEFAULT 0,
  UNIQUE (variant_id, axis_id)
);

CREATE TABLE platform_links (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  master_product_id   uuid NOT NULL REFERENCES master_products(id),
  platform            text NOT NULL CHECK (platform IN ('mercadolivre', 'nuvemshop')),
  platform_product_id text NOT NULL,
  platform_sku_raw    text,
  platform_sku_field  text,
  match_method        text NOT NULL,
  match_confidence    smallint,
  match_signals       jsonb NOT NULL DEFAULT '{}',
  confirmed_by        uuid REFERENCES users(id),
  confirmed_at        timestamptz,
  ml_model            text CHECK (ml_model IN ('legacy_variations', 'user_product')),
  family_id           text,
  family_name         text,
  family_confidence   smallint,
  sync_status         text NOT NULL DEFAULT 'pending',
  last_synced_at      timestamptz,
  UNIQUE (platform, platform_product_id),
  CHECK (
    family_confidence IS NULL
    OR (ml_model = 'user_product' AND family_confidence BETWEEN 0 AND 100)
  )
);

CREATE TABLE platform_variant_links (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id            uuid NOT NULL REFERENCES product_variants(id),
  master_product_id     uuid NOT NULL REFERENCES master_products(id),
  platform              text NOT NULL,
  platform_product_id   text NOT NULL,
  platform_variant_id   text NOT NULL DEFAULT '',
  platform_sku_raw      text,
  platform_sku_field    text,
  raw_attributes        jsonb NOT NULL DEFAULT '[]',
  normalized_attributes jsonb NOT NULL DEFAULT '[]',
  match_method          text,
  match_confidence      smallint,
  platform_price        numeric(10,2),
  platform_stock        integer,
  platform_ean          varchar(14),
  user_product_id       text,
  sync_status           text NOT NULL DEFAULT 'pending',
  last_synced_at        timestamptz,
  UNIQUE (platform, platform_product_id, platform_variant_id)
);

CREATE TABLE ml_selling_conditions (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_variant_link_id  uuid NOT NULL REFERENCES platform_variant_links(id),
  item_id                   text NOT NULL UNIQUE,
  listing_status            text,
  price                     numeric(10,2),
  follow_store_price        boolean NOT NULL DEFAULT false,
  follow_set_by             uuid REFERENCES users(id),
  logistic_type             text,
  inventory_id              text,
  last_synced_at            timestamptz
);

CREATE TABLE ml_stock_locations (
  user_product_id  text NOT NULL,
  location_type    text NOT NULL CHECK (location_type IN ('meli_facility', 'selling_address', 'seller_warehouse')),
  store_id         text NOT NULL DEFAULT '',
  network_node_id  text NOT NULL DEFAULT '',
  quantity         integer NOT NULL DEFAULT 0,
  stock_version    bigint,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_product_id, location_type, store_id, network_node_id)
);
```

No legado, `platform_links.platform_product_id` é o item e `platform_variant_id` é o id da variação. `user_product_id` fica nulo. No User Product, `platform_links.platform_product_id` é o `family_id`, `platform_variant_id` é o `user_product_id`, e cada anúncio daquela variante é uma linha em `ml_selling_conditions`. `family_confidence` é o score da seção 8.1 e só existe com `ml_model = user_product`. Nesse vínculo, `match_confidence` guarda o mesmo número. Nuvemshop deixa `ml_model`, `family_id`, `family_confidence` e `user_product_id` nulos. `platform_variant_id` vazio, no legado ou na Nuvemshop, é o produto simples.

No legado há um preço por variação, e esse preço segue a loja. No User Product, várias condições de venda da mesma variante não recebem o mesmo preço só por existirem. `follow_store_price` verdadeiro é quem recebe o preço da seção 10.7. `follow_set_by` nulo deixa o sistema marcar verdadeiro quando a variante tem uma condição só. A segunda condição nasce falsa. Essa marcação do sync grava `control_changes` com `origin = system`. Admin que grava `follow_set_by` fixa a escolha, grava `origin = admin` na mesma transação, e o sync seguinte não a troca. `follow_set_by` é o último admin que fixou. O histórico das trocas é `control_changes`.

### 9.4 Filas fiscais e de matching

```sql
CREATE TABLE platform_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform            text NOT NULL CHECK (platform IN ('mercadolivre', 'nuvemshop')),
  platform_product_id text NOT NULL,
  status              text NOT NULL CHECK (status IN (
                        'suggestion', 'quarantine', 'linked', 'dismissed', 'new_product'
                      )),
  master_product_id   uuid REFERENCES master_products(id),
  decided_by          uuid REFERENCES users(id),
  decided_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, platform_product_id)
);

CREATE TABLE matching_queue (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_item_id    uuid NOT NULL REFERENCES platform_items(id),
  platform_raw_data   jsonb NOT NULL,
  suggested_matches   jsonb NOT NULL DEFAULT '[]',
  best_score          smallint,
  status              text NOT NULL DEFAULT 'pending' CHECK (status IN (
                        'pending', 'matched', 'dismissed', 'new_product'
                      )),
  resolution          jsonb,
  resolved_by         uuid REFERENCES users(id),
  resolved_at         timestamptz,
  expires_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (status = 'pending' OR expires_at IS NOT NULL)
);

CREATE TABLE match_rejections (
  platform_item_id  uuid NOT NULL REFERENCES platform_items(id),
  master_product_id uuid NOT NULL REFERENCES master_products(id),
  rejected_by       uuid NOT NULL REFERENCES users(id),
  reason            text,
  rejected_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (platform_item_id, master_product_id)
);
```

`match_rejections` é o cache negativo do PIRE. Não tem TTL. Rejeitar o anúncio inteiro (`dismissed` ou `new_product`) é outra decisão e não substitui a recusa de um par.

```sql
CREATE TABLE channel_content_overrides (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  master_product_id  uuid NOT NULL REFERENCES master_products(id),
  variant_id         uuid NOT NULL REFERENCES product_variants(id),
  platform           text NOT NULL CHECK (platform IN ('mercadolivre', 'nuvemshop')),
  field              text NOT NULL CHECK (field IN ('title', 'description')),
  value              text NOT NULL,
  source             text NOT NULL,
  status             text NOT NULL DEFAULT 'shadow' CHECK (status IN ('shadow', 'live', 'reverted')),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (master_product_id, variant_id, platform, field)
);

CREATE TABLE enrichment_controls (
  platform              text PRIMARY KEY CHECK (platform IN ('mercadolivre', 'nuvemshop')),
  mode                  text NOT NULL DEFAULT 'shadow' CHECK (mode IN ('shadow', 'live')),
  kill_switch           boolean NOT NULL DEFAULT false,
  max_replaces_per_run  integer NOT NULL DEFAULT 25
);
```

Título e descrição de canal não têm coluna em `master_products`. As duas plataformas nascem em `shadow`, então nada é escrito no Bling até alguém passar o modo para `live`. O kill switch, quando ligado, impede essa origem mesmo em `live`.

`expires_at` só é preenchido na resolução, com 60 dias a partir dela. O DLM apaga a fila onde `expires_at` já passou. Não existe purge de quarentena. `platform_items` não entra no TTL.

`ean_pending_validation`, `ean_validation_history`, `ncm_manual_suggestions`, `ncm_divergence_alerts`, `ncm_audit_log` e `divergence_alerts` seguem o desenho do briefing, com estes acertos:

- `first_review_by` e `second_review_by` são `uuid REFERENCES users(id)`, nunca texto
- `ncm_manual_suggestions` exige `second_review_by <> first_review_by` e nota não vazia na aprovação
- `ean_pending_validation` é única por `(variant_id, proposed_ean, source_platform)`
- NCM formatado em `varchar(10)` no padrão `0000.00.00`
- tabelas de arquivo fiscal são imutáveis

`variant_matrix_analysis` guarda o `comboKey` e a presença em Bling, Mercado Livre e Nuvemshop, com status `ok`, `missing_ml`, `missing_ns`, `extra_ml`, `extra_ns` ou `discontinued`.

### 9.5 Imagens, push e webhook

`product_images` permanece a entidade de imagem (url, average hash, sha256, dimensões, direitos, score, elegibilidade e posição por canal). Não há coluna `images` em `master_products`.

```sql
CREATE TABLE image_processing_queue (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  master_product_id  uuid NOT NULL REFERENCES master_products(id),
  variant_id         uuid REFERENCES product_variants(id),
  product_image_id   uuid,
  source_url         text NOT NULL,
  url_normalized     text NOT NULL,
  source_platform    text NOT NULL,
  stage              text NOT NULL DEFAULT 'queued' CHECK (stage IN ('queued', 'fetched', 'failed', 'done')),
  attempts           smallint NOT NULL DEFAULT 0,
  max_attempts       smallint NOT NULL DEFAULT 4,
  available_at       timestamptz NOT NULL DEFAULT now(),
  locked_at          timestamptz,
  locked_by          text,
  last_error         text,
  enqueued_at        timestamptz NOT NULL DEFAULT now(),
  finished_at        timestamptz,
  UNIQUE (master_product_id, url_normalized)
);

CREATE INDEX image_processing_queue_claim
  ON image_processing_queue (available_at, id)
  WHERE stage = 'queued' AND locked_at IS NULL;
```

O worker reserva lotes com `stage = 'queued'`, `available_at <= now()` e `locked_at` nulo, ordenados por `available_at`, `id`, em `FOR UPDATE SKIP LOCKED`. Essa leitura usa `image_processing_queue_claim`. Linha que ganha `locked_at`, ou que sai de `queued`, deixa o índice. `product_image_id` aponta para `product_images` depois da coleta. `image_rights_review_queue` continua só para a decisão humana de direitos.

`push_jobs.job_kind` é `STOCK_PRICE`, `CONTENT` ou `CREATE`. Status: `pending`, `locked`, `completed`, `failed`, `blocked`, `superseded`, `cancelled`. `blocked` é terminal e não entra no retry. `block_reason` guarda o motivo (`ncm`, `ean`, `score`, `unlinked`, `price_zero`). O job só fica `completed` quando todos os passos estão `completed` ou `skipped`.

```sql
CREATE TABLE push_jobs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  master_product_id  uuid NOT NULL REFERENCES master_products(id),
  variant_id         uuid NOT NULL REFERENCES product_variants(id),
  platform           text NOT NULL CHECK (platform IN ('mercadolivre', 'nuvemshop')),
  job_kind           text NOT NULL CHECK (job_kind IN ('STOCK_PRICE', 'CONTENT', 'CREATE')),
  status             text NOT NULL DEFAULT 'pending' CHECK (status IN (
                       'pending', 'locked', 'completed', 'failed',
                       'blocked', 'superseded', 'cancelled'
                     )),
  block_reason       text CHECK (block_reason IN ('ncm', 'ean', 'score', 'unlinked', 'price_zero')),
  attempts           smallint NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX push_jobs_active
  ON push_jobs (master_product_id, variant_id, platform, job_kind)
  WHERE status = 'pending';
```

`push_jobs_active` é o job ativo da agregação: no máximo um `pending` por produto, variante, plataforma e tipo. A busca desse recurso usa o índice. `locked` fica de fora, então a execução em curso não impede a janela seguinte.

```sql
CREATE TABLE push_job_steps (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  push_job_id  uuid NOT NULL REFERENCES push_jobs(id),
  step         text NOT NULL,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'skipped')),
  last_error   text,
  finished_at  timestamptz,
  UNIQUE (push_job_id, step)
);
```

`webhook_events.idempotency_key` é única. `content_hash` tem 64 caracteres. `sync_logs.idempotency_key` é obrigatória em toda linha.

`channel_readiness_scores` é única por `variant_id`.

### 9.6 Partições

Particionadas por mês: `identity_resolution_logs`, `quality_history`, `push_execution_logs`, `sync_logs`, `channel_readiness_history`.

```sql
CREATE TABLE sync_logs (
  id               uuid NOT NULL DEFAULT gen_random_uuid(),
  product_id       uuid,
  platform         text NOT NULL,
  direction        text NOT NULL,
  field_group      text,
  fields_changed   jsonb,
  status           text NOT NULL,
  error_detail     text,
  idempotency_key  text NOT NULL,
  webhook_event_id uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (created_at, id)
) PARTITION BY RANGE (created_at);
```

As outras partições usam a mesma forma de chave. A migration inicial cria 14 partições, de 12 meses atrás até 2 meses à frente.

### 9.7 Migrations

1. `users`, `user_roles`, `sessions`, `oauth_tokens`, `stock_warehouses`, `channel_stores`, `control_changes`, `sync_cursors`, `hub_writes`
2. `master_products`, `product_variants`, componentes, saldos por depósito, preços por loja, eixos, aliases e atributos
3. vínculos de plataforma, condições de venda do Mercado Livre, locais de estoque do ML, fila de matching, recusas de par e matriz de variantes
4. tabelas fiscais, overrides de conteúdo, controles de enriquecimento e arquivos
5. staging de enriquecimento, sugestões, `quality_history` e categorias de canal
6. imagens, fila de processamento, fila de direitos e limites
7. mudanças pendentes, janelas, `push_jobs`, passos do push e logs de execução
8. webhooks, watermarks, locks e `sync_logs`
9. scores e histórico
10. políticas e execuções do DLM
11. índices
12. partições iniciais e seeds (eixos, aliases, limites de imagem, políticas de retenção, depósitos com `role` e `include_in_push` explícitos, `channel_stores` das duas lojas)

## 10. Fluxos

### 10.0 Cota do Bling

Todas as chamadas da conta passam por um limiter no Redis. Full enrich, delta, stock sync, price check, leitura do push e refresh do token disputam a mesma cota. Réplica extra não ganha outro balde.

| Teto | Efeito se passar |
|---|---|
| 3 req/s | espera no limiter |
| 120.000 chamadas no dia, somando todos os módulos | o job de menor prioridade para e retoma no dia seguinte |
| 600 chamadas em 10 s | bloqueio de IP. O teto de 3 req/s, num balde só, fica em 30 chamadas nessa janela |
| 20 chamadas a `/oauth/token` em 60 s | bloqueio de 60 min. O refresh é single-flight: uma renovação por vez, as outras esperam a mesma resposta. Um 401 não dispara rajada |

Repartição das 120.000, por dia:

| Uso | Chamadas | Ritmo |
|---|---|---|
| Reserva para webhook, leitura do push e retry | 12.000 | não é cedida ao enrich |
| Stock sync | 48.000 | a cada 15 min, até 500 leituras por ciclo |
| Price check | 12.000 | a cada 30 min. Reusa o snapshot do stock sync com menos de 15 min e só busca o que faltar |
| Delta enrich | 24.000 | a cada 30 min, até 500 produtos por ciclo |
| Full enrich | 24.000 | o saldo. Pausa quando o dia passa de 96.000 e continua pelo cursor |

Na mesma segundo, a ordem de quem consome o balde é: token, leitura de estoque e de webhook P1, price check, delta, full. O full não corre ao lado do delta quando a reserva do dia já foi embora. Nenhum desses jobs trata 3 req/s como cota própria.

### 10.1 Enriquecimento

Full diário e delta a cada 30 minutos, ambos retomáveis pelo cursor, dentro da cota da seção 10.0. Limites oficiais de Mercado Livre e Nuvemshop têm limiter próprio e não entram na conta do Bling.

Para cada produto com `catalog_status = 'active'`:

1. Ler Bling, e o canal só se o PIRE/VIR já confirmou o vínculo.
2. NVE no NCM. GVE no EAN de cada variante.
3. CQS nos campos do Grupo B, com a matriz de fonte.
4. IQRE enfileira as imagens do produto e não espera o download.
5. CRE por variante.
6. Em `shadow`, a decisão fica em `quality_history` e no override proposto. Em `live`, REPLACE de marca, peso e dimensões vai ao Bling via `applyToBling` e `hub_writes`, até `max_replaces_per_run`. Nome e descrição do Bling não entram.
7. SUGGEST vira `enrichment_suggestions`.
8. Mudança real no Bling, que não seja eco, abre agregação de push.

### 10.2 Push

Webhook do Bling ou delta chama o WIG, detecta campos e agrega. O flush abre um job por tipo. O worker lê o Bling na hora, escolhe o builder da operação e registra a tentativa. Webhook de Mercado Livre ou Nuvemshop não entra neste fluxo.

Recursos assinados no Bling: `product` (`created`, `updated`, `deleted`), `stock` e `virtual_stock`. `virtual_stock` vem ligado junto com `stock`. Pedido, nota e fornecedor ficam de fora. O payload não traz a ordem garantida: o worker usa o `date` do evento, e um `updated` que chega antes do `created` faz upsert pelo `bling_id`.

`stock` e `virtual_stock` não alteram preço nem conteúdo. Atualizam `variant_stock_balances` pelo GET `/estoques/saldos` do produto citado e gravam `product_variants.stock` pela seção 10.7. Evento `product`, enrich e situação não copiam `estoque` para essa coluna. Preço segue a seção 10.7. Situação segue a seção 10.4.

Check de preço a cada 30 minutos compara cada anúncio com o preço da seção 10.7. Condição com `follow_store_price` entra no passo `price` só se `stock_price = hub`. Condição sem a marca não entra nesse passo: preço diferente vira alerta. O valor do canal não grava no Bling. A leitura de saldo reusa o snapshot do stock sync quando ele tem menos de 15 minutos. O preço de loja vem de `GET /produtos/lojas` da `channel_stores` daquele canal.

### 10.3 Variantes

PIRE no pai, upsert das variantes do Bling, GVE por EAN, `comboKey`, VIR nos canais, lacunas na matriz. No Mercado Livre o VIR lê `variations` só no item legado e `user_product_id` na família. Preço e estoque saem sempre pela variante, inclusive na default do produto simples e na do kit. Produto com variações não é enviado como produto simples. Pai `formato` V não é anúncio: quem vende é a variação. Serviço (`tipo` diferente de `P`) fica `ignored`, motivo `service`, e não cria linha. Se um produto P passar a serviço, o cadastro local vai a `inactive` e sai do enrich e do push.

### 10.4 Inativado ou removido no Bling

Inativar e apagar não apagam a linha local. NCM, EAN, vínculos, composição e `match_rejections` ficam. O DLM não remove `master_products`.

O Bling separa três saídas. Situação inativa e situação excluída chegam em `product.updated`. `product.deleted` é a exclusão definitiva. Marcar a situação como excluída não dispara `deleted`.

| Sinal | Efeito |
|---|---|
| `product.updated` com `situacao` A | `catalog_status = active`. O mesmo `bling_id` não cria outra linha |
| `product.updated` com `situacao` I | `catalog_status = inactive`. Variantes `inactive` e `is_active = false` |
| `product.updated` com `situacao` E | `catalog_status = deleted`. Variantes `discontinued`. O GET ainda pode responder 200 |
| `product.deleted` e um GET seguinte 404 | `catalog_status = deleted`. Variantes `discontinued` |
| `product.deleted` e o GET ainda responde 200 | Não muda o status. Alerta de evento adiantado ou divergente |
| Payload de produto sem `situacao` | Um GET `/produtos/{id}` decide A, I, E ou 404. Campo ausente não é exclusão |
| Dois GET 404 seguidos, sem evento | `catalog_status = deleted`. Caminho de varredura, não substitui o webhook |
| Um único 404, 429 ou timeout na varredura | Não muda o status |

O mesmo `bling_id` que volta com `situacao` A retoma `active`. Não cria outro `master_products`.

Nos anúncios já vinculados de produto `inactive` ou `deleted`:

- Cancela `CONTENT` e `CREATE` pendentes.
- Com `stock_price = hub`, enfileira `pause` e, fora de anúncio Full, `stock` com quantidade zero em cada item de `ml_selling_conditions`, ou na variação legada. Esse zero vai no corpo do passo. `product_variants.stock` permanece a soma da seção 10.7. Esses passos não consultam NCM, EAN nem preço. Local `meli_facility` não recebe quantidade, nem zero. Com `bling_native`, o hub só registra o estado e o alerta. Quem zera o anúncio comum é a integração nativa. O hub não apaga o anúncio no Mercado Livre nem na Nuvemshop.
- `platform_links` permanece, com `sync_status = 'source_inactive'` ou `'source_deleted'`.
- Um alerta crítico aberto por produto. A matriz da variante some do canal passa a `extra_ml` ou `extra_ns` enquanto o anúncio existir sem produto ativo no Bling.

Variante removida e pai ainda ativo: só essa variante fica `discontinued`. O pai continua no enriquecimento. Com `stock_price = hub`, o vínculo dela recebe pausa e, fora de anúncio Full, quantidade zero no corpo do passo `stock`. `product_variants.stock` não muda por causa dessa saída. Local `meli_facility` não recebe quantidade, nem zero. Com `bling_native`, o hub só registra o estado e o alerta. Componente que sai do catálogo não apaga o kit; o saldo virtual do kit é relido.

Produto `inactive` ou `deleted` não entra em enriquecimento, IQRE, CREATE nem CONTENT.

### 10.5 Webhook de Mercado Livre e Nuvemshop

O diagrama de entrada recebe os três. O fluxo 10.2 trata só o Bling. Evento com `source` `mercadolivre` ou `nuvemshop` passa pelo controller do WIG e pelo worker desta seção.

A notificação do Mercado Livre é um aviso fino (tópico e recurso). O worker busca o recurso na API do Mercado Livre, não no Bling. A Nuvemshop manda `product/updated` e `product/deleted` no corpo. Pedido continua fora.

| Evento | Efeito |
|---|---|
| Eco de um `push_job_steps` concluído para o mesmo recurso e os mesmos campos | `ignored`, motivo `echo`. Não abre outro push |
| Migração UPtin | atualiza `user_product_id` e `ml_selling_conditions` no vínculo já existente. Não cria outro `master_product`. `family_confidence` copia o `match_confidence` já gravado |
| Preço ou estoque no canal diferente do Bling | alerta de divergência. O valor do canal não grava no ERP. Estoque do canal compara com `floor` de `product_variants.stock`. Coluna nula não abre alerta de estoque. Na saída comercial que manda quantidade zero, a comparação usa zero. Passo `price` só sai se `stock_price = hub` e, no Mercado Livre, se a condição tiver `follow_store_price`. Passo `stock` só sai se `stock_price = hub`. Saldo em `meli_facility` não dispara passo `stock` |
| Título, descrição ou imagem editados no canal | não chama `applyToBling`. O texto fica disponível para o próximo enrich comparar. Override só nasce em `shadow` |
| Anúncio ou produto apagado no canal | `platform_links.sync_status = channel_deleted`. O cadastro do Bling permanece. A matriz deixa de marcar `extra_ml` ou `extra_ns` nesse anúncio |

Estoque e pausa disparados daqui seguem a regra do APE e o dono em `channel_sync_owners`: não consultam NCM, EAN nem preço, e não saem enquanto o dono for `bling_native`. Conteúdo disparado daqui respeita `enrichment_controls`. Sem vínculo confirmado, o evento só atualiza `platform_items` e não empurra o Bling.

### 10.6 Convivência com a integração nativa

O Bling já pode sincronizar estoque e preço com o Mercado Livre e com a Nuvemshop. Dois escritores no mesmo anúncio se atropelam. O dono é configurável e nasce assim:

```sql
CREATE TABLE channel_sync_owners (
  platform     text PRIMARY KEY CHECK (platform IN ('mercadolivre', 'nuvemshop')),
  stock_price  text NOT NULL DEFAULT 'bling_native' CHECK (stock_price IN ('bling_native', 'hub')),
  content      text NOT NULL DEFAULT 'hub' CHECK (content IN ('bling_native', 'hub'))
);
```

| Campo | Dono padrão | Quem grava no canal |
|---|---|---|
| Estoque e preço do vendedor | `bling_native` | a integração nativa do Bling |
| Pausa e estoque zero por inativação | `bling_native` | a integração nativa do Bling, sem gravar quantidade em `meli_facility` |
| Estoque Full (`meli_facility`) | Mercado Livre | ninguém por esta API. O saldo sobe por inbound no painel do Mercado Livre |
| Título, descrição, imagens e atributos de conteúdo | `hub` | este hub, em modo `live` |
| Nascimento do anúncio | CREATE confirmado por uma pessoa | este hub, uma vez, com preço e estoque lidos do Bling. A atualização seguinte fica com o dono de `stock_price` |

O hub continua lendo estoque e preço no Bling para o cadastro local e para o alerta de divergência. Não os devolve a anúncio já publicado enquanto `stock_price = bling_native`. A criação confirmada envia esses valores uma vez porque a API do canal exige, e não abre job de atualização. Passar um canal para `hub` é manual e só depois de desligar, no Bling, a sincronização nativa de estoque e preço desse canal. Desligar a sincronização nativa de estoque e preço não desliga a entrada de pedidos no Bling: sem o pedido, o saldo que o hub lê deixa de se mover. Os dois modos não ficam ligados juntos. Conteúdo nativo do Bling para o canal fica desligado enquanto `content = hub`, para o título do anúncio não ser reescrito pelos dois.

### 10.7 Kit, depósito e preço da loja

O anúncio é o SKU vendável. Kit (`formato` E) não vira vários anúncios dos componentes, e a grade (`formato` V) não vira anúncio do pai.

| Forma | O que vende | `product_variants.stock` |
|---|---|---|
| S, simples | a variante default | soma de `saldo_virtual` dos depósitos `seller` com `include_in_push` |
| E, composição | o próprio kit | a mesma soma, no saldo virtual que o Bling já calculou para esse SKU |
| V, grade | cada variação, que pode ser S ou E | a mesma soma, calculada nessa variação |

`stock_mode = virtual` baixa o componente na venda e o saldo do kit muda quando o componente muda. `stock_mode = physical` é o estoque do próprio kit. Nos dois casos o hub não recalcula `min(estoque do componente / quantidade)`. Quem calcula é o Bling. A estrutura só diz de quem o kit depende.

`GET /produtos/estruturas/{id}` preenche `product_components`. O hub não faz POST nem PUT de estrutura. Componente ainda não sincronizado fica com `component_variant_id` nulo e o `component_bling_id` guardado. Estrutura incompleta gera alerta e não bloqueia a leitura de saldo.

`virtual_stock` é o aviso de reserva e de kit. Se `vinculoComplexo` vier verdadeiro, o payload não lista todos os kits afetados (passa de 200 vínculos): o saldo sai de `GET /estoques/saldos`, não da lista do evento. `stock` cobre lançamento físico. Esses dois eventos e o stock sync de 15 minutos atualizam `variant_stock_balances` e, na mesma transação, gravam `product_variants.stock` com a soma de `saldo_virtual` dos depósitos `seller` com `include_in_push`. Depósito `ml_full`, `other` ou `unclassified` fica de fora. `saldo_fisico` fica só para conferência. Mudança de `role` ou de `include_in_push` recalcula essa soma com os saldos já gravados, na mesma transação. Payload de produto e enrich não escrevem a coluna. Nulo significa que `/estoques/saldos` ainda não rodou para a variante. Zero significa que a leitura já rodou e a soma é zero. Na execução, o CREATE e o passo `stock` que acompanha o saldo releem `/estoques/saldos`, gravam a coluna e enviam o `floor`. Com a coluna nula, o envio espera. O passo `stock` da saída comercial manda quantidade zero e não altera a coluna. Mudança de componente que altera o kit entra por `virtual_stock` ou pelo ciclo de 15 minutos, não por uma fórmula local.

Preço de cadastro fica em `product_variants`: `price`, `promotional_price` e `use_promotional`. Preço de loja fica em `variant_channel_prices`: `store_price` e `store_promotional_price`. O `GET /produtos/lojas` da `channel_stores` da plataforma grava só as colunas da loja. O payload de produto grava só o cadastro. Um não copia o outro.

Preço enviado ao canal, por variante:

1. Sem linha em `channel_stores`: o cadastro. O dashboard mostra a loja como não configurada.
2. Loja configurada e sem linha em `variant_channel_prices`: o passo `price` e o CREATE esperam o `GET /produtos/lojas`.
3. `store_price` nulo: o cadastro. `promotional_price` se `use_promotional` e o valor for maior que zero; senão `product_variants.price`.
4. `store_price` preenchido: a loja. `store_promotional_price` se for maior que zero; senão `store_price`. O valor da loja permanece quando é igual ao cadastro.

Preço zero ou negativo no número escolhido bloqueia o passo `price` das condições marcadas e o CREATE, como na seção 8.8. Preço maior que zero e menor que `cost_price` não bloqueia: abre o alerta crítico da seção 8.8. Custo nulo não compara. Condição sem `follow_store_price` não é escrita, mesmo com o preço da loja válido, e o preço que ela já tem também compara com o custo. O CREATE marca verdadeiro a condição que acaba de nascer e grava `control_changes` com `origin = system` na mesma transação. `follow_set_by` continua nulo. O preço do kit é o preço desse SKU, não a soma dos componentes. Custo não vai ao canal. Com `store_price` preenchido, número de cadastro diferente do número de loja gera alerta. A escrita usa a loja. Na Nuvemshop há um preço por variante, o da lista acima. No Mercado Livre, a comparação e a escrita usam a condição marcada. As outras conservam `ml_selling_conditions.price` e alertam se esse valor for diferente do preço da lista acima.

`channel_stores` guarda o `bling_loja_id` do Mercado Livre e o da Nuvemshop.

### 10.8 Estoque Full do Mercado Livre

O saldo Full mora no depósito do Mercado Livre, local `meli_facility`. A API não aceita escrita nesse local. Entrada de peça no Full é inbound pelo painel do Mercado Livre, fora deste hub. A conta é MLB: a escrita de `selling_address` documentada para Argentina e Chile não se aplica.

O worker lê `GET /user-products/{user_product_id}/stock` e grava cada local em `ml_stock_locations`, com o `x-version` da resposta. No item legado, `shipping.logistic_type = fulfillment` e `inventory_id` apontam para `GET /inventories/{inventory_id}/stock/fulfillment`. Esse GET também é só leitura. `available_quantity` do item soma os locais e não é a quantidade a enviar.

| Local no User Product | Quem gere | O que o hub faz com `stock_price = hub` |
|---|---|---|
| só `meli_facility` | Mercado Livre | passo `stock` fica `skipped`, motivo `ml_full`. Não há PUT de `available_quantity` |
| `seller_warehouse` e `meli_facility` | vendedor no depósito dele; Mercado Livre no Full | PUT só em `/user-products/{id}/stock/type/seller_warehouse`, com o `x-version` lido na hora. A quantidade é o `floor` de `product_variants.stock`. O corpo não leva `meli_facility` |
| `selling_address` | vendedor, e só em MLA/MLC | nesta conta, não escreve |

409 no PUT de estoque relê o `x-version` e tenta de novo uma vez. Não soma o saldo Full ao saldo do Bling, nem reduz um para compensar o outro. O hub também não subtrai `meli_facility` da soma do Bling: quando a transferência já baixou o depósito de venda, subtrair de novo zeraria peça que ainda está com o vendedor. Venda Full desconta `meli_facility`. Venda pelo depósito do vendedor desconta `seller_warehouse`.

Peça já enviada ao Full só fica de fora da soma pelo depósito. Se o Bling baixa o depósito de venda na transferência, o saldo publicado já não a contém. Se o Bling conserva um depósito espelho do Full, esse depósito nasce `role = ml_full`. O `CHECK` impede `include_in_push`. Depósito novo, vindo da API, entra `unclassified` e fora da soma, com um alerta para o admin classificar. Sem essa classificação, o saldo não publica.

Preço, título, descrição e imagem do anúncio Full seguem as regras já definidas. A pausa por produto inativo ou por variante removida, quando o dono é `hub`, muda o status do anúncio e não manda quantidade. Estoque zero, nesse caso, só vai ao local que a tabela acima permite escrever. Se o Mercado Livre recusar a pausa, o passo fica `failed` com alerta e não vira tentativa de zerar `meli_facility`.

Notificação de estoque num anúncio Full atualiza o espelho e pode alertar. Não grava esse número no Bling e não abre passo `stock` para o local Full. CREATE pelo hub não nasce anúncio Full.

## 11. Contratos de API

Antes dos motores, gravar fixtures sanitizados de cada plataforma:

- produto simples (`formato` S)
- produto com variação (`formato` V)
- kit (`formato` E) com estoque virtual e dois componentes
- variação de grade que também é composição
- saldos de dois depósitos `seller`, com um deles fora de `include_in_push`
- depósito `ml_full` com saldo que não entra na soma publicada
- vínculo `GET /produtos/lojas` com preço e preço promocional
- produto com variação no formato legado do Mercado Livre (`variations`)
- família User Product com dois `user_product_id` e duas condições de venda
- User Product só com `meli_facility`
- User Product com `seller_warehouse` e `meli_facility`
- item legado Full com `inventory_id` e estoque fulfillment
- notificação de migração UPtin
- webhook `stock` e webhook `virtual_stock` com `vinculoComplexo`
- `product.updated` com `situacao` I
- `product.updated` com `situacao` E
- `product.deleted` seguido de GET 404
- `product.deleted` com GET ainda 200
- resposta 429

O mapper fecha contra esses arquivos. Endpoint e shape de SKU vêm do fixture, não de memória.

## 12. Dashboard

A primeira entrega é matching e fiscal. O restante acompanha o motor correspondente.

| Rota | Função |
|---|---|
| `/` | conexões, pior score, alertas fiscais, preço abaixo do custo, última sync |
| `/produtos` | catálogo com scores e risco fiscal |
| `/produtos/:id` | grupos A, A.5, B e C, galeria, matriz, composição, depósitos, preço por loja, histórico |
| `/matching` | sugestão, quarentena, recusa de par e variante sem vínculo |
| `/fiscal/ean` | fila GVE |
| `/fiscal/ncm` | dupla confirmação e auditoria |
| `/imagens` | direitos e produtos sem capa |
| `/variacoes` | lacunas |
| `/qualidade` | sugestões KEEP/SUGGEST |
| `/push` | filas por tipo e prioridade |
| `/webhooks` | duplicata, stale, eco e falha |
| `/admin/controles` | trilha de depósito, loja, dono do estoque e modo live |
| `/admin/dlm` | volume, partição e jobs |
| `/admin/aliases` | aliases e valores não mapeados |

## 13. Ordem de construção

31–46 dias úteis cobrem a espinha de backend. As telas não cabem nesse intervalo. Cada fase fecha no teste nomeado.

| Fase | Entrega | Fecha quando |
|---|---|---|
| 0 | Monorepo, Docker, migration 1 (identidade e controles), usuários e papéis | Healthcheck e login de dois papéis |
| 0.5 | Fixtures sanitizados (Bling v3, ML Legado/User Product, Nuvemshop `inventory_levels`) | Mapper cobre simples, variação, kit, 429 e `product.deleted` |
| 1 | Schema completo deste documento (migrations 2 a 12) | Migrations sobem e descem |
| 2 | Conectores, limiter e `oauth_tokens` | Dois jobs juntos não passam de 3 req/s; o refresh do token é single-flight |
| 3 | GVE e NVE puros | Vetores GS1 e NCM `0000.00.00`; EAN repetido entre variantes do mesmo produto marca `duplicate`; NCM em conflito entre variantes marca `conflict` |
| 4 | PIRE e VIR | EAN compartilhado cai em quarentena; família User Product com sinais em dois pais também; conta `user_product_seller` não publica `variations` |
| 5 | IQRE | A sync enfileira as imagens; o fechamento deduplica sem cruzar produto |
| 6 | CQS | Grade A e grade B não sofrem REPLACE |
| 7 | CRE | Estoque não lê o score |
| 8 | WIG | Restart depois do 200 não perde evento |
| 9 | APE | Eco do PUT do hub não reabre push; anúncio só Full não recebe PUT de estoque |
| 10 | DLM | Réplica extra não duplica limpeza |
| 11 | Matching e fiscal no dashboard | Dois usuários confirmam o mesmo NCM |
| 12 | Ensaio com recorte real do catálogo | Lag de estoque medido |

## 14. Regras que não voltam atrás

- Grupo A não é escrito por canal nem por enriquecimento.
- NCM não é auto-preenchido. Sugestão exige dois aprovadores e nota de TIPI. Não existe NCM de variante. Códigos diferentes entre variantes do mesmo produto marcam `conflict` no pai, não viram sugestão e não escolhem um vencedor. O nome do Bling não tem coluna paralela.
- EAN externo válido não auto-preenche. EAN válido repetido entre variantes do mesmo produto marca `duplicate`, bloqueia CONTENT/CREATE dessas variantes e não sai do Bling. EAN igual em produtos diferentes não é sinal e cai em quarentena.
- Auto-match exige dois sinais fortes no mesmo candidato e nenhum conflito. EAN sozinho não vale 95. No User Product, `family_confidence` é o score de a `family_id` apontar para um só `master_product`. Conflito entre itens da família vai para quarentena e não parte a família. Confirmação manual vale 100. Legado deixa a coluna nula.
- Escrita de conteúdo no Bling nasce em shadow, com kill switch por plataforma, teto por execução e reversão pelo `quality_history`. Nome do Bling não recebe título de canal.
- HTTP 200 de webhook só sai depois do HMAC válido e do INSERT.
- A cota do Bling é uma só por conta. Nenhum cron soma outro limite de 3 req/s.
- O push lê o Bling na execução e chama um endpoint por passo. Não reenvia o produto inteiro nem repete passo já concluído. Na Nuvemshop, peso e dimensão vão no passo `measures` e não reenviam preço nem estoque.
- Estoque e pausa de anúncio publicado não esperam NCM, EAN nem preço. Com a integração nativa ligada, quem atualiza estoque e preço de anúncio já publicado é o Bling, não o hub. O CREATE confirmado envia preço e estoque uma vez, na abertura, e não repete.
- `product_variants.stock` é a soma do saldo virtual dos depósitos `seller` com `include_in_push`. Nasce nula. Zero só existe depois da leitura. O passo `stock` e o CREATE enviam o `floor` dessa soma. A saída comercial manda quantidade zero no anúncio comum e não grava esse zero na coluna. Depósito `ml_full` não entra. O hub não soma `saldoVirtualTotal` nem recalcula kit a partir dos componentes.
- Estoque Full (`meli_facility`) é do Mercado Livre. O hub não grava essa quantidade, nem zero, não a soma ao estoque do Bling e não a subtrai do depósito de venda.
- Preço de cadastro é `product_variants.price` e `promotional_price`. Preço de loja é `variant_channel_prices.store_price` e `store_promotional_price`. A loja não guarda cópia do cadastro. Sem `channel_stores`, vale o cadastro. Com a loja configurada, `store_price` nulo também vale o cadastro; preenchido, vale a loja. Sem linha de preço de loja, o envio espera a leitura. Promocional da loja só entra com valor maior que zero. No Mercado Livre, esse preço só é escrito na condição com `follow_store_price`. As outras não são achatadas. Preço acima de zero e abaixo do custo gera alerta crítico e não segura estoque, pausa nem a escrita do preço.
- Produto inativado (`situacao` I), excluído (`situacao` E em `product.updated`) ou apagado (`product.deleted` com GET 404) não é apagado no hub nem no canal. O cadastro local permanece. Variante removida com pai ativo segue a mesma saída comercial: com dono `hub`, o anúncio comum recebe estoque zero e pausa. Anúncio Full não recebe quantidade. Com `bling_native`, quem zera o anúncio comum é a integração nativa.
- Imagem é entidade. Dedup não cruza produto.
- Tabelas `*_archive` não recebem UPDATE nem DELETE.
- Nome de operador vive em `users`. Credencial OAuth vive em `oauth_tokens`, não no Redis. `raw_payload` de webhook expira. Depósito, loja, dono do estoque e modo live só mudam com admin, e a trilha guarda quem, quando, valor anterior e valor novo. `follow_store_price` entra na mesma trilha: admin com o usuário da sessão, sync com `origin = system`. O nascimento da condição também gera linha. Sem essa linha, o booleano não muda.
