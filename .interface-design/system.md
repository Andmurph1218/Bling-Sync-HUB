# JH Sync Hub — Interface Design System

## 1. Direction & Feel
- **Operational Workbench with Dual Atmospheric Modes:** Built for catalog, inventory, and fiscal operators managing thousands of SKUs across ERP (Bling) and marketplaces (Nuvemshop, Mercado Livre).
- **Light Mode (Preserved Botanical Mint):** Fresh, daylight-legible mint/cream surfaces (`#f8fce6` → `#e4f0bc`), olive-tinted borders (`rgb(138 158 96)`), deep forest ink (`rgb(22 28 16)`), and emerald primary actions (`#047857`). Never alter or regress light-mode colors.
- **Dark Mode (*Espresso Obsidian & Burnt Copper*):** Warm espresso-black canvas (`#140f0a` with subtle warm radial ambient glow), diagonal bevelled dark-bronze cards, crisp ivory hero typography (`#f7f3ed`), warm taupe metadata (`#a29280`), burnt copper primary accents (`#d97324`), and warm cream secondary data bars (`#f5dbb6`).

## 2. Tokens (`apps/web/src/app/globals.css`)
| Token | Light (`:root`) | Dark (`.dark`) | Role |
|---|---|---|---|
| `--bg-base` | `241 247 205` | `20 15 10` (`#140f0a`) | Page canvas & inset backgrounds |
| `--bg-surface` | `255 252 242` | `34 28 22` (`#221c16`) | Card & elevated container fill |
| `--border-color` | `138 158 96` | `96 80 62` (`rgba(255,232,202,0.12)` on cards) | Structural hairlines |
| `--text-primary` | `22 28 16` | `247 243 237` (`#f7f3ed`) | Headings, hero KPIs, primary values |
| `--text-muted` | `55 66 40` | `162 146 128` (`#a29280`) | Supporting labels, captions, timestamps |
| `--accent-copper` | `5 150 105` | `217 115 36` (`#d97324`) | Primary CTA, active badges, focal bar |
| `--accent-cream` | `220 238 182` | `245 219 182` (`#f5dbb6`) | Secondary chart columns in dark mode |

## 3. Depth, Surfaces & Spacing
- **Depth Strategy:** Specular 1px bevelled ring + soft ambient drop shadow on cards (`.bg-bg-surface` in `.dark`: `148deg` warm diagonal gradient + `inset 0 1px 0 rgba(255,246,232,0.14)` + `0 18px 38px -18px rgba(0,0,0,0.78)`).
- **Sidebar (`.craft-sidebar`):** Cohesive with canvas (`#16110b` in dark) separated by a `rgba(255,228,196,0.08)` hairline rather than a competing hue.
- **Inputs & Controls:** Recessed darker fill in dark mode (`#140f0a` + `inset 0 1px 2px rgba(0,0,0,0.5)`) to signal editable fields.
- **Spacing Grid & Concentric Radius:**
  - Base unit: `4px` (`gap-2.5` / `gap-4` / `gap-5`, card padding `20px–24px` / `p-5`–`p-6`).
  - Outer cards & popovers: `rounded-2xl` (`16px`).
  - Nested icon squircles, nav items & inner rows: `rounded-xl` (`12px`).
  - Topbar status capsules, user chip & primary triggers: `rounded-full`.

## 4. Hierarchy & Typography
- **Hero Metrics:** `32px` (`text-[32px] leading-none font-bold tracking-tight tabular-nums`) in `--text-primary`. Every dynamic count, price, score, and timestamp uses `tabular-nums`.
- **Section Titles:** `16px` (`text-base font-bold tracking-tight`) paired with `12px` (`text-xs text-text-muted`) subtitle.
- **Semantic Accents on Dark:** Burnt copper `#d97324` / `#f29a4b` (actions & attention), serene sky `#5ea4e6` (catalog/network), soft emerald `#3ecf74` / `#52dc86` (connected/healthy deltas).

## 5. Key Component Patterns
- **KPI Card (`HomePage`):** `rounded-2xl border bg-bg-surface p-5` · top row: `40×40px` (`h-10 w-10 rounded-xl`) tinted icon squircle left + `12px` contextual delta right · `mt-5` `32px` tabular hero value · `mt-2` `12px` muted label.
- **Sidebar Active Item (`.craft-nav-active`):** `rounded-xl border px-3 py-2 text-xs font-semibold` · warm horizontal copper wash (`rgba(217,115,36,0.18)` → `rgba(255,232,202,0.06)`) with `#f29a4b` icon in dark mode.
- **Topbar Capsule (`.craft-pill`):** `rounded-full border px-3 py-1 text-xs` with status dot (`h-2 w-2 rounded-full`), provider name, and subtle inner state pill.
- **Stage Column Chart:** 7-column flex-end bar grid (`h-44`), secondary bars in `#f5dbb6` (dark) / `bg-emerald-900/20` (light), focal channel bar highlighted in `#d97324` (dark) / `bg-emerald-700` (light). *Substituído na Home pelo Funil de Cobertura (§6.3).*

## 6. Padrões registrados em 16/11/2026

Componentes em `apps/web/src/components/home/cockpit.tsx` e `apps/web/src/components/product-readiness.tsx`.

### 6.1 Cockpit Card (Home)
- `rounded-2xl border border-border-color bg-bg-surface p-5`, coluna flex com `mt-4` no corpo e `flex-1` para alinhar o rodapé.
- Cabeçalho: label `11px/600 uppercase tracking-wider text-text-muted` + ícone `h-3.5 w-3.5`; à direita, `aside` opcional em `11px`.
- Valor: `32px/700 leading-none tracking-tight tabular-nums text-text-primary`. Rodapé separado por `border-t border-border-color/60 pt-3`.
- Substitui o KPI Card com ícone em squircle de 40px na Home.

### 6.2 Lista de pendências clicável
- Cada linha é um `<Link>` com `-mx-2 px-2 py-1.5 rounded-lg`, hover `bg-bg-base` (`dark:bg-white/[0.05]`), dot de severidade `h-1.5 w-1.5 rounded-full` (rose = bloqueio, amber = aviso), label `12px` truncado, contagem `14px/700 tabular-nums` e `ArrowUpRight` 14px que só aparece no hover/focus.
- Linhas com contagem zero não renderizam. Tudo zerado vira uma linha verde com `CheckCircle2`.

### 6.3 Funil de Cobertura (Home)
- Lista ordenada de etapas, `space-y-3.5`. Cada etapa: label `12px/600` + valor `14px/700` + porcentagem `11px` alinhada à direita (`w-9 text-right`).
- Trilho `h-2 rounded-full bg-bg-base` (`dark:bg-white/[0.06]`); preenchimento `rounded-full` com `transition-[width] duration-500 ease-out`, largura mínima 1,5% quando há valor.
- Cores por papel: base `text-primary/20` · etapa `text-primary/35` (`dark:#f5dbb6/70`) · gargalo `rose-500/80` + selo `Maior gargalo` (10px uppercase, borda rose) · final `emerald-600` (`dark:#3ecf74`).
- Abaixo da barra: `−N <o que falta>` em `11px text-text-muted`. Só a maior perda entre as etapas não finais recebe o selo.

### 6.4 Selo de resultado (atividade)
- `inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold` + ícone `h-3 w-3`.
- Sucesso `emerald-600/30 + emerald-500/10` · Erro `rose-500/40 + rose-500/10` · Na fila `amber-500/40 + amber-500/10` · Sem alteração `border-color + bg-bg-base` com texto muted.
- Ícone por evento em quadrado `h-6 w-6 rounded-lg border bg-bg-base` (`dark:bg-white/[0.04]`): criado `PackagePlus` (emerald), editado `PencilLine` (copper), removido `PackageMinus` (rose), estoque `Warehouse` (sky), preço `BadgeDollarSign` (emerald), falha `XCircle` (rose).

### 6.5 Score Ring + Readiness Hero Card (ficha do produto)
- Anel SVG `88px` (`viewBox 0 0 36 36`, raio `15.5`, `strokeWidth 3`, `strokeLinecap round`, `-rotate-90`), trilho `stroke-border-color/60`, progresso com `transition-[stroke-dasharray] duration-500 ease-out`.
- Centro: nota `20px/700 tabular-nums` + `/100` em `9px uppercase tracking-wider`.
- Faixas: `> 80` emerald · `50–80` amber · `< 50` rose · sem nota `text-muted` com `—`.
- Card: `rounded-2xl border bg-bg-surface p-5`, título `11px uppercase tracking-wider`, subtítulo `14px/700` na cor da faixa, rodapé `border-t` com o contexto do canal.

### 6.6 Badge de checklist e linha de bloqueio
- Badge: `rounded-full border px-2.5 py-1 text-[11px] font-medium` + ícone `h-3.5 w-3.5`; ok emerald, bloqueio rose, aviso amber; quando pendente é `<Link>` para o local da correção com `ArrowUpRight`.
- Linha de bloqueio: `rounded-xl border bg-bg-base/60 px-3 py-2.5`, ícone `XCircle` (rose) ou `AlertCircle` (amber), ação à direita em botão `11px/600` com borda que vira `accent-copper` no hover.
- Pendência nunca repete: o payload já chega deduplicado por título.

### 6.7 Aba com sublinhado
- `-mb-px rounded-t-lg border-b-2 px-3.5 pb-2.5 pt-2 text-xs font-semibold`; ativa `border-accent-copper text-text-primary`, inativa `border-transparent text-text-muted hover:border-border-color`.
- Container `flex flex-wrap gap-1 border-b border-border-color`; botão ativo recebe `aria-current="page"`.

### 6.8 Botão dividido com menu de ações
- Grupo `flex items-stretch`: botão principal `rounded-l-lg` e gatilho de engrenagem `rounded-r-lg border-l-0 px-2` (`Settings2` 14px). Ambos desabilitam juntos durante a ação e o cooldown.
- Menu `absolute right-0 top-full z-20 mt-1.5 w-72 rounded-xl border bg-bg-surface p-1.5 shadow-xl`, itens `flex gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-bg-base` com título `12px/600` e descrição `11px text-text-muted`.
- Fecha com Escape e clique fora; `aria-haspopup="menu"`, `aria-expanded`, `role="menu"`/`menuitem`.
- Cooldown: rótulo `Aguarde Ns` com contador de 1 s, ação bloqueada.

### 6.9 Cabeçalho ordenável de tabela
- Botão `-mx-2 -my-1.5 flex w-full items-center gap-1 px-2 py-1.5 text-left uppercase tracking-wider`, herdando a densidade do `<th>`.
- Ícone `12px strokeWidth 2.5`: `ArrowUpDown` muted/40 quando inativo, `ArrowUp`/`ArrowDown` em `accent-copper` quando ativo; `aria-sort` no `<th>`.

### 6.10 Toast neutro
- Variante `neutral` para "nada mudou": `border-border-color bg-bg-surface/95 text-text-muted` com ícone `Info`. Sucesso e aviso mantêm emerald/amber.

## 7. Checks rápidos
- **Swap:** trocar `bg-bg-surface` por branco/preto puro quebra o bevel do dark e a leitura do claro — o token é obrigatório.
- **Squint:** na Home, o que deve saltar é o selo de gargalo e o verde de "prontos"; o resto é estrutura.
- **Signature:** dot de severidade nas pendências, selo "Maior gargalo", anel de nota, `−N` abaixo das barras, aba com sublinhado copper.
- **Token:** qualquer cor nova precisa existir como par claro/escuro (`text-amber-700 dark:text-amber-300`), nunca só uma metade.
