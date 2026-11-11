# Volta do marketplace para o HUB

O HUB lê o anúncio do canal para alinhar o catálogo. Preço, estoque e fiscal continuam no ERP. O HUB não grava esses campos de volta no Bling.

## Estoque e preço

O ERP é soberano absoluto.

Se o marketplace divergir — vendeu e o Bling não baixou, ou aplicou uma promoção — o HUB não sobrescreve o ERP. A reconciliação grava o retrato em `marketplace_listings_snapshot` e abre um alerta em Problemas, filtro Divergências de Canal. O operador ajusta o número no Bling.

`MarketplaceConnector.updateStock` continua respondendo `estoque_na_integracao_nativa`.

## Dados fiscais

NCM, EAN e SKU nascem no ERP.

Se o anúncio tiver um EAN válido que falta no ERP, o HUB pode sugerir a correção. Quem aplica é o operador, no Bling. O HUB não escreve NCM, EAN nem SKU no ERP.

## Enriquecimento

Imagem, descrição e atributo podem entrar na camada do HUB.

Se o anúncio tiver uma imagem melhor, ou uma descrição mais completa, o operador importa esse conteúdo para `product_images` e para o enriquecimento do HUB. Essa cópia não altera o cadastro do Bling.

## Duplicidade

O detector de duplicidade continua avisando SKU ou EAN repetido e anúncio já publicado.

A reconciliação, quando acha um anúncio ativo com o mesmo SKU ou EAN, vincula esse anúncio ao produto do HUB. Não cria outro cadastro e não cria outro anúncio.

## Pedidos

O HUB não processa pedido nem NF. `catalog-mode.ts` recusa esses eventos. A seta de pedido do diagrama permanece fora deste módulo.

## Quando ligar a publicação ao vivo

`ENABLE_LIVE_PUBLISHING` só publica quando o valor é exatamente `true`. Fora isso, a fila simula.

Condições para ligar, todas ao mesmo tempo:

1. O checklist do canal está verde para o produto que vai sair.
2. A conta do canal renova o token sozinha.
3. A volta de preço e estoque continua só como alerta, sem escrita no ERP.
4. Um lote pequeno foi simulado e conferido no painel de problemas, sem falha aberta.
5. Há uma pessoa com permissão `push:execute` acompanhando a primeira hora.

Enquanto qualquer item faltar, a flag permanece desligada.
