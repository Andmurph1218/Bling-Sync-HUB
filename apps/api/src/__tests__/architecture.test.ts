import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(__dirname, '..');

function importsFolder(folder: string): RegExp {
  return new RegExp(`(?:from\\s+|import\\s*\\(\\s*)['"][^'"]*connectors\\/${folder}(?:\\/|['"])`);
}

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) {
      if (name === 'node_modules' || name === 'dist') continue;
      found.push(...sourceFiles(full));
    } else if (name.endsWith('.ts')) {
      found.push(full);
    }
  }
  return found;
}

function productionFiles(): Array<{ relative: string; text: string }> {
  return sourceFiles(SRC)
    .map((file) => path.relative(SRC, file).replace(/\\/g, '/'))
    .filter((relative) => !relative.startsWith('__tests__/') && !relative.startsWith('scripts/'))
    .map((relative) => ({ relative, text: fs.readFileSync(path.join(SRC, relative), 'utf8') }));
}

/**
 * Quem pode importar cada pasta de fornecedor. A fábrica registra os canais.
 * As demais entradas são dívida conhecida: a classe HTTP legada e as rotas de
 * OAuth/credenciais ainda chamam a Nuvemshop direto.
 */
const VENDOR_ALLOWLIST: Record<string, string[]> = {
  bling: [],
  nuvemshop: [
    'connectors/strategy/factory.ts',
    'connectors/connectors.ts',
    'routes/oauth.ts',
    'routes/app-credentials.ts',
  ],
  shopee: ['connectors/strategy/factory.ts'],
};

const CORE_DIRS = ['catalog/', 'queues/', 'engines/', 'orchestrator/', 'services/'];

describe('isolamento dos conectores', () => {
  for (const [vendor, allowed] of Object.entries(VENDOR_ALLOWLIST)) {
    it(`nenhum arquivo fora de connectors/${vendor} importa essa pasta, salvo a allowlist`, () => {
      const pattern = importsFolder(vendor);
      const offenders = productionFiles()
        .filter(({ relative }) => !relative.startsWith(`connectors/${vendor}/`))
        .filter(({ relative }) => !allowed.includes(relative))
        .filter(({ text }) => pattern.test(text))
        .map(({ relative }) => relative);
      expect(offenders).toEqual([]);
    });
  }

  it('o núcleo (catálogo, filas, motores, orquestrador e serviços) não importa nenhum fornecedor', () => {
    const patterns = Object.keys(VENDOR_ALLOWLIST).map(importsFolder);
    const offenders = productionFiles()
      .filter(({ relative }) => CORE_DIRS.some((dir) => relative.startsWith(dir)))
      .filter(({ text }) => patterns.some((pattern) => pattern.test(text)))
      .map(({ relative }) => relative);
    expect(offenders).toEqual([]);
  });

  it('connectors/strategy não guarda código da Nuvemshop', () => {
    const leftovers = fs
      .readdirSync(path.join(SRC, 'connectors/strategy'))
      .filter((name) => name.toLowerCase().includes('nuvemshop'));
    expect(leftovers).toEqual([]);
  });
});
