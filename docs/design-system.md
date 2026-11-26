# JH Sync Hub — design system operacional

## Direção

Workbench de catálogo, estoque e conformidade fiscal para operadores que trabalham com milhares de SKUs. A interface deve tornar prioridade, origem do dado e próxima ação evidentes. O refinamento preserva a identidade mint/creme no claro e espresso/cobre no escuro; não altera permissões, publicação ou soberania do ERP.

## Diagnóstico da revisão

| Antes | Depois | Motivo |
| --- | --- | --- |
| Gradientes e sombras fortes aplicados indiscriminadamente às superfícies | Cards de superfície plana e sombras discretas; overlays têm elevação própria | A informação deve competir menos com os contêineres |
| Ausência de componentes base para controles e overlays | `components/ui/button.tsx`, `overlay.tsx` e `metric-value.tsx` | Centralizar comportamento e evitar deriva por tela |
| Branco sobre cobre `#d97324`: contraste 3,27:1 | Texto espresso sobre cobre nas ações primárias | Texto pequeno exige 4,5:1 em WCAG AA |
| `emerald-200` no toast claro: contraste aproximado 1,25:1 | Texto e ícones semânticos com pares claro/escuro | Feedback precisa ser legível em ambos os temas |
| Badge Shadow com opacidade Tailwind não gerada no modo escuro | Opacidade arbitrária explícita `/[0.12]` | O fundo claro anterior causava contraste inadequado |
| Modais/drawers independentes, sem contrato uniforme de foco | Primitive Dialog do Base UI com portal, fundo inerte, Escape, foco e transições | Comportamento acessível junto ao acabamento visual |
| Toasts removidos abruptamente e timers reiniciados nas atualizações | Sonner por trás da API `ToastMessage` existente | Entrada/saída interrompível e gestão de notificações consolidada |
| Barras com `transition-[width]` de 500ms | Barras com `scaleX` e origem à esquerda | Evitar layout a cada quadro |
| Sidebar com `transition-all` | Mudança de largura instantânea | Não atrasar navegação de alta frequência |
| Sem política global de movimento reduzido | Tratamento de `prefers-reduced-motion` | Remover deslocamento, escala e contadores animados |
| Região de atividade rolável inacessível por teclado no móvel | Região nomeada com `tabIndex=0` | Permitir acesso à tabela sem ponteiro |

Os números de contraste acima são de pares específicos, não uma certificação da aplicação inteira. A varredura estática percorreu `apps/web/src`; a inspeção renderizada e os testes automatizados têm a cobertura delimitada abaixo.

## Tokens e hierarquia

Fonte da verdade: `apps/web/src/app/globals.css`.

| Papel | Claro | Escuro |
| --- | --- | --- |
| Canvas | `241 247 205` | `20 15 10` |
| Superfície | `255 252 242` | `34 28 22` |
| Texto principal | `22 28 16` | `247 243 237` |
| Texto secundário | `55 66 40` | `180 165 147` |
| Acento | `4 120 87` | `217 115 36` |
| Controle inset | `246 248 229` | `24 19 14` |
| Foco | `4 120 87` | `242 166 90` |

- Manter a família sans existente; não baixar fontes externas para obter acabamento.
- H1 de página: 24–28px/700. Título de seção: 14–16px/600–700. Corpo: 14px. Metadados densos: 11–12px. KPI principal: 32px/700, tracking estreito e números tabulares.
- Grid de 4px: separação de seções 24px; padding de cards 20px ou 24px; grupos de controles 8px ou 12px. Micropassos existentes de 2px para badges e alinhamentos ópticos não justificam nova escala de layout.
- Raio: controle 8px, card/modal 16px, pill circular. Evitar sombras em elementos aninhados.
- `Button`: altura 36px, padding 8px/12px, texto 12px/600; 40px mínimo no móvel. Botões legados recebem altura mínima compacta de 32px, foco e feedback compartilhados; não inflar linhas de tabela para 44px por controle.
- Inputs mantêm semântica nativa; foco tem outline de 2px e halo de 3px. No móvel, texto de formulário em 16px evita zoom involuntário.
- Status não depende exclusivamente de cor: manter rótulo e ícone. Vermelho é bloqueio/falha, âmbar é atenção, verde é sucesso/prontidão.

## Movimento

| Token | Valor | Uso |
| --- | --- | --- |
| `--ease-out` | `cubic-bezier(0.23, 1, 0.32, 1)` | Feedback e overlays |
| `--ease-in-out` | `cubic-bezier(0.77, 0, 0.175, 1)` | Movimento entre estados quando necessário |
| `--ease-drawer` | `cubic-bezier(0.32, 0.72, 0, 1)` | Painéis laterais |
| `--duration-press` | 120ms | Pressão e feedback de linha |
| `--duration-fast` | 160ms | Saída, ordenação, revelação curta |
| `--duration-surface` | 220ms | Entrada de overlay e barras |

- Modal: fade + deslocamento de 8px + escala 0,97 → 1. Drawer: fade + deslocamento horizontal de 24px. Saída mais curta; não remover o componente antes de terminar o fechamento solicitado pelo usuário.
- `Overlay` usa Base UI para presença, foco, Escape, portal e isolamento do fundo. `MountedOverlay` adapta telas que montam condicionalmente; seu render prop fornece `close`. Fechamentos externos após salvar/navegar podem desmontar imediatamente; não atrasar confirmação de ações de negócio para preservar animação.
- Toast: Sonner com no máximo três visíveis, espaçamento 8px e margens responsivas de 16px. Mensagens com ação ou razões persistem até dispensa. Sem barra de progresso decorativa.
- KPIs da Home: count-up de 220ms apenas na primeira carga bem-sucedida; atualizações posteriores são imediatas. Leitores de tela recebem o valor final, não a sequência intermediária. Sem count-up em tabelas ou dados fiscais.
- Barras: `transform: scaleX(ratio)`, não `width` animado. Score circular muda imediatamente em vez de animar o traço SVG.
- Expansões de Problemas e conteúdo da aba da ficha: fade de 160ms, sem interpolação de altura. Navegação por teclado e movimento reduzido não recebem essa animação.
- Hover não desloca linhas ou cards. Não há stagger em listas operacionais, bounce, ping contínuo ou `will-change` permanente.
- Movimento reduzido: contagem imediata, sem escala/deslocamento de overlays, botões, barras e toasts; preservar fade discreto onde auxilia compreensão. Hover de movimento exige ponteiro fino; controles não dependem de hover para serem descobertos.

## Cobertura e validação

- Regras globais de superfície, tipografia, foco, controles, tabelas e movimento reduzido afetam todas as rotas.
- Overlays encontrados na varredura foram migrados em Catálogo, Matching, Problemas, Fiscal NCM, Atributos, Canais, Vínculos, Importações, Auditoria, Integrações e Usuários.
- Os testes de navegador usam dados fictícios e uma API de sessão exclusivamente local nas portas 3100/3101. Não acessam a produção, não habilitam publicação e não alteram autenticação da aplicação.
- Playwright cobre Home nos dois temas em 390px/1440px, links filtrados, geometria, erros de JavaScript, foco contido, Escape, reabertura e retorno de foco do modal de Canais, movimento reduzido e toast móvel. Axe verifica WCAG A/AA nos cenários de Home.
- Essa cobertura não substitui avaliação manual de leitor de tela, dispositivos físicos, todos os estados com dados reais ou perfil de performance de uma sessão de operação longa. Não declarar certificação WCAG global nem garantia de 60fps com base somente nos testes.

Comandos na raiz:

```sh
npm run typecheck
npm test
npm run build
npm --workspace=@bling-sync/web exec playwright install chromium
npm --workspace=@bling-sync/web run test:ui
```

Executar build e testes de navegador em sequência: o Next compartilha `.next` e dois processos simultâneos podem disputar artefatos no Windows. As screenshots e traces ficam em `apps/web/test-results/`, ignorado pelo Git. Dependências do refinamento: Base UI 1.0.0, Sonner 2.0.3; Playwright e axe apenas em desenvolvimento. Alertas de segurança das dependências existentes exigem uma atualização separada, não `npm audit fix --force` durante trabalho visual.
