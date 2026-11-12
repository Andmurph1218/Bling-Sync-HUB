# JH Sync Hub — Resumo Executivo e Arquitetura (iPaaS)

**Estado em 12/11/2026:** O HUB está no ar em `https://hub.jhshopping.com.br` (DigitalOcean). 
A versão V2 está concluída. O sistema opera em **Modo Shadow** (`ENABLE_LIVE_PUBLISHING=false`), pronto para o Teste Canário (Go-Live controlado).

## 1. O Que É
O **JH Sync Hub** é um **iPaaS (Integration Platform as a Service)** focado em normalização de catálogo. Ele atua como maestro entre o **ERP (Bling)** e os **Marketplaces (Mercado Livre, Nuvemshop, Shopee)**.

## 2. O Problema Que Resolve
O catálogo estava fragmentado e incompleto. O ERP era "pobre" em conteúdo, e os marketplaces exigiam atributos diferentes, gerando retrabalho, anúncios duplicados e riscos de *overselling* (vender o que não tem).

## 3. A Ideia Central: Soberania e Enriquecimento
**"O Bling manda. Os marketplaces enriquecem. O HUB orquestra."**

- **O Bling é intocável:** Preço, Estoque, NCM, CEST, EAN e Custo são de propriedade exclusiva do ERP. O HUB nunca sobrescreve esses dados no Bling. Se houver divergência no marketplace, o HUB apenas **alerta** o operador.
- **O HUB é o maestro (PIM):** Ele lê do Bling, enriquece com dados dos canais (ex: imagens melhores), valida as regras de cada marketplace e distribui.
- **O Marketplace é o destino:** O HUB prepara o pacote perfeito para a Nuvemshop ou Mercado Livre, respeitando os limites de API e a soberania fiscal.

## 4. Arquitetura de Software (Hexagonal / Ports & Adapters)
O HUB foi refatorado para ser **agnóstico ao ERP**. 
- O núcleo do sistema não conhece o Bling. Ele apenas fala a língua universal (`erp_id`, `erp_sku`).
- O `BlingConnector` é uma caixa-preta isolada em `apps/api/src/connectors/bling`.
- Um teste de arquitetura (`architecture.test.ts`) impede que o Bling "vaze" para o núcleo. Se amanhã você integrar a Omie ou o SAP, o núcleo não muda uma linha.

## 5. O Motor de Integração (Como funciona na prática)

1. **Ingestão (Sync & Webhooks):** O HUB puxa 10.000 produtos do Bling em lotes (respeitando rate limit) ou via webhook em tempo real.
2. **Enriquecimento (Worker assíncrono):** O HUB busca NCM e imagens no Bling, atualiza seu banco local e recalcula a completude em tempo real na tela do operador.
3. **Reconciliação (A "Volta" do Diagrama):** A cada 6 horas, o HUB lê os anúncios da Nuvemshop/ML, compara com o ERP e gera alertas (ex: "Preço do ML está R$ 10 mais barato que o Bling" ou "Vendeu no canal, estoque do Bling não baixou").
4. **Publicação (BullMQ):** O operador simula o envio (Dry-run). Se o checklist estiver verde, o job vai para a fila e é publicado. O HUB previne duplicidade: se o produto já existe no canal, ele vincula (`channel_listing_links`) em vez de criar um anúncio novo.

## 6. Governança de Dados (Regras Blindadas pela Auditoria)

| Grupo de Dado | Soberania | Regra de Ouro |
| :--- | :--- | :--- |
| **A (Comercial/Fiscal)** | Bling | Preço, Estoque, NCM, CEST. Nunca alterados pelo HUB. |
| **A.5 (EAN)** | Bling | Se importado de marketplace, exige aprovação humana (NVE). |
| **B (Conteúdo)** | Bling/HUB | Título e descrição. O HUB pode sobrescrever para otimizar SEO. |
| **C (Mídia)** | HUB | Imagens e vídeos. O HUB importa imagens dos canais para enriquecer. |
| **Estoque** | Bling | Somente depósitos do tipo `seller` entram na soma. O Full (`ml_full`) é ignorado. |

## 7. Os Motores (Internos) Traduzidos para o Operador
Para o usuário, o HUB não mostra "NVE" ou "IQRE". Ele mostra:
- **Catálogo:** Onde os produtos vivem.
- **Problemas:** Onde os erros (fiscais, duplicidade, divergência) aparecem com o botão "Corrigir".
- **Atributos:** Onde se faz o "De/Para" das categorias do Bling para o Mercado Livre/Nuvemshop.
- **Lista de Envio:** Onde os produtos 100% prontos são publicados.

## 8. Stack Técnica e Infraestrutura
- **Infraestrutura:** DigitalOcean (Droplet Ubuntu), Caddy (HTTPS/Proxy), Systemd.
- **Backend:** Node.js + TypeScript, Express, BullMQ (Filas assíncronas).
- **Banco:** PostgreSQL (com índices otimizados e migrations versionadas via `tsx`).
- **Frontend:** Next.js, Tailwind CSS (Dark/Light mode), Design focado em UX Operacional.
- **Segurança:** AES-256-GCM para criptografia de tokens, HMAC nos webhooks, RBAC (Admin vs. Operador).

## 9. O Que Fica de Fora (Escopo Atual)
- Emissão de NF-e (continua no Bling).
- Processamento de Pedidos e Frete.
- Escrita de Preço e Estoque no ERP.

## 10. Próximos Passos (Rumo ao Go-Live Total)

1. **Correções Pré-Voo (P0 da Auditoria):** Classificar depósitos (Seller x Full), impedir criação de anúncio duplicado, e colocar NCM importado em aprovação.
2. **Teste Canário:** Ligar a flag para 1 produto, publicar na Nuvemshop e validar.
3. **Inteligência de Estoque (Futuro):** Implementar leitura de pedidos (somente leitura) para calcular Curva ABC, alertas de ruptura e capital parado.

---
**Em uma frase:** O JH Sync Hub transforma o Bling no cérebro absoluto da operação, blindando os dados fiscais, e usa a inteligência dos marketplaces para garantir que nenhum produto fique sem vender por falta de informação.