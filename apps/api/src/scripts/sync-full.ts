import { runFullCatalogSync } from '../catalog/full-sync.js';
import { loadConnectors } from '../connectors/load.js';
import { activeErpConnector } from '../connectors/strategy/factory.js';
import { getPool } from '../db/pool.js';

async function main(): Promise<void> {
  const startPage = Number(process.argv[2] ?? '1');
  await loadConnectors();
  const report = await runFullCatalogSync(activeErpConnector(), {
    startPage: Number.isFinite(startPage) && startPage > 0 ? startPage : 1,
    skipExisting: true,
    onProgress: (current) => {
      process.stderr.write(
        `pagina=${current.pages} vistos=${current.seen} gravados=${current.upserted} ja_existiam=${current.skippedExisting} falhas=${current.failed}\n`
      );
    },
  });
  process.stdout.write(`${JSON.stringify(report)}\n`);
  await getPool().end();
  if (report.status !== 'done' || (report.upserted === 0 && report.failed > 0)) {
    process.exitCode = 1;
  }
}

main().catch(async (error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  await getPool().end().catch(() => undefined);
  process.exit(1);
});
