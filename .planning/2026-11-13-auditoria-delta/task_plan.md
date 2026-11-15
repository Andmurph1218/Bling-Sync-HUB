# Task Plan: Auditoria Delta Final de Go-Live (JH Sync Hub)

## Goal

Produzir um relatório de auditoria final delta que valide com evidência de código cada item de
`docs/auditoria-go-live.md`, identifique novos bugs/regressões críticos introduzidos pelas correções
(P0/P1, imagens/S3) e emita veredito Go/No-Go para `ENABLE_LIVE_PUBLISHING=true`.

## Next Step

Tarefa concluída. Relatório entregue em `docs/auditoria-delta-go-live-2026-11-13.md` com veredito **NO-GO**.

## Current Phase

Phase 6 — concluída.

## Phases

### Phase 1: Baseline e inventário

- [x] Ler `docs/auditoria-go-live.md`
- [x] Mapear árvore de código da API/web e as 33 migrations
- [x] Registrar baseline de testes: 51 arquivos / 185 testes, exit 0; typecheck exit 0
- **Status:** complete

### Phase 2: Validação dos itens P0

- [x] P0-1 estoque publicável — ✅
- [x] P0-2 bloqueio de duplicidade — ⚠️ (`sugerido` não bloqueia)
- [x] P0-3 NCM/imagem pendentes — ✅
- [x] P0-4 cadastro rápido — ✅
- **Status:** complete

### Phase 3: Validação dos itens P1 e P2

- [x] P1-1 a P1-10 classificados com arquivo:linha
- [x] P2.1–P2.8, Etapa 3 e Etapa 4 classificados
- **Status:** complete

### Phase 4: Caça a novos bugs e regressões

- [x] `/api/media/:sha256` — regex 64 hex + `path.join`, traversal bloqueado
- [x] `iqre.ts` — allowlist ampla demais para `bling/erp/nuvemshop` (P1-D1)
- [x] `enrichment-worker.ts` — escrita transacional, recálculo fora da transação (P1-D2)
- [x] Webhook x Full Sync — watermark protege preço/estoque; metadados ainda sobrescrevem (P1-D12)
- [x] Idempotência do publicador — `sugerido` + concorrência geram duplicata/órfão (P0-D2/D3)
- **Status:** complete

### Phase 5: Testes de caos (análise estática)

- [x] Bling 500: retoma página; falha por produto não retenta
- [x] Nuvemshop 429: DLQ após 5 tentativas, sem loop
- [x] Redis 30 s: catálogo continua; `/health` pode pendurar; limites degradam
- [x] Hash duplicado: dedupe só por URL e intra-produto; sem unique em sha256
- **Status:** complete

### Phase 6: Relatório final e veredito

- [x] Tabela de status da auditoria anterior
- [x] 4 P0 novos com arquivo:linha e prova
- [x] 14 dívidas P1
- [x] Checklist pré-flag e critérios de aceite
- [x] Veredito NO-GO
- **Status:** complete

## Key Questions

1. Alguma correção P0 foi implementada só no checklist e não no worker? → Sim, o gap é `sugerido`.
2. O hash do `/api/media` é validado? → Sim, regex 64 hex antes de tocar o disco.
3. O worker grava `listing_id` fora da transação do POST? → Grava em transação, mas não serializa POSTs concorrentes.
4. Full Sync e webhook compartilham marca d'água? → Compartilham para preço/estoque, não para metadados.

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| Plano em `.planning/2026-11-13-auditoria-delta/` | Helpers `.ps1` bloqueados por ExecutionPolicy; template replicado manualmente |
| Auditoria somente leitura | Pedido do usuário; nenhum arquivo de aplicação alterado |
| Veredito NO-GO | P0-D1 quebra o Full Sync com imagens; P0-D2/D3 geram duplicata; P0-D4 publica anúncio incompleto |

## Errors Encountered

| Error | Attempt | Resolution |
|-------|---------|------------|
| `set-active-plan.ps1` bloqueado por ExecutionPolicy | 1 | Estrutura do template replicada manualmente |
| `rg` não instalado no PowerShell | 1 | Uso de `grep`/`Get-ChildItem` |
| `npm test` via pipe reportou exit 1 | 1 | Reexecutado com redirecionamento `*>`: exit 0, 185/185 |

## Notes

- Nenhum arquivo de aplicação foi modificado.
- Relatório final: `docs/auditoria-delta-go-live-2026-11-13.md`.
