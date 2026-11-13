import { loadConnectors } from './load.js';

export type ErpCallLane =
  | 'token'
  | 'webhook_p1_push_stock'
  | 'stock_sync'
  | 'price_check'
  | 'delta_enrich'
  | 'full_enrich';

export type ErpCallClass = 'bulk' | 'critical';
export type ErpDailyState = 'open' | 'paused' | 'exhausted';

export class ErpDailyQuotaPausedError extends Error {
  constructor(
    readonly used: number,
    readonly state: Exclude<ErpDailyState, 'open'>
  ) {
    super(
      state === 'exhausted'
        ? `Cota diária do Bling esgotada (${used} chamadas).`
        : `Filas do Bling pausadas: ${used} chamadas no dia, acima de 80% da cota.`
    );
    this.name = 'BlingDailyQuotaPausedError';
  }
}

export function quotaPauseDelayMs(state: Exclude<ErpDailyState, 'open'>, now = Date.now()): number {
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

export interface ScheduledLimiter {
  schedule<T>(caller: ErpCallLane, task: (grantedAtMs: number) => Promise<T>): Promise<T>;
  notifyRateLimitPenalty(retryAfterMs: number): void;
}

type SlotAcquirer = (callClass?: ErpCallClass) => Promise<void>;

let limiter: ScheduledLimiter | null = null;
let slotAcquirer: SlotAcquirer | null = null;

export function registerRateLimiter(next: ScheduledLimiter): void {
  limiter = next;
}

export function registerErpSlotAcquirer(next: SlotAcquirer): void {
  slotAcquirer = next;
}

export async function acquireErpRequestSlot(callClass: ErpCallClass = 'bulk'): Promise<void> {
  if (!slotAcquirer) {
    await loadConnectors();
  }
  if (slotAcquirer) {
    await slotAcquirer(callClass);
  }
}

export function rateLimiter(): ScheduledLimiter {
  if (!limiter) {
    throw new Error('rate_limiter_not_loaded');
  }
  return limiter;
}
