# JH Sync Hub — Resumo Executivo e Arquitetura (iPaaS)

**Estado em 12/11/2026:** O HUB está no ar em `https://hub.jhshopping.com.br` (DigitalOcean, versão `30e088f`, 33 migrations aplicadas).  
A arquitetura V2 e as proteções pré-go-live (P0, P1 e P2 de [auditoria-go-live.md](auditoria-go-live.md)) estão implantadas. O sistema opera em **Modo Shadow** (`ENABLE_LIVE_PUBLISHING=false`), com `LIVE_PUBLISH_ALLOWLIST` e botão de pânico prontos para o Teste Canário controlado.

## 1. O Que É
O **JH Sync Hub** é um **iPaaS (Integration Platform as a Service)** focado em normalização e governança de catálogo. Ele atua como camada central entre o **ERP soberano (Bling)** e os **Canais de Venda (Nuvemshop ativo; Mercado Livre e Shopee implementados na fábrica de conectores)**.

## 2. O Problema Que Resolve
O catálogo estava fragmentado e incompleto entre ERP e canais. O cadastro do ERP tinha lacunas de conteúdo e mídia, enquanto os marketplaces exigiam atributos específicos por categoria, gerando retrabalho manual, risco de anúncios duplicados e risco de *overselling* (mistura de depósitos ou venda sem saldo elegível).

## 3. A Ideia Central: Soberania e Enriquecimento
**"O Bling manda. Os marketplaces enriquecem. O HUB orquestra."**

- **O Bling é intocável:** Preço, Estoque, SKU, Custo, NCM, CEST e Origem Fiscal são de propriedade exclusiva do ERP. O HUB nunca sobrescreve esses dados no Bling a partir de marketplaces. Quando há divergência no canal, a reconciliação registra um retrato (`marketplace_listings_snapshot`) e abre alerta para o operador.
- **O HUB é o maestro (PIM):** Lê o cadastro ativo do Bling (`criterio=2`), agrupa variações filhas sob o produto-pai, enriquece mídia e conteúdo por canal sem sujar o cadastro mestre do ERP e valida o checklist antes de qualquer envio.
- **O Marketplace é o destino:** Recebe apenas produtos com checklist verde, respeitando limites de taxa, idempotência e regras fiscais.

## 4. Arquitetura de Software (Ports & Adapters)
O HUB utiliza contratos neutros em `apps/api/src/connectors/strategy/types.ts` (`ErpConnector` e `MarketplaceConnector`):
- O modelo canônico do catálogo usa identidade agnóstica (`erp_id`, `erp_sku`) e seleciona o conector ativo via `ACTIVE_ERP` (`activeErpConnector()`).
- O conector do Bling vive isolado em `apps/api/src/connectors/bling`.
- O teste `architecture.test.ts` garante continuamente na CI que nenhum arquivo fora de `connectors/bling` importe essa pasta (`50/50` suítes aprovadas).

## 5. O Motor de Integração (Como funciona na prática)

1. **Ingestão (Sync & Webhooks):** O worker `erp-sync-queue` percorre todo o catálogo ativo do Bling em páginas de 50 itens (respeitando o limite global de 3 req/s e pausa automática em 80% da cota diária de 120 mil chamadas, com retomada automática por página em caso de reinício) e recebe atualizações em tempo real via webhooks assinados (HMAC-SHA256).
2. **Enriquecimento (Worker assíncrono):** Busca imagens (enfileiradas no IQRE sem elegibilidade imediata de capa) e NCM (encaminhado para aprovação fiscal em duas etapas) em transações por produto, recalculando a completude.
3. **Reconciliação (Leitura reversa segura):** Lê o catálogo dos canais ativos (na Nuvemshop, em lotes paginados de 200 produtos com descoberta automática do `store_id`), compara preço, estoque e imagens contra o ERP sem alterar o Bling e vincula anúncios usando **regra de dois sinais** (SKU + EAN ou título compatível → `vinculado`; 1 sinal isolado → `sugerido` para revisão em `/vinculos`).
4. **Publicação (BullMQ + Guardas de Go-Live):** O operador simula o payload (Dry-Run). Na Nuvemshop, o escritor reconstrói preço e estoque na hora do envio, grava o `listing_id` na mesma transação, bloqueia criação se já houver vínculo e respeita `ENABLE_LIVE_PUBLISHING`, `LIVE_PUBLISH_ALLOWLIST` e o botão de pânico. Falhas esgotadas vão para `dead_letters` com opção de reprocessamento.

## 6. Governança de Dados (Regras Blindadas pela Auditoria)

| Grupo de Dado | Soberania | Regra de Ouro |
| :--- | :--- | :--- |
| **A (Comercial/Fiscal)** | Bling | Preço, Estoque, Custo, SKU, NCM, CEST. Nunca sobrescritos por dados de marketplace. |
| **A.5 (EAN / NCM sugerido)** | Bling + Revisão Fiscal | EAN externo passa pelo **GVE** e exige aprovação humana; NCM pendente exige dupla confirmação por dois revisores fiscais distintos com nota TIPI (**NVE** / `/fiscal/ncm`). |
| **B (Conteúdo)** | Bling (mestre) / HUB (canal) | Nome e descrição do Bling nunca são sobrescritos; títulos e descrições otimizados para SEO por canal ficam em `channel_content_overrides`. |
| **C (Mídia)** | HUB (IQRE) | Imagens importadas passam por validação de resolução, deduplicação (aHash) e direitos em `product_images` antes de virarem capa. |
| **Estoque** | Bling (`seller`) | `product_variants.stock` soma apenas depósitos `role = 'seller'` com `include_in_push = true` (`catalog_stock` é apenas visual). Estoque Full (`ml_full` / `meli_facility`) nunca é somado nem escrito. |

## 7. Os Módulos Operacionais no Painel
Para quem opera no dia a dia, o painel traduz os motores internos em fluxos diretos:
- **Início (`/`):** Saúde do catálogo, progresso da sync do Bling, ações necessárias e canais ativos (conexão separada da contagem de anúncios vinculados).
- **Catálogo (`/catalogo`):** Espelho normalizado com produtos-pai, variações agrupadas, ficha completa, exportação/importação de planilha e cadastro rápido (`+ Produto`) integrado ao Bling.
- **Completude (`/completude`) e Atributos (`/atributos`):** Diagnóstico do que falta por canal e mapeamento De/Para de categorias e atributos.
- **Vínculos (`/vinculos`):** Revisão humana de correspondências sugeridas com 1 sinal e busca de anúncios existentes.
- **Problemas (`/problemas`):** Painel agrupado de divergências de canal, duplicidades, falhas de fila e cartas mortas (`dead_letters`) com métricas operacionais.
- **Lista de Envio (`/publicacoes`), Fiscal (`/fiscal/*`) e Configurações (`/configuracoes/*`):** Simulação/envio, aprovação de EAN/NCM, usuários/permissões, allowlist do piloto e botão de pânico.

## 8. Stack Técnica e Infraestrutura
- **Infraestrutura:** DigitalOcean Droplet (Ubuntu), Caddy (HTTPS + Reverse Proxy), Systemd (`bling-hub-api` e `bling-hub-web`).
- **Backend:** Node.js 20 + TypeScript estrito, Express, BullMQ + Redis 7 (filas, rate-limit global de 3 req/s e cota diária).
- **Banco de Dados:** PostgreSQL 16 (33 migrations versionadas via `node-pg-migrate` + `tsx`, partições mensais e trilhas imutáveis).
- **Frontend:** Next.js 14 (App Router), React 18, Tailwind CSS (temas Claro e Escuro).
- **Segurança:** Argon2id para senhas, sessões opacas SHA-256 em cookie `HttpOnly`, AES-256-GCM para tokens OAuth/credenciais, HMAC em tempo constante nos webhooks e RBAC por papéis e permissões.

## 9. O Que Fica de Fora (Escopo Atual)
- Processamento de Pedidos de Venda, Financeiro, Cotação de Frete e Emissão de NF-e (permanecem no Bling).
- Escrita de Preço, Estoque ou Dados Fiscais de volta no ERP a partir de marketplaces.
- Escrita em estoque Full do Mercado Livre (`meli_facility`).

## 10. Próximos Passos (Rumo ao Go-Live Controlado)

1. **Preparação dos SKUs de teste:** Criar categoria e mapeamento Nuvemshop em `/atributos`, concluir a troca de senha inicial dos 2 revisores fiscais e aprovar NCM + capa dos SKUs escolhidos.
2. **Piloto Canário de 48 h:** Configurar até 10 SKUs em `LIVE_PUBLISH_ALLOWLIST`, habilitar `ENABLE_LIVE_PUBLISHING=true` com acompanhamento humano e validar zero duplicidade e zero *oversell* na Nuvemshop.
3. **Evoluções pós-piloto:** Escritor de atualização de anúncios já publicados, reautorização do Mercado Livre com `offline_access` e alertas de gestão de estoque.

---
**Em uma frase:** O JH Sync Hub mantém o Bling como fonte soberana de preço, estoque e fiscal, enquanto organiza atributos, mídia e vínculos para publicar nos canais com segurança e rastreabilidade.
