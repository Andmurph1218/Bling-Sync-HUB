import { getRedis } from '../../lib/redis.js';
import { logger } from '../../lib/logger.js';

const PAUSE_KEY = 'nuvemshop:http:resume-at';
const MAX_WAIT_MS = 60_000;
const EMPTY_BUCKET_FALLBACK_MS = 1_000;
export const NUVEMSHOP_DEFAULT_TIMEOUT_MS = 15_000;

export interface HeaderSource {
  get(name: string): string | null;
}

interface PauseRedis {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'PX', ttl: number): Promise<unknown>;
}

let resumeAt = 0;
let chain: Promise<void> = Promise.resolve();
let fetchOverride: ((input: string, init?: RequestInit) => Promise<Response>) | null = null;

/** A simulação troca o transporte. Fora do teste, a chamada segue para a Nuvemshop. */
export function setNuvemshopFetchForTests(
  fetchImpl: ((input: string, init?: RequestInit) => Promise<Response>) | null
): void {
  fetchOverride = fetchImpl;
}

export function resetNuvemshopRateLimitForTests(): void {
  resumeAt = 0;
  chain = Promise.resolve();
}

function parseHeader(value: string | null): number | null {
  if (value === null || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function headerSource(headers: HeaderSource | Record<string, string | undefined>): HeaderSource {
  if (typeof (headers as HeaderSource).get === 'function') return headers as HeaderSource;
  const record = headers as Record<string, string | undefined>;
  return {
    get(name: string) {
      const found = Object.keys(record).find((key) => key.toLowerCase() === name.toLowerCase());
      return found ? record[found] ?? null : null;
    },
  };
}

/** Espera quando `x-rate-limit-remaining` chegou a zero. `reset` vem em ms, ou em epoch. */
export function nuvemshopWaitMs(remaining: number | null, reset: number | null, now = Date.now()): number {
  if (remaining === null || remaining > 0) return 0;
  if (reset === null || !Number.isFinite(reset) || reset <= 0) return EMPTY_BUCKET_FALLBACK_MS;
  let delay = reset;
  if (reset >= 1_000_000_000_000) delay = reset - now;
  else if (reset >= 1_000_000_000) delay = reset * 1000 - now;
  if (delay <= 0) return 0;
  return Math.min(MAX_WAIT_MS, Math.ceil(delay));
}

export function noteNuvemshopRateLimit(headers: HeaderSource | Record<string, string | undefined>, now = Date.now()): number {
  const source = headerSource(headers);
  const wait = nuvemshopWaitMs(
    parseHeader(source.get('x-rate-limit-remaining')),
    parseHeader(source.get('x-rate-limit-reset')),
    now
  );
  if (wait > 0) resumeAt = Math.max(resumeAt, now + wait);
  return wait;
}

function pauseRedis(): PauseRedis | null {
  const client = getRedis() as Partial<PauseRedis>;
  if (typeof client.get !== 'function' || typeof client.set !== 'function') return null;
  return client as PauseRedis;
}

async function rememberPause(until: number): Promise<void> {
  resumeAt = Math.max(resumeAt, until);
  const redis = pauseRedis();
  if (!redis) return;
  const ttl = Math.max(1, until - Date.now());
  try {
    await redis.set(PAUSE_KEY, String(resumeAt), 'PX', ttl);
  } catch (error) {
    logger.warn('Pausa da Nuvemshop não foi gravada no Redis. O processo segue com o relógio local.', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function currentResumeAt(): Promise<number> {
  const redis = pauseRedis();
  if (!redis) return resumeAt;
  try {
    const raw = await redis.get(PAUSE_KEY);
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) resumeAt = Math.max(resumeAt, parsed);
  } catch (error) {
    logger.warn('Pausa da Nuvemshop no Redis indisponível. O processo segue com o relógio local.', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return resumeAt;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface NuvemshopClock {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
}

/** Serializa a chamada e espera o reset antes de gastar uma cota que já acabou. */
export async function withNuvemshopLimit<T>(
  run: () => Promise<T>,
  readHeaders: (result: T) => HeaderSource | Record<string, string | undefined>,
  clock?: NuvemshopClock
): Promise<T> {
  const job = chain.then(async () => {
    const now = clock?.now ?? Date.now;
    const sleep = clock?.sleep ?? delay;
    const until = await currentResumeAt();
    const wait = until - now();
    if (wait > 0) await sleep(wait);
    const result = await run();
    const noted = noteNuvemshopRateLimit(readHeaders(result), now());
    if (noted > 0) {
      await rememberPause(now() + noted);
      logger.info('Nuvemshop sem cota. A próxima chamada espera o reset.', { waitMs: noted });
    }
    return result;
  });
  chain = job.then(() => undefined, () => undefined);
  return job;
}

export async function nuvemshopFetch(url: string, init?: RequestInit, clock?: NuvemshopClock): Promise<Response> {
  const call = clock?.fetch ?? fetchOverride ?? fetch;
  return withNuvemshopLimit(
    () => {
      const effectiveInit: RequestInit = init?.signal
        ? init
        : { ...init, signal: AbortSignal.timeout(NUVEMSHOP_DEFAULT_TIMEOUT_MS) };
      return call(url, effectiveInit);
    },
    (response) => response.headers,
    clock
  );
}
