import { getRedis } from '../../lib/redis.js';
import { logger } from '../../lib/logger.js';

export const BLING_MAX_REQUESTS_PER_SECOND = 3;
/** Cota diária da conta. As filas de leitura param em 80% e deixam o resto para o token. */
export const BLING_DAILY_QUOTA = 120_000;
export const BLING_DAILY_PAUSE_AT = 96_000;
const WINDOW_MS = 1000;
const SLOT_KEY = 'bling:http:slots';
const DAY_TTL_SECONDS = 36 * 60 * 60;

export type BlingCallClass = 'bulk' | 'critical';
export type BlingDailyState = 'open' | 'paused' | 'exhausted';

export class BlingDailyQuotaPausedError extends Error {
  constructor(
    readonly used: number,
    readonly state: Exclude<BlingDailyState, 'open'>
  ) {
    super(
      state === 'exhausted'
        ? `Cota diária do Bling esgotada (${used} chamadas).`
        : `Filas do Bling pausadas: ${used} chamadas no dia, acima de 80% da cota.`
    );
    this.name = 'BlingDailyQuotaPausedError';
  }
}

export function decideDailyQuota(used: number, callClass: BlingCallClass): BlingDailyState {
  if (used >= BLING_DAILY_QUOTA) return 'exhausted';
  if (callClass === 'bulk' && used >= BLING_DAILY_PAUSE_AT) return 'paused';
  return 'open';
}

export function quotaPauseDelayMs(state: Exclude<BlingDailyState, 'open'>, now = Date.now()): number {
  if (state === 'paused') return 15 * 60_000;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(now));
  const pick = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const elapsed = ((pick('hour') * 60 + pick('minute')) * 60 + pick('second')) * 1000;
  return Math.max(60_000, 24 * 60 * 60 * 1000 - elapsed);
}

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

const DAILY_SCRIPT = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local pauseAt = tonumber(ARGV[2])
local critical = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])
local n = redis.call('INCR', key)
if n == 1 then redis.call('EXPIRE', key, ttl) end
if n >= limit then
  redis.call('DECR', key)
  return {0, n - 1, 'exhausted'}
end
if critical == 0 and n >= pauseAt then
  redis.call('DECR', key)
  return {0, n - 1, 'paused'}
end
return {1, n, 'open'}
`;

interface SlotRedis {
  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>;
  get?(key: string): Promise<string | null>;
}

let stamps: number[] = [];
let redisOverride: SlotRedis | null = null;
let localDay = '';
let localUsed = 0;

function saoPauloDay(now = Date.now()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(now));
}

function dailyKey(now = Date.now()): string {
  return `bling:http:day:${saoPauloDay(now)}`;
}

export function resetBlingRequestSlotsForTests(): void {
  stamps = [];
  redisOverride = null;
  localDay = '';
  localUsed = 0;
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

function consumeLocal(callClass: BlingCallClass, now = Date.now()): { state: BlingDailyState; used: number } {
  const day = saoPauloDay(now);
  if (day !== localDay) {
    localDay = day;
    localUsed = 0;
  }
  const state = decideDailyQuota(localUsed + 1, callClass);
  if (state !== 'open') return { state, used: localUsed };
  localUsed += 1;
  return { state: 'open', used: localUsed };
}

async function consumeDaily(callClass: BlingCallClass): Promise<{ state: BlingDailyState; used: number }> {
  const redis = sharedRedis();
  if (!redis) return consumeLocal(callClass);
  try {
    const reply = await redis.eval(
      DAILY_SCRIPT,
      1,
      dailyKey(),
      String(BLING_DAILY_QUOTA),
      String(BLING_DAILY_PAUSE_AT),
      callClass === 'critical' ? '1' : '0',
      String(DAY_TTL_SECONDS)
    );
    const row = Array.isArray(reply) ? reply : [1, 0, 'open'];
    const marker = String(row[2]);
    const state: BlingDailyState = marker === 'paused' || marker === 'exhausted' ? marker : 'open';
    return { state, used: Number(row[1]) || 0 };
  } catch (error) {
    logger.warn('Contador diário do Bling no Redis indisponível. A cota segue neste processo.', {
      error: error instanceof Error ? error.message : String(error),
    });
    return consumeLocal(callClass);
  }
}

/** Uma vaga da cota global do Bling. Sync, enriquecimento e reconciliação passam por aqui. */
export async function acquireBlingRequestSlot(callClass: BlingCallClass = 'bulk'): Promise<void> {
  const gate = await consumeDaily(callClass);
  if (gate.state !== 'open') throw new BlingDailyQuotaPausedError(gate.used, gate.state);
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
