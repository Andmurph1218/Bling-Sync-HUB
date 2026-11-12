import { getRedis } from '../../lib/redis.js';
import { logger } from '../../lib/logger.js';

export const BLING_MAX_REQUESTS_PER_SECOND = 3;
const WINDOW_MS = 1000;
const SLOT_KEY = 'bling:http:slots';

const SLOT_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
local count = redis.call('ZCARD', key)
if count >= limit then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  if oldest[2] then
    return {0, oldest[2]}
  end
  return {0, now}
end
redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, window + 1000)
return {1, now}
`;

interface SlotRedis {
  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>;
}

let stamps: number[] = [];
let redisOverride: SlotRedis | null = null;

export function resetBlingRequestSlotsForTests(): void {
  stamps = [];
  redisOverride = null;
}

export function setBlingSlotRedisForTests(client: SlotRedis | null): void {
  redisOverride = client;
}

/** Janela deslizante de 1 s. No máximo 3 horários concedidos. */
export function takeBlingSlot(now = Date.now()): { ok: true } | { ok: false; waitMs: number } {
  stamps = stamps.filter((stamp) => now - stamp < WINDOW_MS);
  if (stamps.length >= BLING_MAX_REQUESTS_PER_SECOND) {
    const oldest = stamps[0] ?? now;
    return { ok: false, waitMs: Math.max(1, oldest + WINDOW_MS - now) };
  }
  stamps.push(now);
  return { ok: true };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sharedRedis(): SlotRedis | null {
  if (redisOverride) return redisOverride;
  const client = getRedis() as Partial<SlotRedis>;
  return typeof client.eval === 'function' ? (client as SlotRedis) : null;
}

async function waitLocal(): Promise<void> {
  for (;;) {
    const slot = takeBlingSlot();
    if (slot.ok) return;
    await sleep(slot.waitMs);
  }
}

/** Uma vaga da cota global do Bling. Sync, enriquecimento e reconciliação passam por aqui. */
export async function acquireBlingRequestSlot(): Promise<void> {
  const redis = sharedRedis();
  if (!redis) {
    await waitLocal();
    return;
  }
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const now = Date.now();
      const reply = await redis.eval(
        SLOT_SCRIPT,
        1,
        SLOT_KEY,
        String(now),
        String(WINDOW_MS),
        String(BLING_MAX_REQUESTS_PER_SECOND),
        `${now}:${attempt}:${Math.random().toString(36).slice(2)}`
      );
      const row = Array.isArray(reply) ? reply : [1, now];
      if (Number(row[0]) === 1) return;
      const oldest = Number(row[1]);
      const waitMs = Number.isFinite(oldest) ? Math.max(20, oldest + WINDOW_MS - Date.now()) : WINDOW_MS;
      await sleep(Math.min(waitMs, WINDOW_MS));
    } catch (error) {
      logger.warn('Cota do Bling no Redis indisponível. O processo segue no limite local de 3 req/s.', {
        error: error instanceof Error ? error.message : String(error),
      });
      await waitLocal();
      return;
    }
  }
  await waitLocal();
}
