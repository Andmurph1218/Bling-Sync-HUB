import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(__dirname, '..');
const IMPORT_FROM_BLING = /(?:from\s+|import\s*\(\s*)['"][^'"]*connectors\/bling(?:\/|['"])/;

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

describe('isolamento do conector Bling', () => {
  it('nenhum arquivo fora de connectors/bling importa essa pasta', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const relative = path.relative(SRC, file).replace(/\\/g, '/');
      if (relative.startsWith('connectors/bling/')) continue;
      if (relative.startsWith('__tests__/')) continue;
      if (relative.startsWith('scripts/')) continue;
      const text = fs.readFileSync(file, 'utf8');
      if (IMPORT_FROM_BLING.test(text)) offenders.push(relative);
    }
    expect(offenders).toEqual([]);
  });
});
