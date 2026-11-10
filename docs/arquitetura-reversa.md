# Volta do diagrama — decisões ainda abertas

O diagrama de fluxo desenha setas nos dois sentidos: o ERP troca o cadastro inteiro com o HUB, e os marketplaces devolvem catálogo, estoque e pedido.

O código de hoje faz a ida. O ERP é a fonte de preço, estoque e fiscal. O canal enriquece conteúdo e mídia. A volta está fechada de propósito. Estas três decisões precisam ser tomadas antes de abrir essa volta.

## 1. Conflito de estoque e preço

Quando o número do marketplace diverge do número do ERP, quem vence?

Hoje vence o ERP. `channel_sync_owners.stock_price` nasce `bling_native`. `MarketplaceConnector.updateStock` responde `estoque_na_integracao_nativa` e não grava saldo. Estoque Full do Mercado Livre é só leitura.

Para ligar a volta, a regra tem de dizer, por campo:

- estoque do vendedor: ERP, canal, ou o mais recente com carimbo de hora;
- preço de loja: ERP, canal, ou o mais recente;
- o que acontece com o saldo que o canal já baixou por um pedido que o HUB não viu.

Sem essa regra, gravar o webhook de estoque do canal por cima do ERP cria dois saldos verdadeiros.

## 2. Escopo de pedidos

O HUB processa pedido ou só catálogo?

Hoje é só catálogo. `catalog-mode.ts` recusa evento de pedido e de NF (`modo_catalogo`). O plano-mestre deixa pedido, NF-e e frete fora do HUB. O diagrama mostra o marketplace devolvendo pedido.

Se a resposta for só catálogo, a seta de pedido do diagrama não será implementada. Se a resposta for processar pedido, isso é um módulo novo: ele não entra no conector de catálogo e não altera preço nem NCM.

## 3. Quando ligar `ENABLE_LIVE_PUBLISHING`

A flag só publica quando o valor é exatamente `true`. Qualquer outro valor faz o worker da `publish_queue` gravar `simulado com sucesso` e não chamar `createListing`.

Condições para ligar, todas ao mesmo tempo:

1. O checklist do canal está verde para o produto que vai sair.
2. A conta do canal renova o token sozinha.
3. O conflito da seção 1 está decidido e implementado, ou a volta continua desligada e o envio é só HUB → canal.
4. Um lote pequeno foi simulado e conferido no painel de problemas, sem falha aberta.
5. Há uma pessoa com permissão `push:execute` acompanhando a primeira hora.

Enquanto qualquer item faltar, a flag permanece desligada.
