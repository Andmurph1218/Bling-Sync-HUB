export type ErpCallLane =
  | 'token'
  | 'webhook_p1_push_stock'
  | 'stock_sync'
  | 'price_check'
  | 'delta_enrich'
  | 'full_enrich';

export interface ScheduledLimiter {
  schedule<T>(caller: ErpCallLane, task: (grantedAtMs: number) => Promise<T>): Promise<T>;
  notifyRateLimitPenalty(retryAfterMs: number): void;
}

let limiter: ScheduledLimiter | null = null;

export function registerRateLimiter(next: ScheduledLimiter): void {
  limiter = next;
}

export function rateLimiter(): ScheduledLimiter {
  if (!limiter) {
    throw new Error('rate_limiter_not_loaded');
  }
  return limiter;
}
