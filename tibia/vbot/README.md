# Full Macro EK — vBot 4.8, Aurera Global

Script unico para Elite Knight. Cole `Full_Macro_EK.lua` no editor de scripts do vBot 4.8.

O arquivo antigo juntava varios macros soltos. Dois deles castavam ao mesmo tempo, a cura de joia nunca voltava para o item normal, e uma das spells nao existe.

## O que ficou

| Macro | Funcao |
|---|---|
| EK Hunt | Rotacao de box: `exori gran ico`, `exori gran`, `exori min`, `exori mas`, `exori` |
| EK PVP | Mesmo alvo corpo a corpo, sem esperar contagem de monstro. Em player, prioriza single target |
| EK Safe AoE | Nao solta area se tiver jogador fora da party no alcance. O alvo atacado nao entra nessa conta |
| Exeta | `exeta res` com mais de 2 monstros a 1 sqm. Senao, `exeta amp res` com monstro em ate 7 sqm. Nao solta em player. Intervalo de 4s, na folga do ataque |
| Anti Paralyze | So o botao. Ligado e paralizado, solta `utani hur` |
| Supreme HP | Supreme Health Potion `23375` em 80% de HP |
| Mana Potion | Great Mana Potion `238` em 50% de mana. Divide o exhaust de 1s com a de vida; vida tem prioridade |
| Stack items | Junta pilhas iguais nas backpacks abertas, uma por segundo. Ignora corpo de monstro |
| Puxar Trash | Desligado ao colar. Puxa um item pegavel dos 8 sqm para o pe, a cada 600 ms |
| Anti Push | Solta worm `3492`, banana `3590` ou gold coin `3031` no pe ate 5 things. Um drop a cada 100 ms, tambem ao andar |
| EK Heal | `exura gran ico` em 45%, `exura med ico` a partir do level 300, senao `exura ico` |
| Amuleto / anel | SSA `3081` em 75% e Might Ring `3048` em 70%. O slot da direita e o item padrao |

Os dois icones continuam na tela: HUNT e PVP. Os dois podem ficar ligados. Monstro usa a rotacao de hunt; player usa a de PVP. Support (paralise e challenge) sai pelo mesmo ciclo, uma fala por vez.

## O que saiu

- Tabela de spells duplicada tres vezes. A de PVP e a de hunt nao compartilhavam estado, e a terceira nao era lida.
- `exeta mas res`. Knight nao tem essa spell. Challenge valido: `exeta res` ou `exeta amp res`.
- Macro de `exeta amp res` sem monstro e sem cooldown, mais outro de RES a cada 500 ms.
- Auto SSA e Auto Might. A condicao era `hppercent() <= 100`, entao o item de emergencia entrava sempre e o retorno (`>= 101`) nunca rodava. `null` nao existe em Lua.
- Follow em `"Player2"`. Nome preso no codigo. O CaveBot ja cobre o caminho.
- Virar para o alvo a cada 1 ms, mesmo com o combat desligado. Agora so vira com Hunt ou PVP ligado, e no maximo a cada ciclo de 100 ms.
- `Groovebeast`. O familiar do druid e Grovebeast. `getMonsters` do vBot ja ignora summon com `getType() >= 3`; a lista de familiares cobre OT que marca familiar como monstro normal.

## Correcoes de comportamento

- Attack, healing e support respeitam o grupo de cooldown do client (`1`, `2`, `3`). O script antigo dava `say` em todas as spells a cada 500 ms e tomava exhaust.
- `exori gran ico` e `exori min` so saem se o alvo esta no sqm da frente. Em diagonal a spell nao acerta. Se o personagem virou neste ciclo, a spell direcional espera o proximo.
- Exeta e Anti Paralyze sao so os botoes. Com mais de 2 monstros colados sai `exeta res`; com monstro ate 7 sqm sai `exeta amp res`. O challenge espera 4s e nao fala na segunda metade do cooldown de ataque, para o proximo exori sair na hora.
- O painel de joias lia `ringEnabled`, mas gravava `ringSwitch`. O switch nascia desligado. A comparacao de HP estava com `and`/`or` invertido na precedencia: sem amuleto, equipava o de emergencia mesmo com HP cheio. No editor do vBot `parent` vem vazio; a aba corrente e `panel`.
- Item padrao `0` nao e equipado. Arraste o anel de skill e o amuleto de hunt para o slot da direita. O da esquerda e o de emergencia (Might e SSA).
- `10476` (Lucky Clover em alguns OT) e `34080` (nao e anel de Tibia) deixaram de ser padrao. Se o storage antigo ja tiver esses ids, eles sao mantidos.

Numeros de mana do fallback vieram do balanceamento de vocacoes do Aurera: exori 125, exori gran 360, exori mas 200. Se o `SpellInfo` do client tiver outro custo, o client ganha. `utito tempo` nao entra na rotacao.

Desligue o caster do AttackBot enquanto este script estiver ligado.
