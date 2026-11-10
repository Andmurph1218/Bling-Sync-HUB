/** Impede que a senha curta de desenvolvimento seja gravada fora da máquina local. */
export function assertDevSeedAllowed(nodeEnv: string, databaseUrl: string): void {
  if (nodeEnv !== 'development') {
    throw new Error('seed:admin só roda com NODE_ENV=development.');
  }
  let host = '';
  try {
    host = new URL(databaseUrl).hostname;
  } catch {
    host = '';
  }
  if (host !== 'localhost' && host !== '127.0.0.1') {
    throw new Error('seed:admin só altera o Postgres em localhost.');
  }
}
