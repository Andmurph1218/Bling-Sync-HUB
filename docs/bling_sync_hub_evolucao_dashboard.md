# JH Sync Hub — Evolução v2: Catálogo, Atributos e UX Operacional

Data do plano: **5 de novembro de 2026**  
Estado no ar em 11/11/2026: [status-implantacao.md](status-implantacao.md), seção 13. O plano abaixo permanece o desenho da evolução v2. P0 e P1 estão no ar. P2 está em sombra. P3 tem o conector Shopee e o CI; Amazon, série de qualidade e deploy por pipeline continuam abertos.  
Spec normativa (regras de soberania e motores): [plano-mestre.md](plano-mestre.md)  
Brief de intenção: [Hub sync v2.md](Hub%20sync%20v2.md) *(diretrizes, não regras fixas)*  
Referências de produto: [demo Plugg.to](https://youtu.be/239wfkYZD2Q) · [demo Moovin HUB](https://www.youtube.com/watch?v=Yx0fuxKGQE0)  
Referência visual da lista de produtos: captura do Plugg.to enviada em 05/11/2026 (seção 6.2)

---

## 1. Por que evoluir agora

A espinha das Fases 0–12 e a primeira evolução do dashboard estão no ar. O HUB funciona, mas a interface ainda fala a língua dos motores (PIRE, VIR, GVE, CQS, CRE, APE). Quem opera logística e estoque no dia a dia não precisa conhecer esses nomes para publicar um produto bem.

O objetivo desta evolução não é reescrever o backend do zero. É **esconder a complexidade de integração** atrás de um produto que o operador entende:

1. Um **catálogo** onde o produto mora e é gerenciado.
2. Um **serviço avançado de regularização de atributos**, para o mesmo SKU atender cada marketplace com as regras dele.
3. **Boas práticas de catálogo** exigidas na UI, não só alertas técnicos.
4. **UI/UX coesa** com abas distintas e home em dashboard com hero cards.
5. **Um produto no ERP**, nunca duplicado — hoje Bling; amanhã qualquer ERP soberano.

Os motores atuais continuam. A mudança é de produto e de linguagem: o operador vê Catálogo, Completude, Canais e Publicação. PIRE/VIR/GVE/NVE/CQS/IQRE/CRE/APE/WIG/DLM viram infraestrutura.

---

## 2. O que aprendemos com Plugg.to e Moovin HUB

### 2.1 Plugg.to ([demo](https://youtu.be/239wfkYZD2Q) + funcionalidades públicas)

| Padrão observado | Lição para o HUB |
|---|---|
| **Catálogo é o coração** — lista com imagem, tipo (simples/agrupado/kit), SKU, preço, estoque, canais | A home e o menu devem girar em torno do catálogo, não das filas técnicas |
| **SKU único e igual em todos os canais** — sem SKU a sync de preço/estoque quebra | Exigir SKU desde o cadastro; bloquear publicação sem SKU estável |
| **Qualidade do anúncio própria do hub** — imagem, nome, marca, dimensões, EAN, garantia, descrição, atributos | Score de completude legível (“falta EAN”, “falta imagem”), não só CRE técnico |
| **Abas por estado** — elegíveis, rejeitados, arquivados | Arquivar em vez de apagar; estados claros na lista |
| **Atrelamento / De-Para de atributos** — `Cor` no hub ↔ `Collor` no marketplace; atributos por categoria | Serviço de mapeamento de atributos é o diferencial de integração |
| **Ações em massa e export** | Operador corrige lote sem abrir 200 fichas |
| Fora do nosso escopo atual | Pedidos, NF-e, expedição, fulfillment, multiconta CNPJ avançada |

### 2.2 Moovin HUB ([demo](https://www.youtube.com/watch?v=Yx0fuxKGQE0) + wiki)

| Padrão observado | Lição para o HUB |
|---|---|
| **Home comercial + “Turbine seu catálogo”** — cards que levam aos incompletos | Hero cards da home apontam incompletos e próximos passos |
| **Fluxo de onboarding linear** — Aplicativos → Canais → Catálogo → Mapeamentos → Anúncios → Match | Menu e wizards na mesma ordem mental |
| **Catálogo próprio** — produtos, categorias, marcas, variações, características; origem ERP ou manual | Catálogo HUB como entidade de gestão, espelhando o ERP sem duplicar no ERP |
| **Mapeamentos por categoria** — fixo / dinâmico / sem mapeamento; verde quando completo | Uma vez por categoria×canal; publicação em lote já preenchida |
| **Anúncios ≠ produtos** — produto no catálogo; anúncio é a projeção no canal | Separar abas Catálogo e Publicações |
| **Match** — vincular anúncios existentes por SKU/GTIN sem recriar nem perder ranking | Reaproveitar PIRE/VIR com linguagem de “vínculo” |
| **Painel de problemas** — estoque, preço, anúncio, com retorno do canal | Traduzir falhas de sync em linguagem operacional |
| Fora do nosso escopo atual | Pedidos, ticket médio comercial, impressão de folha de venda |

### 2.3 O que não copiar

- Pedidos, financeiro, NF-e e frete continuam fora ([plano-mestre.md](plano-mestre.md) / [status-implantacao.md](status-implantacao.md)).
- O operador não deve gerenciar “motores” na tela principal.
- Não criar segundo cadastro fiscal paralelo ao Bling.
- Não duplicar SKU no ERP quando o mesmo produto já existe.

---

## 3. Visão do produto (Hub Sync v2)

> **O HUB é o maestro do catálogo multicanal.**  
> O ERP (hoje Bling) é a fonte soberana de preço, estoque e fiscal.  
> O HUB armazena e gerencia o **catálogo operacional**, regulariza atributos por canal e publica sem duplicar o produto no ERP.

### 3.1 Três promessas ao operador de logística/estoque

1. **Eu vejo meu catálogo** — um produto, um SKU, variação, estoque, canais onde está publicado.
2. **Eu sei o que falta** — o HUB me diz em português o que completar antes de publicar.
3. **Eu publico uma vez, o HUB adapta** — atributos diferentes por marketplace saem do mesmo cadastro via mapeamento.

### 3.2 Princípios de UX

| Princípio | Regra |
|---|---|
| Linguagem operacional | Preferir “Completude”, “Vínculos”, “Publicações”, “Problemas de sync”. Siglas de motor só em detalhes técnicos / auditoria |
| Uma tarefa por aba | Cada aba do menu tem um job claro |
| Hero → ação | Todo card da home leva a uma lista filtrada |
| Boas práticas obrigatórias | Publicar exige checklist mínimo (SKU, imagem, categoria, atributos mapeados, EAN quando exigido) |
| Anti-duplicação | Antes de criar no ERP ou no canal, o HUB busca SKU/EAN/vínculo existente |
| Complexidade na infraestrutura | Motores atuais permanecem; a UI não os exige do operador |

### 3.3 Escopo desta evolução × escopo permanente fora

| Entra | Continua fora |
|---|---|
| Catálogo HUB, completude, mapeamento de atributos, publicações, vínculos, dashboard operacional | Pedidos, NF-e, frete, expedição, comissão, escrita em Full ML |
| Exigir boas práticas de cadastro | Auto-preencher NCM / EAN sem humano |
| Abstrair ERP (interface de conector; implementação atual = Bling) | Trocar o Bling nesta fase |

---

## 4. Arquitetura de navegação (abas distintas)

Menu lateral sugerido — ordem do fluxo mental do operador:

| Aba | Job | O que o operador faz |
|---|---|---|
| **Início** | Decidir o que fazer agora | Lê hero cards e vai ao filtro certo |
| **Catálogo** | Gerenciar o produto | Busca, edita, variações, imagens, status de completude |
| **Completude** | Corrigir cadastro | Fila unificada do que falta (EAN, NCM, imagem, atributo, vínculo) |
| **Atributos** | Regularizar por canal | Mapeia categoria HUB ↔ categoria canal; fixo / dinâmico / manual |
| **Publicações** | Anunciar / sincronizar | Cria anúncio, vê status por canal, simula, publica |
| **Vínculos** | Ligar o que já existe | Match de anúncios já no ML/NS sem duplicar |
| **Canais** | Contas e donos | OAuth, depósitos, `bling_native`/`hub`, shadow/live |
| **Problemas** | Consertar sync | Falhas de estoque, preço, anúncio, com mensagem do canal |
| **Auditoria** | Rastrear | Quem mudou o quê (admin / fiscal) |

Rotas atuais a remapear (sem jogar código fora):

| Hoje | Vira |
|---|---|
| `/` | Início (hero cards de catálogo) |
| `/catalogo`, `/catalogo/[id]` | Catálogo + ficha (abas internas: Geral, Variações, Imagens, Canais, Fiscal) |
| `/pendencias`, `/fiscal/*`, `/qualidade-margem` | Completude (filtros por tipo) |
| *(novo)* | Atributos |
| `/publicacoes` | Publicações |
| `/matching` | Vínculos |
| `/canais` | Canais |
| *(novo ou derivado de publicações)* | Problemas |
| `/auditoria` | Auditoria |

---

## 5. Home — Dashboard com hero cards

A primeira tela não é um painel de motores. É um **dashboard de catálogo**.

### 5.1 Hero cards (obrigatórios)

| Card | Mostra | Clique leva a |
|---|---|---|
| **Produtos no catálogo** | Total de SKUs ativos | `/catalogo` |
| **Prontos para publicar** | Completude OK em todos os canais ativos | `/catalogo?status=ready` |
| **Incompletos** | Falta dado obrigatório | `/completude` |
| **Sem vínculo** | Anúncio no canal sem produto HUB / vice-versa | `/vinculos` |
| **Problemas de sync** | Falhas abertas de estoque/preço/anúncio | `/problemas` |
| **Publicações hoje** | Enviadas / falhas / na fila | `/publicacoes` |

### 5.2 Faixa secundária

- Estado dos canais (conectado / token / nativa vs hub) — sem jargão OAuth.
- Última sync bem-sucedida vs última com erro.
- “Turbine seu catálogo” (inspirado Moovin): % de completude + top 3 lacunas clicáveis.

### 5.3 O que some da home

- Cards cujo único rótulo é a sigla de um motor.
- Números sem próximo passo.
- Alertas sem SKU afetado.

---

## 6. Catálogo — onde o produto mora

### 6.1 Modelo mental

```
ERP (Bling)  ──espelho soberano──►  Catálogo HUB  ──projeção──►  Anúncio ML / NS
     ▲                                    │
     │                                    ├── variações
     │                                    ├── imagens
     │                                    ├── completude
     └──── nunca duplicar SKU ────────────┴── vínculos
```

- **Um SKU vendável** = uma variante no HUB (alinhado ao plano-mestre).
- Produto simples, grade e kit aparecem com tipo claro (como no Plugg).
- Arquivar ≠ apagar (recomendação Plugg).

### 6.2 Lista do catálogo — layout de referência

A captura enviada (lista de produtos do Plugg.to) é o padrão a seguir na tela `Catálogo`. Ela resolve o problema central: o operador vê o produto, o SKU, o estoque e onde ele está publicado numa linha só.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Catálogo                                                        [+ Produto] │
├──────────────┬──────────────────────────────────────────────────────────────┤
│ FILTROS      │ [Lista de produtos] [Lista de envio] [Importações] [Exportações]│
│ SKU…         │ ┌Todos 1.234┐┌Publicados 5┐┌Completude 87┐┌Rejeitados 1┐┌Arquivados 0┐│
│ Nome…        │ ☐ │Imagem│Nome│Tipo│SKU│Estoque│Preço│Promo│Canais│Completude│Ações│
│ Ver mais ▾   │ ☐ │ [img]│…   │Simples│…│ 20 │650,00│600,00│ ML NS│ ● 82% │✎ ⧉ 📍 🗂 │
│ [Filtrar]    │   │Variações ▾                                                │
│ [Limpar]     │                                                               │
│              │                                                               │
│ AÇÕES EM LOTE│                                                               │
│ Status… ▾    │                                                               │
│ [Executar]   │                                                               │
│              │                                                               │
│ IMPORTAÇÃO   │                                                               │
│ Importar… ▾  │                                                               │
└──────────────┴──────────────────────────────────────────────────────────────┘
```

**Barra lateral esquerda**

| Bloco | Conteúdo |
|---|---|
| Filtros | SKU, nome, “Ver mais” (marca, categoria, canal, estoque zerado, sem EAN, sem imagem, sem categoria mapeada); botões Filtrar e Limpar |
| Ações e relatórios | Seleção de ação em lote sobre as linhas marcadas + Executar (arquivar, enviar para lista de envio, recalcular completude, exportar seleção) |
| Ações de importação | Reimportar do ERP, importar planilha de enriquecimento (só campos não soberanos) |

**Botões do topo** (sub-visões da mesma aba, não abas novas do menu)

| Botão | Mostra |
|---|---|
| Lista de produtos | O catálogo (padrão) |
| Lista de envio | Produtos selecionados para publicar, com o checklist de cada canal |
| Importações | Histórico de importações do ERP e de planilhas, com erros por linha |
| Exportações | Exportações geradas, para baixar |

**Abas de estado com contador**

| Aba | Critério |
|---|---|
| Todos | `catalog_status = active` |
| Publicados | Ao menos um canal com anúncio vinculado e ativo (no Plugg é “Places”; aqui o nome é Publicados, porque “Places” lá significa centro de distribuição) |
| Completude | Produtos com algum item do checklist da seção 6.4 pendente |
| Rejeitados | Anúncio recusado pelo canal ou passo de publicação `failed` |
| Arquivados | Arquivados pelo operador; não somem do ERP |

**Colunas da tabela**

| Coluna | Regra |
|---|---|
| ☐ | Seleção para ação em lote |
| Imagem | Capa elegível. Abaixo, “Variações ▾” expande as variantes em sub-linhas (SKU, eixos, estoque, preço) |
| Nome | Nome do ERP. Título de canal não substitui |
| Tipo | Simples, Com variações, Kit — em português, não `S`/`V`/`E` |
| SKU | SKU vendável. Vazio aparece em destaque vermelho com “Sem SKU — não sincroniza” |
| Estoque | `floor` do estoque publicado; “—” quando ainda não lido (coluna nula) |
| Preço / Promo | Preço de cadastro do ERP; promocional só quando maior que zero |
| Canais | Logo de cada canal. Colorido = publicado e vinculado. Cinza = vinculado sem publicar ou aguardando. Vermelho = rejeitado. Ausente = não está no canal |
| Completude | Semáforo + %; tooltip lista o que falta em português |
| Ações | Editar (abre a ficha), Duplicar como rascunho de variação, Depósitos (onde o estoque sai), Arquivar. **Excluir não aparece para operador**; arquivar é a ação padrão |

**Ajustes em relação à captura**

- Remover “Excluir” da linha. Produto no HUB é espelho do ERP; apagar aqui não pode apagar no ERP nem no canal.
- Trocar “Integrado” por **Canais** com rótulo textual no hover (“Mercado Livre — publicado”), para não depender só de logo e cor.
- Acrescentar a coluna **Completude**, que a captura não tem e é o centro da v2.
- “Duplicar” não cria SKU novo no ERP. Abre um rascunho que exige SKU novo e passa pelo gate anti-duplicação.
- Botão verde **+ Produto** abre o fluxo de vínculo/importação primeiro; criar do zero só se nada for encontrado por SKU/EAN.

### 6.3 Ficha do produto (abas internas)

1. **Geral** — nome Bling, títulos de canal, marca, categoria HUB.
2. **Variações** — eixos, SKUs, EAN, preço, estoque.
3. **Imagens** — capa, ordem por canal, direitos.
4. **Atributos do produto** — características usadas no mapeamento dinâmico.
5. **Canais** — status de publicação, preço de loja, follow_store_price.
6. **Fiscal** — NCM/EAN em linguagem humana + estado de aprovação.

### 6.4 Boas práticas exigidas (gate de publicação)

Checklist mínimo antes de `CREATE` / republicar conteúdo:

| Regra | Bloqueia publicação? |
|---|---|
| SKU preenchido e único no catálogo | Sim |
| Pelo menos 1 imagem elegível de capa | Sim |
| Categoria HUB definida | Sim |
| Categoria do canal mapeada (verde) | Sim |
| Atributos obrigatórios do canal resolvidos (fixo/dinâmico/manual) | Sim |
| EAN válido quando o canal/categoria exige | Sim |
| NCM válido e sem `conflict` | Sim (conteúdo/criação; estoque/pausa seguem o plano-mestre) |
| Preço > 0 | Sim (passo preço) |
| Sem candidato duplicado SKU/EAN no ERP | Sim — oferece vínculo em vez de criar |

A UI explica o bloqueio em uma frase e oferece o botão “Corrigir”.

---

## 7. Serviço avançado de regularização de atributos

Este é o núcleo da evolução de integração.

### 7.1 Problema

Cada marketplace (e cada categoria) exige atributos diferentes, com nomes e valores diferentes. Sem regularização, o operador preenche o mesmo produto N vezes — ou o ERP ganha cadastros paralelos “para o ML” e “para a Nuvemshop”.

### 7.2 Solução

**Mapear uma vez por (categoria do catálogo × canal).** Depois, qualquer produto daquela categoria publica com os campos preenchidos.

Três modos (padrão Moovin, alinhado ao atrelamento Plugg):

| Modo | Quando | Exemplo |
|---|---|---|
| **Fixo** | Mesmo valor para todos da categoria | Gênero = Feminino |
| **Dinâmico** | Valor vem do produto/variante | Marca ← `product.brand`; Cor ← eixo da variante |
| **Manual** | Só na hora do anúncio | Campo que muda SKU a SKU |

### 7.3 Capacidade do serviço

1. Descobrir atributos obrigatórios/opcionais da categoria no canal (fixtures + API).
2. Sugerir De-Para de nomes (`Cor` ↔ `COLOR` / `Collor`) e de valores (`M` ↔ `Médio`).
3. Marcar categoria **verde** quando obrigatórios estão resolvidos.
4. Na publicação, materializar o payload do canal sem o operador reabrir o formulário.
5. Guardar aliases em `attribute_axes` / `attribute_value_aliases` (já existentes) e evoluir para mapa por canal/categoria.
6. Nunca gravar de volta no ERP um atributo só de marketplace como se fosse cadastro fiscal novo.

### 7.4 Entidades novas (rascunho de schema — a fechar na implementação)

| Entidade | Papel |
|---|---|
| `hub_categories` | Árvore de categorias do catálogo HUB |
| `channel_category_maps` | Categoria HUB ↔ categoria canal |
| `channel_attribute_maps` | Atributo canal: modo fixo/dinâmico/manual + origem |
| `channel_attribute_value_maps` | De-Para de valores |
| `catalog_completeness` | Cache do checklist por produto/variante/canal |

Reaproveitar: `attribute_axes`, `attribute_value_aliases`, `product_category_mappings`, `channel_content_overrides`, motores VIR/CQS/CRE/APE.

---

## 8. Anti-duplicação no ERP

Regra de ouro: **o mesmo produto físico não vira dois cadastros no Bling** (nem em outro ERP futuro).

| Situação | Comportamento do HUB |
|---|---|
| Anúncio novo no canal, SKU/EAN já no catálogo | Oferece **vínculo**, não CREATE no ERP |
| Operador tenta “criar produto” com SKU existente | Bloqueia e abre a ficha existente |
| Família User Product com sinais em dois pais | Quarentena (já no PIRE) — UI explica “possível duplicata” |
| EAN repetido entre variantes do mesmo pai | `duplicate` (já no GVE) — UI pede correção |
| Importação em massa | Relatório de colisões antes de gravar |

A abstração `ErpConnector` (hoje só Bling) isola o ERP: a regra de anti-duplicação vive no HUB, não no marketplace.

---

## 9. Camada de linguagem — traduzir motores

| Motor (interno) | O que o operador vê |
|---|---|
| PIRE / VIR | Vínculos / Match |
| GVE | Código de barras (EAN) |
| NVE | Classificação fiscal (NCM) |
| CQS | Qualidade do texto |
| IQRE | Imagens |
| CRE | Completude / pronto para publicar |
| APE | Publicações / envio |
| WIG | Entrada de atualizações |
| DLM | Limpeza (só admin) |

Detalhe técnico e siglas ficam em Auditoria e tooltips avançados — nunca como único rótulo do card.

---

## 10. Etapas de ajuste e implementação (P0 a P3)

Prioridade define a ordem. Cada etapa só fecha com o critério de saída verificado em tela e em teste. Nenhuma etapa liga escrita real em canal sem autorização explícita.

| Prioridade | Significado |
|---|---|
| **P0** | Bloqueia uso em produção. Corrigir antes de colocar operador na ferramenta |
| **P1** | Núcleo da v2: catálogo usável e regularização de atributos |
| **P2** | Operação diária mais rápida: lote, completude unificada, problemas, vínculos |
| **P3** | Preparação para crescer: outro ERP, novos canais, relatórios |

### P0 — Base confiável para produção

| # | Ajuste | Onde | Critério de saída |
|---|---|---|---|
| P0.1 | Remover dados de exemplo das telas. `catalogo/page.tsx` cai em `SAMPLE_PRODUCTS_FALLBACK` quando a API vem vazia; trocar por estado vazio real | `apps/web/src/app/catalogo/page.tsx` e demais telas com fallback | Nenhuma tela mostra produto, número ou SKU que não esteja no banco |
| P0.2 | Trocar as senhas padrão do bootstrap e exigir troca no primeiro login | `apps/api/src/scripts/bootstrap.ts`, auth | Login com senha padrão é recusado fora de dev |
| P0.3 | Renomear a navegação para a linguagem operacional (seção 4) e tirar siglas de motor dos rótulos | `app-shell.tsx`, títulos de página | Nenhum item de menu ou card principal usa PIRE, VIR, GVE, NVE, CQS, IQRE, CRE, APE |
| P0.4 | Destacar SKU vazio em todo lugar onde o produto aparece | Lista, ficha, home | Produto sem SKU aparece com aviso “não sincroniza” e não pode entrar na Lista de envio |
| P0.5 | Tirar “Excluir” das ações do operador (arquivar entra no P1.3) | Lista e ficha | Operador não tem botão que apague produto |
| P0.6 | Fechar pendências de homologação que afetam dados: refresh do Mercado Livre (`offline_access`) e webhooks de pedido desligados no app do Bling | Painéis dos apps + `oauth_tokens` | Token ML renova sozinho; Bling não envia evento de pedido |

**Saída do P0:** um operador loga com senha própria, vê só dados reais e não encontra jargão de motor nem botão destrutivo.

### P1 — Catálogo e regularização de atributos

| # | Ajuste | Onde | Critério de saída |
|---|---|---|---|
| P1.1 | Nova home com os hero cards da seção 5, todos clicáveis para a lista filtrada | `app/page.tsx`, API de estado operacional | Cada card abre a lista com o mesmo número que mostra |
| P1.2 | Lista do catálogo no layout da seção 6.2: barra de filtros, botões do topo, abas de estado com contador, colunas, “Variações ▾” | `app/catalogo/page.tsx` + endpoint paginado | 1.000+ produtos navegáveis com filtro por SKU em menos de 1 s; contadores batem com o banco |
| P1.3 | Arquivar e desarquivar produto sem tocar no ERP | Migration (`archived_at`) + rota | Arquivado sai de Todos, aparece em Arquivados e volta ao desarquivar |
| P1.4 | Ficha com as abas internas da seção 6.3 | `app/catalogo/[id]/page.tsx` | Todas as abas carregam dados reais; nome do ERP não é editável na aba Geral |
| P1.5 | Checklist de completude por produto e canal (seção 6.4), calculado no backend e exibido como semáforo + motivos | Novo serviço de completude sobre CRE/GVE/NVE | Cada motivo tem frase em português e link “Corrigir” |
| P1.6 | Categorias do catálogo (`hub_categories`) e vínculo produto → categoria | Migration + tela simples de árvore | Todo produto ativo tem categoria ou aparece em Completude como “sem categoria” |
| P1.7 | Tela **Atributos**: categoria do catálogo × canal, modos fixo / dinâmico / manual, indicador verde quando obrigatórios estão resolvidos | `channel_category_maps`, `channel_attribute_maps`, `channel_attribute_value_maps` | Categoria fica verde só com todos os obrigatórios do canal resolvidos |
| P1.8 | Leitura dos atributos obrigatórios por categoria no Mercado Livre e na Nuvemshop | Conectores + fixtures novos | Fixture de categoria ML com atributos obrigatórios cobre o mapper |
| P1.9 | Serviço que materializa os atributos mapeados no `CREATE` e no `CONTENT` | APE + serviço de atributos | Teste: produto de categoria verde gera payload completo sem campo manual |

**Saída do P1:** o operador encontra o produto, entende o que falta, mapeia a categoria uma vez e o HUB monta os atributos de cada canal sozinho.

### P2 — Operação diária

A publicação entra por `MarketplaceConnector` (`createListing`, `updateStock`, `receiveWebhook`) e o ERP por `ErpConnector` (`syncProduct`, `getStock`, `getPrice`). A fábrica em `connectors/strategy` já isola Bling, Mercado Livre e Nuvemshop. Shopee e Amazon estão registradas como não instaladas. Enquanto a escrita ao vivo estiver desligada, `createListing` e `updateStock` recusam a chamada. A lista do catálogo ainda não passa por essa fábrica.

| # | Ajuste | Onde | Critério de saída |
|---|---|---|---|
| P2.1 | **Lista de envio**: selecionar produtos, ver o checklist por canal e simular antes de publicar | Sub-visão do Catálogo + simulador existente | Publicação só sai para produtos com checklist verde no canal escolhido |
| P2.2 | Ações em lote da barra lateral (arquivar, enviar para lista de envio, recalcular completude, exportar) | Lista + rotas em lote | Lote de 100 produtos executa com relatório de sucesso/erro por linha |
| P2.3 | **Completude** unificada: EAN, NCM, imagem, atributo, categoria e vínculo numa fila só | Fundir `/pendencias`, `/fiscal/*`, `/qualidade-margem` | Cada item tem motivo, responsável e ação; fiscal mantém dupla aprovação |
| P2.4 | **Problemas** de sincronização com a mensagem do canal traduzida | Nova aba sobre `push_job_steps` e `webhook_events` | Falha mostra produto, canal, motivo em português e o retorno técnico só no detalhe |
| P2.5 | **Vínculos**: match por SKU, EAN ou manual, ligando variação a variação, sem recriar anúncio | Reaproveitar `/matching` + PIRE/VIR | Anúncio existente é vinculado sem novo `CREATE` |
| P2.6 | Gate anti-duplicação no “+ Produto” e no “Duplicar” (seção 8) | Rota de criação + UI | SKU ou EAN já existente oferece vínculo em vez de criar |
| P2.7 | Importações e exportações com histórico e erros por linha | Botões do topo do Catálogo | Planilha com erro mostra a linha e o campo, sem gravar a linha inválida |

**Saída do P2:** o dia a dia de catálogo acontece no HUB sem abrir o painel do marketplace para corrigir cadastro.

### P3 — Escala

| # | Ajuste | Onde | Critério de saída |
|---|---|---|---|
| P3.1 | Interface `ErpConnector` com a implementação Bling isolada. O contrato e a fábrica foram adiantados no P0.6 | `connectors/strategy` | Catálogo e atributos não importam código específico do Bling |
| P3.2 | Contrato documentado para um segundo ERP | `docs/` | Documento lista os métodos e campos soberanos que o ERP precisa expor |
| P3.3 | Estrutura para novos canais (Shopee, TikTok) no serviço de atributos | Serviço de atributos | Adicionar canal não exige mudar a tela Atributos |
| P3.4 | Relatórios de qualidade do catálogo por canal e evolução da completude | Home / relatórios | Gráfico de completude no tempo com fonte e período |
| P3.5 | Depósitos por anúncio (“Places” do Plugg) quando o canal aceitar mais de um centro de distribuição | Ficha → Canais | Só aparece para canal que suporta; Full continua só leitura |

### Ordem de execução sugerida

1. P0 inteiro (curto e sem migration nova; o arquivamento com `archived_at` entra no P1.3).
2. P1.1 → P1.2 → P1.3 → P1.4 (catálogo usável).
3. P1.5 → P1.6 → P1.7 → P1.8 → P1.9 (atributos).
4. P2 na ordem da tabela.
5. P3 quando houver segundo ERP ou novo canal no horizonte.

### Fora destas etapas (explícito)

Pedidos, NF-e, frete, expedição, multiconta CNPJ estilo Plugg, reprocessamento cego sem confirmação remota e escrita em estoque Full do Mercado Livre.

---

## 11. Critérios de aceite (produto)

1. Operador de estoque identifica, em &lt; 30 s na home, o que está incompleto e o que está com problema de sync.
2. Publicação exige checklist de boas práticas; bloqueio explica o motivo em português.
3. Categoria mapeada (verde) permite publicar vários produtos sem preencher atributo um a um.
4. Mesmo produto atende ML e Nuvemshop com atributos distintos sem segundo cadastro no Bling.
5. Tentativa de criar SKU/EAN já existente oferece vínculo, não duplicata.
6. Nenhuma tela principal depende de sigla de motor para ser usada.
7. Regras do plano-mestre (soberania fiscal, Full, shadow/live, nativa vs hub) permanecem intactas.
8. Testes das Fases 0–12 e da evolução anterior continuam verdes; novas suítes cobrem mapeamento de atributos e gates de completude.

---

## 12. Critérios de validação com operadores

Validar com quem hoje usa logística/estoque (não só com quem conhece o plano-mestre):

1. Encontra um produto pelo SKU e vê em quais canais ele está.
2. Entende o que falta para publicar sem abrir log técnico.
3. Completa um mapeamento de categoria e publica sem reaprender o canal.
4. Recusa criar produto duplicado e vincula o anúncio existente.
5. Arquiva um SKU parado e recupera depois.

Não depender só de cor: todo estado tem rótulo textual e ação acessível por teclado.

---

## 13. Relação com o que já está implantado

| Já existe | Papel na v2 |
|---|---|
| Motores 0–12 + pipeline | Continua como motor; some da linguagem da UI |
| `/catalogo`, ficha, matching, fiscal, publicações, canais, auditoria | Base a reorganizar, não descartar |
| `attribute_axes` / aliases / `product_category_mappings` | Semente do serviço de atributos |
| `channel_sync_owners`, shadow/live | Permanece em Canais |
| Escopo sem pedidos/NF/frete | Mantido |

A evolução anterior (Etapas 0–4 de outubro/2026) entregou login, 8 áreas e dados reais. Esta **v2** muda o centro de gravidade: de “painel de motores e filas” para **hub de catálogo com regularização de atributos**.

---

## 14. Próximo passo imediato

1. Revisar este documento com André e alguém de estoque/logística, usando a captura da seção 6.2 como referência.
2. Executar o **P0** inteiro antes de qualquer tela nova.
3. Seguir com **P1.1 a P1.4** (home e catálogo no layout de referência).
4. Em seguida **P1.5 a P1.9**, onde nasce o valor de integração (completude e atributos).

---

## 15. Conclusão

Plugg.to e Moovin HUB mostram o mesmo desenho vencedor: **catálogo central, mapeamento de atributos por categoria, anúncio como projeção, match sem recriar, home que empurra completude**.

O JH Sync Hub já tem a espinha técnica. A evolução v2 torna essa espinha usável por quem mexe em estoque e logística: um catálogo claro, atributos regularizados por canal, boas práticas exigidas na UI e zero duplicata no ERP.
