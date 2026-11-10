import fs from 'node:fs';
import path from 'node:path';

let pending: Promise<void> | null = null;

/** Carrega cada conector que expõe register.ts, sem o núcleo citar um ERP. */
export function loadConnectors(): Promise<void> {
  if (!pending) {
    const dir = __dirname;
    pending = (async () => {
      for (const name of fs.readdirSync(dir)) {
        const folder = path.join(dir, name);
        if (!fs.statSync(folder).isDirectory()) continue;
        const hasRegister = fs.existsSync(path.join(folder, 'register.ts')) || fs.existsSync(path.join(folder, 'register.js'));
        if (!hasRegister) continue;
        try {
          await import(`./${name}/register.js`);
        } catch {
          await import(`./${name}/register.ts`);
        }
      }
    })();
  }
  return pending;
}
