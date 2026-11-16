# JH Sync Hub

[![CI](https://github.com/Andmurph1218/Bling-Sync-HUB/actions/workflows/ci.yml/badge.svg)](https://github.com/Andmurph1218/Bling-Sync-HUB/actions/workflows/ci.yml)

HUB / iPaaS de normalização de catálogo entre um ERP soberano e os canais de venda. O ERP entrega o cadastro, o HUB padroniza produto, variante, categoria e atributo, e os canais recebem só o que passou na validação.

O ERP instalado é o **Bling**. Os canais com código são **Nuvemshop** (ativo) e **Mercado Livre** (código presente, produto inativo); **Shopee** está na fábrica de conectores e **Amazon** e **TikTok Shop** aparecem na loja como em breve. Preço, estoque e fiscal são soberanos no ERP. Pedido e NF-e ficam fora.

- **Painel:** https://hub.jhshopping.com.br
- **Estado:** V2 concluída, piloto de publicação em andamento (`ENABLE_LIVE_PUBLISHING=false`)
- **Produção:** 36 migrations aplicadas, 57 suítes / 242 testes

## Documentação

Quatro pontos de entrada, sem duplicata:

| Documento | O que tem |
|---|---|
| [docs/01-arquitetura.md](docs/01-arquitetura.md) | **Arquitetura e regras.** Hexagonal final (conectores isolados), soberania do ERP, motores, contrato de ERP, schema e fluxos de referência, arquitetura de telas |
| [docs/02-status-e-roadmap.md](docs/02-status-e-roadmap.md) | **Estado e roadmap.** O que está no ar, o que falta para o piloto, dívidas P1, histórico de implantação |
| [docs/auditorias/](docs/auditorias/) | **Registros históricos.** Auditoria de go-live (revisão 3) e auditoria delta de 13/11. Ambas concluídas |
| [docs/historico/](docs/historico/) | **Planos executados.** P0-D4 da publicação Nuvemshop, marcado como concluído |

## Estrutura do repositório

```text
apps/api        API Express + workers BullMQ (catálogo, filas, motores, conectores)
apps/web        Painel Next.js 14 (App Router)
deploy          Scripts de deploy da Droplet (update-hub.sh, push-update.py, ...)
docs            Documentação canônica (este índice), auditorias e histórico
docker-compose.yml   PostgreSQL 16 + Redis 7 para desenvolvimento
```

Dentro da API:

```text
apps/api/src/connectors/strategy/   contratos (ErpConnector, MarketplaceConnector) e fábrica
apps/api/src/connectors/bling/      ERP atual
apps/api/src/connectors/nuvemshop/  canal ativo (html, http, listing, publish, draft, connector)
apps/api/src/connectors/shopee/     Open Platform v2
apps/api/src/catalog/               catálogo, completude, checklist, preview
apps/api/src/queues/                publicação, sync do ERP, enriquecimento, imagens, cartas mortas
apps/api/src/engines/               PIRE, VIR, GVE, NVE, CQS, IQRE, CRE, APE, WIG, DLM
```

O núcleo não importa pasta de fornecedor. `apps/api/src/__tests__/architecture.test.ts` garante isso na CI.

## Desenvolvimento

```bash
npm ci
docker compose up -d          # PostgreSQL 16 + Redis 7
cp .env.example .env          # preencha as variáveis obrigatórias
npm run migrate:up
npm run seed:admin
npm run dev:api               # http://127.0.0.1:3001
npm run dev:web               # http://127.0.0.1:3000
```

Verificação antes de abrir PR:

```bash
npm run typecheck
npm test
npm run build
```

A suíte não abre banco nem Redis: os testes usam `pg-mem`. A CI roda os mesmos três comandos.

## Variáveis de ambiente

Obrigatórias para a API subir:

| Variável | Para que serve |
|---|---|
| `DATABASE_URL` | PostgreSQL 16. A API não sobe sem ela |
| `REDIS_URL` | Redis 7 para BullMQ, cota do Bling e pausa da publicação |
| `OAUTH_ENCRYPTION_KEY` | **64 caracteres hex (32 bytes).** Cifra tokens OAuth e credenciais de app (AES-256-GCM). Sem ela a API recusa iniciar. Gere com `openssl rand -hex 32` e nunca reuse a chave de exemplo do repositório |
| `PUBLIC_BASE_URL` | Base pública (`https://hub.jhshopping.com.br`). É daqui que sai a URL das imagens servidas em `/api/media/:sha256` |
| `SESSION_COOKIE_NAME` | Nome do cookie de sessão |
| `SESSION_COOKIE_SECURE` | `true` em produção (HTTPS) |

Recomendadas e de operação:

| Variável | Padrão | Efeito |
|---|---|---|
| `PORT` | `3001` | Porta da API |
| `HOST` | `0.0.0.0` | Interface de escuta |
| `NODE_ENV` | — | `production` no systemd. Não exporte no shell do `npm install` (ver Migrations) |
| `LOG_LEVEL` | `info` | Nível do log |
| `ACTIVE_ERP` | `bling` | ERP soberano |
| `ENABLE_LIVE_PUBLISHING` | `false` | Só `true` faz chamada real ao marketplace |
| `LIVE_PUBLISH_ALLOWLIST` | vazio | SKUs do piloto, separados por vírgula. Vazio não publica ninguém |
| `AUTO_PUBLISH_ENABLED` | `false` | Enfileira publicação automática quando o checklist fica 100% |
| `NUVEMSHOP_STORE_ID` | descoberto no OAuth | Fixa a loja (produção usa `6667412`) |
| `MEDIA_STORAGE_DIR` | `data/media` | Onde o IQRE grava o cache de imagens |
| `BLING_CLIENT_ID` / `BLING_CLIENT_SECRET` / `BLING_WEBHOOK_SECRET` | — | OAuth e HMAC do Bling |
| `NS_CLIENT_ID` / `NS_CLIENT_SECRET` / `NS_WEBHOOK_SECRET` | — | Credenciais da Nuvemshop |
| `ML_CLIENT_ID` / `ML_CLIENT_SECRET` / `ML_WEBHOOK_SECRET` | — | Credenciais do Mercado Livre (canal inativo) |

Rode `openssl rand -hex 32` uma vez e guarde a chave fora do repositório. Trocar a chave exige re-cifrar os segredos:

```bash
OAUTH_ENCRYPTION_KEY_OLD=<antiga> OAUTH_ENCRYPTION_KEY_NEW=<nova> \
  npm run rotate:oauth-key --workspace=@bling-sync/api -- --dry-run
# confira "N registros prontos para rotação" e repita com --execute
```

O script roda numa transação e faz `ROLLBACK` se qualquer segredo não abrir com a chave nova. Pare a API antes do `--execute`.

## Migrations

As migrations ficam em `apps/api/src/db/migrations` e são TypeScript. O `node-pg-migrate` carrega cada arquivo com `require()`. No Linux o Node recusa essa sintaxe (`SyntaxError: Unexpected token '{'`). O script `npm run migrate:up` executa o binário com `tsx`, que transpila o TypeScript nesse `require`.

```bash
npm run migrate:up      # aplica as pendentes
npm run migrate:down    # reverte a última
```

Migrations recentes:

| Migration | O que faz |
|---|---|
| `1729080000034_image-queue-erp-source` | Amplia o `CHECK` de `image_processing_queue.source_platform` para aceitar `'erp'`. Sem ela o Full Sync não enfileira a imagem do ERP e o produto fica sem capa |
| `1729080000035_publish-queue-open-unique` | Índice único parcial `publish_queue (product_id, channel) WHERE status IN ('pending', 'processing')`: um job aberto por produto e canal. Falha se a base já tiver dois jobs abertos para o mesmo par; confira antes do deploy |
| `1729080000036_catalog-sort-indexes` | Índices da ordenação do catálogo: `lower(name)`, `lower(erp_sku)` e a escolha da variante exibida (`master_product_id, is_default DESC, updated_at DESC`) |

O build da API grava `apps/api/dist/db/migrations/package.json` com `{"type":"commonjs"}`. O `tsc` emite essas migrations como CommonJS, e esse arquivo faz o Node tratá-las assim. Não crie esse arquivo à mão no servidor.

## Deploy na Droplet

O deploy não é `git pull` no servidor. O `deploy/push-update.py` empacota o repositório local, envia por SSH para `201.79.39.118` e executa o `deploy/update-hub.sh` como root.

### Passo a passo

```bash
# 1. Local: publicar o código
git push origin main

# 2. Servidor: backup antes de mexer no banco
ssh root@201.79.39.118
set -a; . /opt/bling-sync-hub/.env; set +a
pg_dump -Fc -d "$DATABASE_URL" -f /root/pre-deploy-$(date +%Y%m%d-%H%M).dump

# 3. Servidor: conferir que não há dois jobs abertos por produto e canal
psql "$DATABASE_URL" -c "SELECT product_id, channel, count(*) FROM publish_queue \
  WHERE status IN ('pending','processing') GROUP BY 1,2 HAVING count(*) > 1;"

# 4. Local: empacotar e executar o deploy
HUB_SSH_PW=<senha> python deploy/push-update.py
```

O `update-hub.sh` faz, nesta ordem: copia o código sobre `/opt/bling-sync-hub`, remove arquivos obsoletos de `connectors/strategy`, roda `npm ci` e o build da API e do painel (com `NODE_ENV` removido do ambiente), aplica `npm run migrate:up`, reescreve o `systemd` da API e do painel, recarrega o Caddy e valida `/health` e a tela de login.

Critérios de sucesso na saída: `Migrations complete!`, `env_preserved`, `/health` com `postgres.ok` e `redis.ok`, `web:200` e `UPDATE_OK`.

### Pós-deploy

```bash
psql "$DATABASE_URL" -tAc "select count(*), max(name) from pgmigrations;"   # 36 migrations
curl -fsS https://hub.jhshopping.com.br/health
journalctl -u bling-hub-api -p err --since "-5min"
```

### Cuidados

- **`NODE_ENV=production` não pode vazar para o `npm install`.** Isso omite devDependencies e deixa o build e a migration sem `tsc` e `tsx`. O script já contorna com `env -u NODE_ENV`; não use `--omit=dev` nem `--production`.
- **`OAUTH_ENCRYPTION_KEY` não é gerada pelo deploy.** O `.env` do servidor é preservado entre versões (`chmod 600`, dono `blinghub`). Se a chave mudar, rode a rotação antes de reiniciar a API.
- **`data/media` não é tocado pelo deploy.** O cache de imagens fica fora do pacote e é servido por `/api/media/:sha256`.

## Princípios

1. Dado fiscal, preço e estoque do ERP não são sobrescritos por canal.
2. Campo preenchido com lixo vale menos que campo vazio.
3. Identidade é multi-sinal. SKU sozinho não decide o vínculo.
4. Um produto gera um job por canal. O payload sai do modelo do HUB, com preço e estoque lidos do ERP.
5. Toda operação pode ser reexecutada com o mesmo resultado.
6. EAN inválido, NCM divergente ou preço zero bloqueiam publicação. Estoque de anúncio já publicado continua.
7. NCM e EAN não são apagados. O arquivo fiscal permanece por 5 anos.

## Licença e contato

Repositório privado da JH Shopping. Dúvidas de operação: `catalogo@jhshopping.com.br`.
