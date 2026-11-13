# Auditoria de Go-Live — JH Sync Hub

Auditoria original: 11/11/2026, base `7fcbb49`.
Atualização: 12/11/2026, produção em `e810451` (`https://hub.jhshopping.com.br`).
Método: leitura do código da API e da web. O banco de produção não foi consultado; a classificação dos depósitos reais continua por verificar.

---

## 1. Veredito agora

**Ainda não ligar `ENABLE_LIVE_PUBLISHING=true` para o catálogo inteiro.**

O escritor da Nuvemshop existe. Com a flag ligada, só os SKUs de `LIVE_PUBLISH_ALLOWLIST` saem de verdade. Lista vazia não publica ninguém. O botão de pânico em Configurações > Geral segura a fila na hora.

O que ainda impede o piloto de 48 h:

- Os depósitos reais do Bling não foram conferidos neste documento. Produto sem depósito `seller` publica estoque 0, mas um Full classificado errado ainda entra na soma.
- O Mercado Livre continua sem `createListing` real. `updateStock` dos dois canais recusa a escrita.
- O sync completo ainda lê `codigo`, `preco` e `estoqueSaldos` no payload de entrada. A leitura pontual de preço e saldo já passou pelo contrato neutro.
- O piloto de 48 h não começou.

---

## 2. Quadro

| Item | Situação | O que ficou |
|---|---|---|
| P0-1 Estoque publicável | Implantado no código | `stock` só com depósito `seller` e `include_in_push`. `catalog_stock` é a exibição. Checklist bloqueia sem depósito de venda. Tela em `/canais/depositos`. Falta classificar os depósitos reais. |
| P0-2 Não criar anúncio já vinculado | Implantado | Checklist e worker bloqueiam Criar quando há `listing_id`. Não há escritor de Atualizar. |
| P0-3 NCM e imagem sem validação | Implantado com ressalva | NCM do Bling fica `pending_approval` e entra na aprovação em duas etapas. Imagem vai para o IQRE com `rights_status = 'pending'` e sem capa. Não passa pelo motor NVE. |
| P0-4 Cadastro rápido | Implantado | Sem `POST /estoques`. POST com timeout não repete. SKU existente no Bling aborta o POST. A gravação local é uma transação. Se o Bling já devolveu o id, a tentativa seguinte recupera o cadastro. Timeout sem id ainda exige olhar o Bling à mão. |
| P1-1 Marca d'água de preço | Implantado | Sync não sobrescreve um webhook mais novo. Campo de preço ausente não zera o valor. |
| P1-2 Conflito de vínculo | Implantado | Conflito de `listing_id` não aborta a rodada. |
| P1-3 Paginação da reconciliação | Implantado | Keyset por id. Capas só dos produtos da página. |
| P1-4 Erro transitório da Nuvemshop | Implantado | 401, 429 e 5xx lançam erro e o retrato fica. `null` só em 404 ou busca vazia. Timeout de 15 s. Sem fallback para `variants[0]`. |
| P1-5 Vínculo com um sinal | Implantado | Dois sinais (SKU e EAN, ou um deles com título parecido) gravam `vinculado`. Um sinal grava `sugerido` e aparece em Vínculos. Confirmar promove. Recusar apaga a sugestão. |
| P1-6 Cota e retry do Bling | Implantado | Limite compartilhado de 3 req/s e pausa diária em 80%. GET repete 429 e 5xx com `Retry-After` ou espera que dobra. POST com timeout ou 5xx não repete. `pullCatalogProduct` não pede estoque de novo. |
| P1-7 Transação e retomada | Implantado com ressalva | Imagens, fila do IQRE, NCM e sugestão fiscal do mesmo produto commitam juntos. A nota de completude grava em seguida. Página de sync que falha lança erro e o BullMQ repete sem avançar o cursor. O retrato do anúncio é upsert. |
| P1-8 Escritor da Nuvemshop | Implantado na Nuvemshop | Payload de preço, estoque e título é montado na hora. `POST /products`. O id volta na mesma transação que marca `success`. Cinco tentativas, só para 429 e 5xx. Mercado Livre segue stub. |
| P1-9 Isolamento do ERP | Parcial | `ACTIVE_ERP` escolhe o conector. `readCommerce` entrega `sku`, `price` e `balances`. O upsert do catálogo se chama `upsertCatalogProduct`. O sync completo ainda lê campos do payload de entrada do Bling. O nome antigo do upsert permanece como alias. |
| P1-10 Status com NCM bloqueado | Implantado | Vínculo com NCM ausente, inválido, em conflito, pendente ou com risco fiscal fica âmbar: "Vinculado com Pendência". NCM válido continua "Conectado". |
| P2.1 a P2.8 | Implantado em `dd04322` | Carta morta, backoff com jitter, cota diária, checklist em lote, upsert do retrato, pausa pelo cabeçalho da Nuvemshop, métricas de fila com alerta de sync parado 1 h, e envio travado há 15 min. |
| Etapa 3 Allowlist e pânico | Implantado no código | `LIVE_PUBLISH_ALLOWLIST` e o botão de pânico. A flag global continua desligada. O piloto de 48 h não começou. |
| Etapa 4 Gestão de estoque | Aberto | Sem alerta de saldo negativo, ruptura ou capital parado. Sem leitura de pedidos de venda. |

---

## 3. O que a auditoria apontou e como ficou

### P0-1. Estoque

O catálogo somava depósitos não classificados e podia incluir o Full. Agora `stock` só soma depósito `seller` com `include_in_push`. `catalog_stock` é o que a tela mostra. Sem depósito de venda, o checklist bloqueia o envio. A classificação operacional dos depósitos do Bling não foi conferida no banco de produção.

### P0-2. Anúncio duplicado

O checklist não olhava `channel_listing_links`. Agora Criar fica bloqueado quando já existe `listing_id`, com a mensagem para usar Atualizar. O worker também não chama `createListing` se o vínculo existe. O fluxo de atualização de anúncio ainda não escreve no canal.

### P0-3. NCM e imagem

O enriquecimento marcava NCM válido e imagem como capa própria. Agora o NCM importado espera o fiscal e a imagem entra na fila do IQRE sem ser capa. O caminho não é o motor NVE. É a aprovação em duas etapas.

### P0-4. Cadastro rápido

O HUB fazia `POST /estoques` no primeiro depósito e repetia POST em timeout. Isso saiu. Antes do POST há `GET /produtos?codigo=`. A gravação local do produto, da variação e da imagem é uma transação. Se ela falha depois que o Bling já criou o item, a próxima tentativa recupera o cadastro pelo id. Timeout sem id ainda pede conferência manual no Bling.

### P1-1 a P1-5. Sync e reconciliação

A marca d'água impede o sync de apagar um preço mais novo, e preço ausente não zera o valor. Conflito de vínculo não derruba a rodada. A reconciliação pagina por id. Erro 401, 429 ou 5xx da Nuvemshop não apaga o retrato. Um sinal só vira sugestão. Dois sinais vinculam.

### P1-6. Cota do Bling

Sync, enriquecimento e reconciliação compartilham 3 req/s e a pausa em 80% da cota diária. O GET honra `Retry-After` e repete 5xx. A leitura do cadastro não dispara uma chamada extra de estoque. O saldo do lote continua em `stockForBatch`.

### P1-7. Transação

O sync de estoque já era transacional. O enriquecimento de um produto agora grava imagem, fila, NCM e sugestão juntos. A página que falha não engole o erro: o BullMQ repete e `last_completed_page` não avança. Esgotadas as tentativas, o status fica `failed` e o alerta de 1 h continua valendo.

### P1-8. Publicação

O payload não fica congelado na fila. A Nuvemshop recebe `POST /products` com o preço da hora. O `listing_id` entra na mesma transação do sucesso. Um 400 vai direto para `failed`. Um 429 ou 5xx volta para a fila, até 5 vezes, com backoff exponencial. Se o SKU já existe na loja, o HUB reaproveita o id.

### P1-9. Isolamento

Os quatro pontos que chamavam `createErpConnector('bling')` passaram a usar `activeErpConnector()`. A atualização de preço e saldo que faltava no HUB lê `readCommerce`, não `preco` nem `estoqueSaldos`. O sync de catálogo inteiro ainda percorre o payload de entrada com `codigo`, `preco` e `estoqueSaldos`.

### P1-10. Status visual

Verde significa vínculo com NCM válido e sem risco fiscal. Qualquer bloqueio de NCM num produto já vinculado fica âmbar.

### P2

Carta morta com reprocessar, backoff com jitter, cota diária, checklist em lote, upsert do retrato, pausa pelo cabeçalho da Nuvemshop, métricas em Problemas e detector de envio travado. Tudo isso entrou em `dd04322`.

---

## 4. Gestão de estoque

Continua em aberto. O HUB não ingere pedidos. Não há alerta de saldo negativo, ruptura nem capital parado. A divergência entre canal e ERP na reconciliação só fica confiável depois que os depósitos reais estiverem classificados.

---

## 5. Próximo passo

1. Classificar os depósitos reais em `/canais/depositos` e conferir que nenhum `unclassified` tem saldo.
2. Escolher até 10 SKUs, gravar em `LIVE_PUBLISH_ALLOWLIST` e só então ligar `ENABLE_LIVE_PUBLISHING=true`.
3. Acompanhar 48 h: falha de envio, divergência de estoque e anúncio duplicado. O botão de pânico para a fila se isso aparecer.
4. Isolar o restante do sync completo do payload do Bling.
5. Escritor de atualização de anúncio e, quando o Mercado Livre voltar, o `createListing` desse canal.
6. Alertas de estoque e, depois, leitura somente de pedidos de venda.

### Critério de go-live

- [ ] 100% dos depósitos com papel definido e nenhum `unclassified` com saldo. Código pronto. Operação não conferida.
- [x] Nenhum produto vinculado aparece como "pronto para criar".
- [x] NCM e imagem só ficam verdes depois da validação. NCM usa aprovação em duas etapas, não o motor NVE. Imagem passa pelo IQRE.
- [x] Publicação idempotente testada com job reexecutado, na Nuvemshop, em teste automatizado. Não houve piloto ao vivo.
- [x] Reconciliação não aborta por conflito e não apaga retrato em 429 ou 5xx.
- [ ] Piloto de 48 h sem oversell e sem anúncio duplicado.
