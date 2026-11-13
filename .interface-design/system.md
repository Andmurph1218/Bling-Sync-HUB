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
- **Stage Column Chart:** 7-column flex-end bar grid (`h-44`), secondary bars in `#f5dbb6` (dark) / `bg-emerald-900/20` (light), focal channel bar highlighted in `#d97324` (dark) / `bg-emerald-700` (light).
