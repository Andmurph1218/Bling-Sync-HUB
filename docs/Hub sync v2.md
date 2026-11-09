# JH Sync Hub — Brief de intenção

Estas notas **não são regras fixas**. O plano detalhado está em [bling_sync_hub_evolucao_dashboard.md](bling_sync_hub_evolucao_dashboard.md).

## Problema

O HUB ficou complexo demais para produção. Quem opera logística e estoque precisa entender o fluxo sem conhecer motores internos (PIRE, VIR, GVE, etc.).

## Direção

- Catálogo onde os produtos são armazenados e gerenciados.
- Foco do HUB nas **integrações**.
- Cada produto exige atributos diferentes em cada marketplace.
- Serviço avançado de **regularização de atributos**, para o mesmo produto atender todas as plataformas de forma consistente.
- Sem produtos duplicados no ERP (hoje Bling; abstrair para qualquer ERP).
- Exigir boas práticas de catálogo do operador.
- UI/UX coesa com abas distintas.
- Página inicial = dashboard com informações e hero cards relevantes sobre o catálogo.

## Referências de produto

- Plugg.to — [demo](https://youtu.be/239wfkYZD2Q)
- Moovin HUB — [demo](https://www.youtube.com/watch?v=Yx0fuxKGQE0)

## Estado em 06/11/2026

O painel público está em `https://hub.jhshopping.com.br`. O operador troca tema claro e escuro no cabeçalho. Produto incompleto na lista de envio recebe um aviso com as pendências e o atalho para a ficha, sem o banner verde de texto corrido. O acompanhamento está em [status-implantacao.md](status-implantacao.md).

## Fora do escopo (alinhado ao plano-mestre)

Pedidos, NF-e, frete, expedição e escrita em estoque Full do Mercado Livre.
