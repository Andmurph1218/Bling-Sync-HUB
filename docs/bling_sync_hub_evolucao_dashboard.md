# Bling Sync HUB — Evolução da Aplicação e Dashboard

## 1. Objetivo

Evoluir o Bling Sync HUB para um centro de controle operacional de catálogo, sincronização e segurança comercial, facilitando o trabalho do operador e tornando claro:

- O que está funcionando.
- O que exige atenção.
- O que está bloqueado.
- Qual ação deve ser executada.
- Qual foi o resultado da operação.

A regra central do projeto permanece:

> **O Bling manda. Os marketplaces enriquecem. O HUB valida, coordena e registra.**

A evolução visual e funcional não pode permitir que operadores, automações ou dados recebidos dos marketplaces sobrescrevam silenciosamente informações fiscais ou financeiras protegidas.

## 2. Diagnóstico do dashboard atual

### Pontos positivos

- Os canais estão visíveis no cabeçalho.
- As métricas principais estão agrupadas em cartões.
- Os bloqueios fiscais usam cores de alerta.
- Há separação entre Matching, GVE e NVE.
- O dashboard sinaliza a última sincronização e o estado das integrações.

### Problemas de usabilidade

- Siglas como PIRE, VIR, CRE, GVE e NVE aparecem sem tradução operacional imediata.
- A nota `68/100` não explica quais produtos estão prontos nem o que falta fazer.
- “8 bloqueios ativos” e “3 alertas críticos” não deixam claro quantos produtos distintos são afetados, quais canais estão envolvidos e qual ação executar.
- Os cartões exibem números, mas não oferecem contexto suficiente para decisões.
- A última sincronização não separa claramente uma execução bem-sucedida de uma execução com erros.

### Riscos que precisam de mais visibilidade

- Divergências de EAN, NCM e outros campos críticos.
- Conteúdo pronto para publicar, mas bloqueado por regra fiscal.
- Conflitos entre o HUB e a integração nativa do Bling.
- Alertas de margem sem identificação clara do custo, preço e canal afetado.
- Reprocessamentos, falhas parciais e ações administrativas sem contexto suficiente.

O principal problema não é a falta de indicadores. É a falta de conexão explícita entre:

**Indicador → problema → impacto → ação → resultado.**

Os exemplos numéricos apresentados no protótipo são ilustrativos. A aplicação deve usar dados reais.

## 3. Nova organização visual

Manter o tema escuro e a identidade visual atual, mas transformar a tela inicial de um painel de métricas técnicas em uma central de decisões e pendências.

### Hierarquia recomendada

1. **Estado operacional:** o HUB está funcionando? Existe algum canal desconectado?
2. **Impacto no negócio:** quantos produtos estão prontos, pendentes, bloqueados ou com falha?
3. **Ação prioritária:** o que o operador precisa resolver agora?
4. **Execução:** o que foi sincronizado, o que falhou e o que ainda está na fila?
5. **Detalhes técnicos:** logs, motores, limites de API e diagnóstico avançado.

O operador não deve precisar conhecer a sigla CRE para descobrir que um produto precisa de uma descrição melhor. A sigla pode continuar disponível nos detalhes técnicos.

### Indicadores principais

- Produtos monitorados — total de SKUs únicos.
- Prontos para publicar — produtos que atendem a todos os critérios aplicáveis.
- Pendências de ação — itens que aguardam operador ou revisão.
- Falhas de sincronização — operações que exigem tratamento.

Todos os indicadores devem ser clicáveis e abrir a listagem filtrada correspondente.

A tela também deve apresentar:

- Bloqueios fiscais.
- Alertas financeiros.
- Estado dos canais.
- Última operação bem-sucedida.
- Atividade operacional recente.

Cada KPI deve ter definição formal, fonte de dados e período de cálculo.

## 4. Arquitetura de navegação recomendada

1. **Visão geral:** saúde dos canais, resumo operacional, prioridades e atividade recente.
2. **Catálogo de produtos:** busca por SKU, comparação entre fontes, qualidade, imagens e situação por canal.
3. **Correspondências:** PIRE/VIR, produtos sem vínculo, duplicidades e revisão manual.
4. **Central de pendências:** EAN, NCM, conteúdo, imagens, aprovações e divergências críticas.
5. **Publicações e sincronizações:** fila de execução, tentativas, resultados por canal, falhas e reprocessamentos.
6. **Qualidade e margem:** CRE, qualidade de conteúdo, preços, custos, margem e alertas financeiros.
7. **Canais e configurações:** OAuth, depósitos, regras de sincronização, integração nativa e limites.
8. **Auditoria e diagnóstico:** histórico de alterações, responsável, execução técnica, erros e rastreabilidade.

As páginas existentes não precisam ser descartadas. Matching (PIRE/VIR), Fiscal — EAN (GVE) e Fiscal — NCM (NVE) podem permanecer como subpáginas, preservando o trabalho existente.

## 5. Funções prioritárias

### 5.1 Central de pendências

Unificar as pendências numa fila única.

| Tipo | Ação proposta |
|---|---|
| EAN ausente ou divergente | Comparar fontes, consultar dados e enviar para aprovação |
| NCM divergente | Bloquear publicação e iniciar aprovação por duas pessoas |
| SKU sem correspondência | Comparar candidatos e confirmar vínculo |
| Variação não identificada | Conferir produto pai, cor, tamanho e SKU |
| Conteúdo incompleto | Editar ou aprovar título, descrição, marca e atributos |
| Imagens duplicadas ou inválidas | Comparar, selecionar e validar imagens |
| Preço abaixo do custo | Consultar custo, preço e margem estimada |
| Publicação com falha | Ver causa, corrigir dados e reprocessar com segurança |

Cada item deve mostrar SKU, produto, canal, data, motivo, impacto, responsável e ação.

**Regra de UX:** cada pendência deve ter um próximo passo claro. Mensagens técnicas, como `Erro 400`, podem aparecer nos detalhes, mas a mensagem principal deve explicar o problema e a solução possível.

### 5.2 Ficha única do produto

Criar uma tela centralizada para comparar Bling, Mercado Livre e Nuvemshop.

Abas sugeridas:

- **Resumo:** situação geral e estado dos canais.
- **Dados mestres:** campos controlados pelo Bling.
- **Conteúdo:** títulos, descrições, atributos e imagens.
- **Variações:** produto pai, filhos e anúncios.
- **Fiscal:** EAN, NCM, CEST e aprovações.
- **Publicação:** estado, payload, retorno do canal e última tentativa.
- **Histórico:** valor anterior, valor proposto, origem e autor.

A interface deve explicar por que determinado valor foi escolhido e o que será alterado antes de qualquer escrita.

### 5.3 Simulador de sincronização

Antes de publicar ou atualizar vários produtos, permitir uma simulação sem modificar dados externos.

Mostrar:

- Quantos produtos serão processados.
- Quantos estão aptos, bloqueados ou aguardando aprovação.
- Quais campos serão alterados em cada canal.
- Quais dados permanecerão inalterados por serem controlados pelo Bling.
- Quais operações serão ignoradas por conflito com a integração nativa.
- Riscos e motivos de bloqueio.

A simulação deve apresentar diferenças planejadas. A execução real só deve começar após confirmação explícita.

A simulação representa o estado conhecido naquele momento; a confirmação definitiva de publicação depende do retorno da API.

### 5.4 Monitoramento das integrações nativas

Por canal, mostrar:

- Quem é responsável por preço e estoque.
- Quem atualiza conteúdo e imagens.
- Estado da integração nativa: ativa, desativada ou desconhecida.
- Data da última verificação.
- Operações permitidas ao HUB.
- Operações bloqueadas por conflito de responsabilidade.

Se não for possível confirmar o estado da integração nativa, mostrar **“Estado não verificado”** e não presumir autorização para escrever preço ou estoque.

A ativação ou desativação da integração nativa deve continuar sendo uma ação manual e explícita.

### 5.5 Proteção comercial e margem

Criar uma central para:

- Preço abaixo do custo.
- Margem estimada baixa.
- Preços divergentes entre canais.
- Custo ausente ou desatualizado.
- Estoque sem possibilidade de publicação.

Permitir filtros por canal, produto, categoria, faixa de margem e período.

Quando todos os custos relevantes forem conhecidos:

`Margem = (Receita líquida - Custo total) / Receita líquida × 100`

A receita líquida deve descontar taxas, comissões e demais despesas atribuíveis à venda que o sistema consiga comprovar. O custo total deve seguir a regra contábil definida pela empresa.

Se o sistema conhecer apenas custo cadastrado e preço de venda, deve mostrar **margem bruta simplificada**, não margem líquida. Custos desconhecidos devem ser indicados como ausentes, não presumidos como zero.

A regra original permanece: preço abaixo do custo gera alerta crítico, mas não bloqueia automaticamente a publicação.

### 5.6 Reprocessamento seguro

Cada tentativa deve ter identificador único, produto, canal, tipo de operação, estado, horário, duração, resultado e motivo da falha.

Estados sugeridos:

- Na fila.
- Em processamento.
- Aguardando aprovação.
- Concluído.
- Concluído parcialmente.
- Falhou.
- Bloqueado por regra de negócio.
- Cancelado.

Não repetir cegamente uma publicação após timeout: o canal pode ter recebido a solicitação mesmo que a resposta não tenha chegado ao HUB.

O APE deve preservar a atomicidade lógica e impedir efeitos duplicados, com idempotência, verificação do estado remoto e reconciliação. O WIG deve tratar webhooks duplicados, sem confundir deduplicação de eventos com garantia de execução exatamente uma vez.

### 5.7 Auditoria e aprovação

O histórico deve responder:

1. O que mudou?
2. Qual era o valor anterior?
3. Qual é o valor novo ou proposto?
4. Quem ou qual processo originou a alteração?
5. Qual foi o resultado?

Para NCM, exigir dois aprovadores distintos, com identidade, data, decisão e justificativa. O autor da solicitação não pode contar como os dois aprovadores.

Para EAN, o valor obtido no marketplace deve permanecer como sugestão até aprovação humana.

Separar permissões de operador, revisor fiscal, responsável financeiro e administrador. Ações críticas exigem permissões específicas, confirmação explícita e registro de auditoria.

## 6. Evolução dos dez motores

| Motor | Evolução proposta |
|---|---|
| **PIRE** | Mostrar confiança do vínculo, candidatos alternativos e motivo da correspondência. |
| **VIR** | Exibir árvore de variações, produto pai, filhos, atributos e conflitos de SKU. |
| **GVE** | Separar EAN ausente, inválido, duplicado, divergente e aguardando aprovação. |
| **NVE** | Mostrar divergências, motivo do bloqueio e fluxo de dupla aprovação. |
| **CQS** | Apresentar notas por campo, problemas detectados e sugestões editáveis. |
| **IQRE** | Exibir imagens duplicadas, origem, validade, seleção e pendências de direitos. |
| **CRE** | Explicar as três notas por canal, critérios, pesos, data e fatores que reduzem a prontidão. |
| **APE** | Registrar cada etapa de publicação, confirmação remota, tentativas e falhas parciais. |
| **WIG** | Expor eventos duplicados descartados, eventos processados e falhas de deduplicação. |
| **DLM** | Mostrar políticas de retenção, registros arquivados, execução de limpeza e auditoria. |

O CRE deve ser apresentado como nota de prontidão, não como autorização universal para publicar. Um produto com nota alta ainda pode ter bloqueio fiscal. Regras obrigatórias prevalecem sobre qualquer score agregado.

Cada motor deve entregar uma estrutura consistente para a interface:

- Resultado e estado.
- Explicação operacional.
- Evidências usadas.
- Regra aplicada.
- Campos ou produtos afetados.
- Próxima ação recomendada.
- Indicação de ação automática ou aprovação necessária.
- Histórico e identificador da execução.

## 7. Arquitetura operacional

Fluxo recomendado:

1. **Fontes:** Bling, Mercado Livre e Nuvemshop.
2. **Coleta e normalização:** webhooks, consultas, validação e reconciliação.
3. **Motores e regras:** PIRE/VIR, GVE/NVE, CQS/IQRE, CRE, APE/WIG/DLM.
4. **Fila de operações e aprovações:** pendências, bloqueios, decisões e tentativas.
5. **Dashboard:** métricas consistentes, ações e rastreabilidade.

O dashboard deve consumir uma camada consolidada de estado operacional. Evitar que cada cartão calcule os próprios indicadores de forma independente.

### Controles técnicos essenciais

- Timestamp e fonte para cada indicador.
- Reconciliação do estado conhecido no HUB com o estado consultável nas plataformas.
- Webhooks idempotentes e rotina de recuperação de eventos perdidos.
- Fila de requisições, backoff, tratamento de `429` e monitoramento por canal.
- Logs estruturados, métricas e identificadores de correlação.
- Separação entre estado confirmado, estimado, desconhecido e desatualizado.
- Tokens OAuth protegidos, controle de acesso e logs sem segredos.
- Retenção e recuperação de registros fiscais conforme a política do projeto.

A documentação oficial deve ser conferida durante a implementação. A estratégia deve considerar OAuth 2.0, webhooks e limites de API do Bling, os limites específicos da Nuvemshop e as regras vigentes de publicação do Mercado Livre, incluindo User Products quando aplicável.

## 8. Roadmap de implementação

### Fase 0 — Auditoria

- Inventariar páginas, componentes, APIs, banco de dados, jobs e motores.
- Identificar cálculos dos KPIs.
- Mapear todos os pontos de escrita.
- Mapear conflitos com a integração nativa.
- Criar testes de regressão para fiscal, preço, estoque, Full e variações.
- Preparar backup, homologação e rollback.

**Critério de saída:** baseline validada.

### Fase 1 — UX/UI

- Reorganizar KPIs e navegação.
- Traduzir siglas e padronizar estados.
- Adicionar explicações e links para pendências.
- Melhorar tabelas, filtros, busca e mensagens.
- Implementar estados de carregamento, vazio, erro e dados desatualizados.

**Critério de saída:** interface validada com dados existentes.

### Fase 2 — Operação

- Criar central de pendências.
- Implementar comparação de fontes por campo.
- Criar aprovação de EAN e dupla aprovação de NCM.
- Registrar decisões, justificativas e histórico.

**Critério de saída:** ações rastreáveis e permissões verificadas.

### Fase 3 — Execução

- Criar pré-visualização das alterações.
- Implementar estados por produto e canal.
- Garantir idempotência, concorrência controlada e reconciliação.
- Melhorar reprocessamento, logs e detecção de conflitos.

**Critério de saída:** testes de falhas e duplicidades aprovados.

### Fase 4 — Gestão

- Criar painel de margem e alertas de preço.
- Monitorar saúde, latência e limites das APIs.
- Criar relatórios de qualidade por canal.
- Criar alertas configuráveis e resumos de falhas recorrentes.

**Critério de saída:** indicadores conciliados com as fontes.

## 9. Indicadores administrativos

| Indicador | Definição |
|---|---|
| Cobertura de correspondência | Percentual de produtos com vínculo confirmado por canal |
| Prontidão de publicação | Produtos que atendem aos requisitos aplicáveis |
| Pendências vencidas | Itens que ultrapassaram o prazo configurado |
| Taxa de sucesso | Operações confirmadas com sucesso em relação às operações elegíveis tentadas |
| Falhas por canal | Frequência e tipo de erros em cada integração |
| Tempo médio de resolução | Tempo entre abertura e resolução da pendência |
| Retrabalho | Operações repetidas ou corrigidas |
| Risco de margem | Produtos abaixo da meta ou do custo |
| Atualidade dos dados | Tempo desde a última leitura ou confirmação válida |
| Divergências após sincronização | Diferenças identificadas na reconciliação |

Definir formalmente a fonte, o período e a fórmula de cada indicador. Uma publicação apenas enviada, mas não confirmada, não deve contar como sucesso.

Não definir metas numéricas antes de medir a situação atual.

## 10. Prompt de implementação para Cursor/TRAE

Atue como uma equipe sênior de arquitetura de software, desenvolvimento full-stack, integrações ERP/marketplaces, UX/UI, fiscal, financeiro e QA.

Evolua o projeto existente Bling Sync HUB de forma incremental, mantendo a arquitetura e os componentes funcionais sempre que possível.

Comece auditando o repositório. Mapeie frontend, backend, banco, autenticação, rotas, jobs, APIs, os dez motores e todos os pontos de escrita no Bling, Mercado Livre e Nuvemshop. Documente os cálculos atuais, dependências, riscos e testes.

Não invente endpoints, funções, tabelas ou recursos. Verifique o código e a documentação oficial. Não reescreva a aplicação do zero.

Implemente as fases na ordem: auditoria, UX/UI, central de pendências e ficha do produto, simulação e execução segura, proteção comercial e observabilidade.

Preserve as regras críticas: Bling como fonte de verdade para preço, estoque, custo, SKU e campos fiscais sob sua responsabilidade; aprovação humana de EAN externo; duas aprovações distintas para NCM; bloqueio de publicação por divergência fiscal; auditoria de alterações; retenção fiscal de cinco anos; alerta de preço abaixo do custo sem bloqueio automático; depósitos elegíveis para estoque publicado; Full do Mercado Livre fora do escopo de leitura/escrita; kits como um SKU; respeito à integração nativa.

Toda escrita externa deve exigir validação de permissão e seguir as regras de responsabilidade por canal. Use idempotência, controle de concorrência, reconciliação, backoff e tratamento de timeouts. Não reexecute cegamente uma operação cujo resultado remoto seja desconhecido.

Trabalhe em pequenas etapas. Antes de cada etapa, apresente escopo, arquivos afetados, riscos e critérios de aceite. Depois, implemente, execute testes, revise logs e regressões e documente os resultados. Não declare uma função concluída apenas porque a interface foi criada.

Durante desenvolvimento e homologação, utilize mocks ou sandbox. Não execute publicações reais sem autorização explícita.

Comece exclusivamente pela auditoria e pelo plano detalhado de implementação. Não faça refatoração global antes de mapear e proteger as regras existentes.

### Critérios finais de aceite

- KPIs calculados com dados reais e definições consistentes.
- Pendências com motivo e ação compreensível.
- Comparação de fontes com origem de cada valor.
- Nenhuma sobrescrita indevida de campos protegidos.
- NCM com duas aprovações distintas.
- EAN externo sujeito a aprovação humana.
- Bloqueios fiscais não contornáveis por caminhos alternativos.
- Reprocessamentos sem duplicidades.
- Conflitos com a integração nativa identificados.
- Auditoria completa.
- Interface utilizável por operadores não técnicos.
- Regressões verificadas.

## 11. Critérios de validação com operadores

Validar se o operador consegue:

1. Identificar a pendência mais importante sem conhecer as siglas dos motores.
2. Entender o motivo do bloqueio e o próximo passo sem abrir logs técnicos.
3. Conferir as alterações propostas antes da publicação.
4. Aprovar ou rejeitar uma solicitação fiscal com rastreabilidade.
5. Investigar uma falha ou divergência por meio de registros verificáveis.

Não depender apenas de cores: todos os estados devem ter rótulos textuais e controles acessíveis por teclado.

## 12. Conclusão

A evolução de maior valor para o Bling Sync HUB não é adicionar mais cartões. É garantir que cada produto tenha um estado confiável, cada divergência tenha uma explicação, cada pendência tenha um responsável e cada escrita externa tenha uma trilha verificável.

A prioridade recomendada é auditoria, nova Visão Geral, Central de Pendências e ficha única do produto. Em seguida, avançar para simulação, execução segura, proteção financeira e observabilidade.

Este documento é um plano de evolução funcional e arquitetural. A lista definitiva de arquivos, alterações de banco e tarefas técnicas deve ser fechada após auditoria do repositório.
