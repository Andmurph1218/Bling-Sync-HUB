import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { logger } from './logger.js';

export interface RedisPingable {
  ping(): Promise<string>;
  quit(): Promise<string>;
}

let activeRedis: RedisPingable | null = null;

export function getRedis(): RedisPingable {
  if (!activeRedis) {
    const client = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: null,
      lazyConnect: true,
    });
    client.on('error', (err: Error) => {
      logger.error('Erro no cliente Redis', { error: err.message });
    });
    activeRedis = client;
  }
  return activeRedis;
}

export function setRedis(customRedis: RedisPingable | null): void {
  activeRedis = customRedis;
}

export async function checkRedisHealth(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const start = Date.now();
  try {
    const pong = await getRedis().ping();
    return { ok: pong === 'PONG', latencyMs: Date.now() - start };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, latencyMs: Date.now() - start, error: message };
  }
}
