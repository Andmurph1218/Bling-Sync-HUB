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

O briefing de desenvolvimento é [docs/plano-mestre.md](docs/plano-mestre.md). Ele já incorpora os ajustes da [revisão](docs/revisao-plano-mestre.md): matching por predicado, enriquecimento com uma ordem só, webhook gravado antes do HTTP 200, e push separado para estoque, conteúdo e criação.

A Fase 0 (monorepo, Docker, pool, Redis e papéis de usuário) é o próximo passo.
