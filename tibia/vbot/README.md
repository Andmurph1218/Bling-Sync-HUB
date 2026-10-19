# Full Macro EK — vBot 4.8, Aurera Global

Script unico para Elite Knight. Cole `Full_Macro_EK.lua` no editor de scripts do vBot 4.8.

O arquivo antigo juntava varios macros soltos. Dois deles castavam ao mesmo tempo, a cura de joia nunca voltava para o item normal, e uma das spells nao existe.

## Painel

| Grupo | Macro | Funcao |
|---|---|---|
| Combate | EK Hunt | Rotacao de box: `exori gran ico`, `exori gran`, `exori min`, `exori mas`, `exori` |
| Combate | Exeta Res | `exeta res` com pelo menos 2 monstros a 1 sqm. Sai antes do exori, intervalo de 4s |
| Combate | Exeta Amp | `exeta amp res` com monstro em ate 7 sqm. Intervalo de 4s, na folga do ataque |
| Combate | Anti Paralyze | Ligado e paralizado, solta `utani hur` |
| Cura | EK Heal | `exura gran ico` em 45%, `exura med ico` a partir do level 300, senao `exura ico` |
| Cura | Supreme HP | Supreme Health Potion `23375` em 80% de HP |
| Cura | Mana Potion | Great Mana Potion `238` em 50% de mana. Divide o exhaust de 1s com a de vida |
| Util | Puxar Trash | Desligado ao colar. Puxa um item pegavel dos 8 sqm para o pe, a cada 600 ms |
| Util | Stack items | Junta pilhas iguais nas backpacks abertas, uma por segundo. Ignora corpo de monstro |
| Util | Anti Push | Solta worm `3492`, banana `3590` ou gold coin `3031` no pe ate 5 things |
| Joias | Amuleto / anel | SSA `3081` em 75% e Might Ring `3048` em 70%. O slot da direita e o item padrao |

O icone HUNT fica na tela. Support (paralise e challenge) sai pelo mesmo ciclo do combate, uma fala por vez.

## O que saiu

- EK PVP e EK Safe AoE. A rotacao e so hunt em monstro.
- Tabela de spells duplicada tres vezes.
- `exeta mas res`. Knight nao tem essa spell.
- Macro de `exeta amp res` sem monstro e sem cooldown, mais outro de RES a cada 500 ms.
- Auto SSA e Auto Might com `hppercent() <= 100`.
- Follow em `"Player2"`.
- Virar para o alvo a cada 1 ms com o combat desligado.
- `Groovebeast` (correto: Grovebeast).

## Correcoes de comportamento

- Attack, healing e support respeitam o grupo de cooldown do client (`1`, `2`, `3`).
- `exori gran ico` e `exori min` so saem se o alvo esta no sqm da frente.
- Exeta Res e Exeta Amp sao botoes separados. O challenge tenta antes do exori; `talkGap` e o grupo support seguram a rotacao.
- O painel de joias usa `parent or panel` no editor do vBot.
- Item padrao `0` nao e equipado.

Numeros de mana do fallback vieram do balanceamento de vocacoes do Aurera: exori 125, exori gran 360, exori mas 200. Se o `SpellInfo` do client tiver outro custo, o client ganha. `utito tempo` nao entra na rotacao.

Desligue o caster do AttackBot enquanto este script estiver ligado.
