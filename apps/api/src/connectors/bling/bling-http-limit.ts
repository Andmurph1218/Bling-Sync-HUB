import { getRedis } from '../../lib/redis.js';
import { logger } from '../../lib/logger.js';
import {
  ErpCallClass,
  ErpCallLane,
  ErpDailyQuotaPausedError,
  ErpDailyState,
  quotaPauseDelayMs,
  ScheduledLimiter,
} from '../rate-limit-port.js';

export const BLING_MAX_REQUESTS_PER_SECOND = 3;
/** Espaçamento mínimo global (360 ms => máx ~2,77 req/s, zero rajada simultânea entre workers). */
export const BLING_MIN_INTERVAL_MS = 360;
/** Chave global compartilhada no Redis entre sync, enriquecimento, reconciliação e OAuth. */
export const BLING_RATE_LIMIT_KEY = 'bling:rate_limit';
/** Cota diária da conta. As filas de leitura param em 80% e deixam o resto para o token. */
export const BLING_DAILY_QUOTA = 120_000;
export const BLING_DAILY_PAUSE_AT = 96_000;
const WINDOW_MS = 1000;
const DAY_TTL_SECONDS = 36 * 60 * 60;

export type BlingCallClass = ErpCallClass;
export type BlingDailyState = ErpDailyState;
export const BlingDailyQuotaPausedError = ErpDailyQuotaPausedError;
export type BlingDailyQuotaPausedError = ErpDailyQuotaPausedError;
export { quotaPauseDelayMs };

export function decideDailyQuota(used: number, callClass: BlingCallClass): BlingDailyState {
  if (used >= BLING_DAILY_QUOTA) return 'exhausted';
  if (callClass === 'bulk' && used >= BLING_DAILY_PAUSE_AT) return 'paused';
  return 'open';
}

/**
 * Reserva atomicamente o próximo horário disponível na chave global `bling:rate_limit`.
 * Garante espaçamento mínimo `minGap` (360ms => <= 2,77 req/s, nunca > 3 req/s em nenhuma borda)
 * e respeita qualquer penalidade de `Retry-After` gravada na mesma chave.
 */
const RESERVE_SLOT_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local minGap = tonumber(ARGV[2])
local nextAt = tonumber(redis.call('GET', key) or '0')
local scheduled = now
if nextAt > now then
  scheduled = nextAt
end
local updatedNext = scheduled + minGap
local ttlMs = math.max(2000, updatedNext - now + 2000)
redis.call('SET', key, tostring(updatedNext), 'PX', ttlMs)
return scheduled - now
`;

/** Empurra `bling:rate_limit` quando qualquer worker recebe HTTP 429 / Retry-After. */
const PENALTY_SCRIPT = `
local key = KEYS[1]
local target = tonumber(ARGV[1])
local ttlMs = tonumber(ARGV[2])
local current = tonumber(redis.call('GET', key) or '0')
if target > current then
  redis.call('SET', key, tostring(target), 'PX', ttlMs)
  return target
end
return current
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
let localNextAt = 0;
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
  localNextAt = 0;
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
  const now = Date.now();
  const scheduled = Math.max(now, localNextAt);
  localNextAt = scheduled + BLING_MIN_INTERVAL_MS;
  const gapWait = scheduled - now;
  if (gapWait > 0) await sleep(gapWait);
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

/** Registra globalmente no Redis (`bling:rate_limit`) uma pausa após HTTP 429 / Retry-After. */
export async function notifyBlingGlobalPenalty(retryAfterMs: number): Promise<void> {
  const effectiveWait = Math.max(BLING_MIN_INTERVAL_MS, Math.min(60_000, Math.ceil(retryAfterMs)));
  const target = Date.now() + effectiveWait;
  localNextAt = Math.max(localNextAt, target);
  const redis = sharedRedis();
  if (!redis) return;
  try {
    await redis.eval(
      PENALTY_SCRIPT,
      1,
      BLING_RATE_LIMIT_KEY,
      String(target),
      String(effectiveWait + 2_000)
    );
  } catch (error) {
    logger.warn('Não foi possível gravar penalidade 429 do Bling no Redis; aplicando localmente.', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Uma vaga da cota global do Bling (`bling:rate_limit`). Sync, enriquecimento, reconciliação e OAuth passam por aqui. */
export async function acquireBlingRequestSlot(callClass: BlingCallClass = 'bulk'): Promise<void> {
  const gate = await consumeDaily(callClass);
  if (gate.state !== 'open') throw new BlingDailyQuotaPausedError(gate.used, gate.state);
  const redis = sharedRedis();
  if (!redis) {
    await waitLocal();
    return;
  }
  try {
    const now = Date.now();
    const reply = await redis.eval(
      RESERVE_SLOT_SCRIPT,
      1,
      BLING_RATE_LIMIT_KEY,
      String(now),
      String(BLING_MIN_INTERVAL_MS)
    );
    const waitMs = Number(reply);
    if (Number.isFinite(waitMs) && waitMs > 0) {
      await sleep(waitMs);
    }
    return;
  } catch (error) {
    logger.warn('Limitador global bling:rate_limit no Redis indisponível. Seguindo no limite local.', {
      error: error instanceof Error ? error.message : String(error),
    });
    await waitLocal();
  }
}

/** Implementação de `ScheduledLimiter` respaldada por `bling:rate_limit` no Redis. */
export class RedisScheduledBlingLimiter implements ScheduledLimiter {
  async schedule<T>(caller: ErpCallLane, task: (grantedAtMs: number) => Promise<T>): Promise<T> {
    const callClass: BlingCallClass =
      caller === 'token' || caller === 'webhook_p1_push_stock' ? 'critical' : 'bulk';
    await acquireBlingRequestSlot(callClass);
    return task(Date.now());
  }

  notifyRateLimitPenalty(retryAfterMs: number): void {
    void notifyBlingGlobalPenalty(retryAfterMs);
  }
}

export const redisScheduledBlingLimiter = new RedisScheduledBlingLimiter();
