import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

export interface DbPoolLike {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[]
  ): Promise<QueryResult<R>>;
  connect(): Promise<PoolClient>;
  end(): Promise<void>;
}

let activePool: DbPoolLike | null = null;

export function getPool(): DbPoolLike {
  if (!activePool) {
    const pool = new Pool({
      connectionString: env.DATABASE_URL,
      max: 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
    pool.on('error', (err: Error) => {
      logger.error('Erro inesperado no pool do PostgreSQL', { error: err.message });
    });
    activePool = pool;
  }
  return activePool;
}

export function setPool(customPool: DbPoolLike | null): void {
  if (!customPool) {
    activePool = null;
    return;
  }
  const normalizeMemSql = (sql: string): string =>
    sql.replace(/FOR\s+UPDATE\s+SKIP\s+LOCKED/gi, 'FOR UPDATE');

  activePool = {
    query: <R extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]) =>
      customPool.query<R>(normalizeMemSql(text), values),
    connect: async () => {
      const client = await customPool.connect();
      const origQuery = client.query.bind(client);
      client.query = ((text: string | { text: string }, values?: unknown[]) => {
        if (typeof text === 'string') {
          return origQuery(normalizeMemSql(text), values);
        }
        return origQuery(text, values);
      }) as typeof client.query;
      return client;
    },
    end: () => customPool.end(),
  };
}

export async function query<R extends QueryResultRow = QueryResultRow>(
  text: string,
  values?: unknown[]
): Promise<QueryResult<R>> {
  return getPool().query<R>(text, values);
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function checkDbHealth(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const start = Date.now();
  try {
    await getPool().query('SELECT 1 AS ok');
    return { ok: true, latencyMs: Date.now() - start };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, latencyMs: Date.now() - start, error: message };
  }
}
