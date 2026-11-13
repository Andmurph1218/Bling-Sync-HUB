# JH Sync Hub — Brief de intenção

Estas notas resumem a visão operacional da interface v2. O plano detalhado original está em [bling_sync_hub_evolucao_dashboard.md](bling_sync_hub_evolucao_dashboard.md) e a auditoria atualizada de prontidão para produção está em [auditoria-go-live.md](auditoria-go-live.md).

## Problema

O HUB não pode exigir que quem opera catálogo, fiscal e estoque conheça siglas de motores internos (PIRE, VIR, GVE, NVE, CQS, IQRE, CRE, APE, WIG, DLM) para tomar decisões seguras no dia a dia.

## Direção consolidada

- **Catálogo centralizado (`/catalogo`):** produtos-pai com variações agrupadas, ficha única, busca rápida, planilhas e cadastro rápido integrado ao ERP.
- **Foco em integrações (`/canais` e `/admin/integracoes`):** saúde clara de cada canal conectado, depósitos classificados e separação explícita entre conexão ativa e anúncios vinculados.
- **Regularização de atributos (`/atributos` e `/completude`):** mapeamento De/Para de categorias e atributos para atender cada canal sem duplicar produtos no ERP.
- **Governança e proteção comercial:** soberania absoluta do ERP em preço, estoque e fiscal; vínculos automáticos somente com dois sinais concordantes; envio ao vivo bloqueado por padrão (`ENABLE_LIVE_PUBLISHING=false`) com allowlist (`LIVE_PUBLISH_ALLOWLIST`) e botão de pânico.
- **UI/UX operacional:** navegação direta por módulos, temas claro e escuro e Visão Geral (`/`) focada no que pede ação.

## Referências de produto

- Plugg.to — [demo](https://youtu.be/239wfkYZD2Q)
- Moovin HUB — [demo](https://www.youtube.com/watch?v=Yx0fuxKGQE0)

## Estado em 12/11/2026

O painel público opera em `https://hub.jhshopping.com.br` (versão `30e088f`, 33 migrations aplicadas). A Visão Geral exibe o progresso por página da sync completa do Bling (destravada além dos 10.000 registros iniciais com retomada automática), o total de produtos e variações, as pendências acionáveis e o card **Canais Ativos** com a Nuvemshop marcada como **`Conectado`** e reconciliando vínculos em lote da loja `6667412`. A tela **Problemas** concentra divergências de canal, duplicidades, métricas de fila e reprocessamento de cartas mortas (`dead_letters`). O acompanhamento detalhado está na seção 14 de [status-implantacao.md](status-implantacao.md) e as regras de leitura reversa em [arquitetura-reversa.md](arquitetura-reversa.md).

## Fora do escopo (alinhado ao plano-mestre)

Pedidos de venda, financeiro, NF-e, cotação de frete, expedição e escrita em estoque Full do Mercado Livre (`meli_facility`).
