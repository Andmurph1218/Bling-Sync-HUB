# Bling Sync HUB

Hub de sincronização de catálogo entre **Bling ERP v3**, **Mercado Livre** e **Nuvemshop**.

O Bling é a fonte soberana de preço, estoque e dados fiscais. Mercado Livre e Nuvemshop enriquecem conteúdo e mídia quando o dado do Bling está vazio ou com qualidade baixa. O hub publica preço, estoque e catálogo de volta nos canais, com push atômico e webhook idempotente.

## Escopo

Entra neste sistema:

- identidade de produto e variante
- validação de EAN (GS1) e NCM
- qualidade de conteúdo e de imagem
- score de prontidão por canal
- push de catálogo, preço e estoque
- idempotência de webhook
- retenção e arquivo fiscal

Fica de fora: pedidos, financeiro, emissão de NF-e e frete. O Bling já cobre a nota.

## Princípios

1. Dado fiscal e financeiro do Bling não é sobrescrito por canal.
2. Campo preenchido com lixo vale menos que campo vazio.
3. Identidade é multi-sinal. SKU sozinho não decide o vínculo.
4. Um produto gera um job de push por plataforma. O payload é lido do Bling na execução.
5. Toda operação pode ser reexecutada com o mesmo resultado.
6. EAN inválido, NCM divergente ou preço zero bloqueiam publicação. Estoque de anúncio já publicado continua.
7. NCM e EAN não são apagados. O arquivo fiscal permanece por 5 anos.

## Stack prevista

TypeScript estrito, Node.js 20, Express, Next.js, PostgreSQL 16, Redis 7, BullMQ, Sharp, Docker.

Premissa de operação: uma conta Bling, um seller Mercado Livre, uma loja Nuvemshop.

## Motores

| Motor | Função |
|---|---|
| PIRE | Vínculo do produto pai por predicado, não por soma de pontos |
| VIR | Vínculo de variante por SKU, EAN ou comboKey |
| GVE | EAN/GTIN com dígito verificador GS1 |
| NVE | NCM de 8 dígitos, sugestão só com dupla confirmação |
| CQS | Nota de qualidade e decisão KEEP, REPLACE ou SUGGEST |
| IQRE | Dedup, direitos e ordem das imagens |
| CRE | Três scores: Bling, Mercado Livre e Nuvemshop |
| APE | Push atômico em três tipos: estoque/preço, conteúdo e criação |
| WIG | HMAC, gravação, fila e só então HTTP 200 |
| DLM | TTL, partição e arquivo |

## Estado

O briefing de desenvolvimento é [docs/plano-mestre.md](docs/plano-mestre.md). Ele já incorpora os ajustes da [revisão](docs/revisao-plano-mestre.md), e o acompanhamento detalhado do que já foi estruturado, implantado, o que falta e o que fica de fora está em [docs/status-implantacao.md](docs/status-implantacao.md).

- **Fase 0 concluída**: monorepo (`apps/api`, `apps/web`), Docker Compose (PostgreSQL 16 + Redis 7), migration 001 (identidade, sessões opacas SHA-256, senhas Argon2id, `oauth_tokens` AES-256-GCM e trilha imutável `control_changes`), healthcheck e RBAC (`operator`, `fiscal_approver`, `admin`).
- **Fase 0.5 concluída**: fixtures sanitizados de Bling v3, Mercado Livre (Legado, Família User Product, Estoque Full `meli_facility` / `seller_warehouse` com `x-version`, Migração UPtin) e Nuvemshop (`inventory_levels`) + mappers puros cobrindo produto simples, variação, kit, variação-kit, saldos, preço de loja, 429 e `product.deleted`.
- **Fase 1 concluída**: schema completo do PostgreSQL 16 (migrations 001 a 012 com `up` e `down`, 39 tabelas de domínio, 70 partições mensais iniciais, índices parciais `uq_one_default_variant`, `image_processing_queue_claim`, `push_jobs_active`, triggers de imutabilidade fiscal e seeds iniciais).
- **Fase 2 concluída**: conectores HTTP (`BlingConnector`, `MercadoLivreConnector`, `NuvemshopConnector`), rate limiter global do Bling (3 req/s + 120.000/dia com fila de prioridades e reserva P1), e gerenciador `oauth_tokens` com renovação single-flight e rotação criptografada.
- **Fase 3 concluída**: motores fiscais puros **GVE** (`gve.ts`) e **NVE** (`nve.ts`) cobrindo vetores GS1 (8, 12, 13, 14 dígitos, Brasil 789/790, ISBN, faixa interna 200 e placeholders), NCM `0000.00.00` (capítulos 01–97), detecção de EAN `duplicate` entre variantes do mesmo produto, detecção de NCM `conflict` entre variantes no pai e fluxo de dupla confirmação por dois `fiscal_approver` distintos com nota de TIPI.
- **Fase 4 concluída**: motores de identidade **PIRE** (`pire.ts`) e **VIR** (`vir.ts`) cobrindo predicado multi-sinal (mínimo 2 sinais fortes para score 95; sinal único limitado a 80), quarentena em EAN compartilhado entre produtos, `family_confidence` para famílias User Product (quarentena sem partir a família quando itens conflitam), cache negativo permanente `match_rejections`, normalização de `comboKey` por aliases (`Medium -> M`), consolidação de `ml_selling_conditions` com trilha `control_changes`, análise de matriz (`missing_ml`/`extra_ml`) e publicação em conta `user_product_seller` sem `variations`.
- **Fase 5 concluída**: motor de imagens **IQRE** (`iqre.ts`) cobrindo enfileiramento assíncrono em `image_processing_queue` sem download na sync, consumo em lote com `FOR UPDATE SKIP LOCKED`, validação de hosts autorizados, Average Hash 64-bit, deduplicação no fechamento (`iqre.finalize`) com distância de Hamming $\le 5$ mantendo maior resolução sem cruzar produtos diferentes, fila de direitos (`third_party_risk`, `watermark_suspect`) e elegibilidade de capa ($\ge 500\times500$ e score $\ge 55$).
- **Fase 6 concluída**: motor de qualidade de conteúdo **CQS** (`cqs.ts`) cobrindo avaliadores por campo (grades A a F), árvore determinística `KEEP`/`REPLACE`/`SUGGEST` onde Grade A e Grade B jamais sofrem `REPLACE`, proteção de nome e descrição do Bling (`channel_content_overrides` por canal), modo `shadow` vs `live`, `kill_switch`, teto `max_replaces_per_run`, registro em `hub_writes` e reversão via `quality_history`.
- **Fase 7 concluída**: motor de prontidão por canal **CRE** (`cre.ts`) cobrindo cálculo dos 3 scores por variante (Bling 70/90, Mercado Livre 50/75 + categoria verificada em `CREATE`, Nuvemshop 45/85 com SEO), KPI do produto pela pior variante ativa, top 3 melhorias e garantia de que o envio de estoque (`stock`, `pause` e `price` em anúncio já publicado) jamais lê nem depende do score.
- **Fase 8 concluída**: guarda de idempotência de webhook **WIG** (`wig.ts` e `routes/webhooks.ts`) cobrindo leitura de raw body, validação HMAC em tempo constante (`X-Bling-Signature-256`, `x-linkedstore-hmac-sha256`, `x-signature`), `INSERT` síncrono em `webhook_events` com SHA-256 de 64 chars antes do HTTP 200, recovery automático pós-restart sem perda de evento, lock de recurso de 60s, watermark por campo com tolerância de 1s e detecção de eco (`hub_writes` e `push_job_steps`).
- **Fase 9 concluída**: motor de push atômico **APE** (`ape.ts`) cobrindo agregação por prioridade (`push_jobs_active`), execução passo a passo lendo o Bling na hora sem repetir passos `completed`, skip de estoque em anúncio só Full (`ml_full`), escrita de preço apenas na condição com `follow_store_price = true`, envio de estoque zero e pausa mesmo com NCM inválido, alerta crítico de preço abaixo do custo sem bloquear e proteção contra eco do `PUT`.
- **Fase 10 concluída**: gerenciador de ciclo de vida de dados **DLM** (`dlm.ts`) cobrindo agenda repetível BullMQ em `America/Sao_Paulo`, lock de coordenação entre réplicas (réplica extra não duplica limpeza nem arquivamento), limpeza TTL em lote com `FOR UPDATE SKIP LOCKED` preservando `pending`/`queued`/`failed` e `control_changes`, anulação de `webhook_events.raw_payload` após 30 dias, arquivamento fiscal de 5 anos (`MOVE` para `*_archive`) e manutenção de partições mensais.
- **Fase 11 concluída**: rotas de operação (`routes/dashboard.ts`) e telas prioritárias do Dashboard em Next.js (`/`, `/matching`, `/fiscal/ean`, `/fiscal/ncm`), validando o fluxo autenticado onde dois usuários `fiscal_approver` distintos confirmam o mesmo NCM com nota de TIPI.
- **Fase 12 concluída**: ensaio ponta a ponta com recorte real do catálogo (`orchestrator/pipeline.ts`), métricas operacionais, replay de job `failed` sem repetir passos concluídos e medição do lag de estoque P1 abaixo de 2 minutos (**todas as 14 suítes / 52 testes aprovados**).
