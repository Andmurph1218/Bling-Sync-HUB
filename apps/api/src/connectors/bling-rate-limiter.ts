/**
 * Rate Limiter Global do Bling ERP v3 (Seção 10.0 do Plano Mestre)
 *
 * Regras travadas:
 * - Cota única por conta Bling (nenhum job trata 3 req/s como cota própria).
 * - Máximo de 3 req/s (janela deslizante de 1.000 ms; máx 30 chamadas em 10 s, longe do bloqueio de IP de 600/10s).
 * - Máximo de 20 chamadas a /oauth/token em 60 s.
 * - Máximo de 120.000 chamadas no dia, com repartição:
 *   - Reserva para webhook P1, leitura do push e retry: 12.000 (não cedida ao enrich).
 *   - Full enrich pausa quando o dia passa de 96.000 chamadas totais.
 *   - Jobs não-prioritários (stock_sync, price_check, delta_enrich) param em 108.000 para preservar a reserva de 12.000.
 * - Ordem de prioridade na mesma janela:
 *   0: token
 *   1: webhook_p1_push_stock
 *   2: stock_sync
 *   3: price_check
 *   4: delta_enrich
 *   5: full_enrich
 */

export type BlingCallerModule =
  | 'token'
  | 'webhook_p1_push_stock'
  | 'stock_sync'
  | 'price_check'
  | 'delta_enrich'
  | 'full_enrich';

const MODULE_PRIORITY: Record<BlingCallerModule, number> = {
  token: 0,
  webhook_p1_push_stock: 1,
  stock_sync: 2,
  price_check: 3,
  delta_enrich: 4,
  full_enrich: 5,
};

export const DAILY_QUOTA_LIMITS = {
  TOTAL_DAILY_MAX: 120_000,
  P1_RESERVED: 12_000,
  NON_P1_CEILING: 108_000, // 120.000 - 12.000 de reserva para P1/webhook/push
  FULL_ENRICH_CEILING: 96_000, // Pausa full enrich quando o dia passa de 96.000
  MODULE_DAILY_BUDGET: {
    token: 2_000,
    webhook_p1_push_stock: 12_000,
    stock_sync: 48_000,
    price_check: 12_000,
    delta_enrich: 24_000,
    full_enrich: 24_000,
  } as Record<BlingCallerModule, number>,
} as const;

export class BlingQuotaExhaustedError extends Error {
  public readonly callerModule: BlingCallerModule;
  public readonly dailyTotalUsed: number;
  public readonly reason: 'full_enrich_96k_ceiling' | 'non_p1_108k_ceiling' | 'daily_120k_exhausted' | 'oauth_20_per_60s_exceeded';

  constructor(
    callerModule: BlingCallerModule,
    dailyTotalUsed: number,
    reason: 'full_enrich_96k_ceiling' | 'non_p1_108k_ceiling' | 'daily_120k_exhausted' | 'oauth_20_per_60s_exceeded'
  ) {
    super(`Cota do Bling atingida para ${callerModule} (${reason}, usado no dia: ${dailyTotalUsed})`);
    this.name = 'BlingQuotaExhaustedError';
    this.callerModule = callerModule;
    this.dailyTotalUsed = dailyTotalUsed;
    this.reason = reason;
  }
}

interface QueuedPermitRequest {
  seq: number;
  callerModule: BlingCallerModule;
  priority: number;
  resolve: (grantedAtMs: number) => void;
  reject: (err: Error) => void;
}

export interface BlingRateLimiterOptions {
  maxPerSecond?: number;
  windowMs?: number;
  maxOAuthPerMinute?: number;
  nowFn?: () => number;
}

export class BlingRateLimiter {
  private readonly maxPerSecond: number;
  private readonly windowMs: number;
  private readonly maxOAuthPerMinute: number;
  private readonly nowFn: () => number;

  private recentRequestTimestamps: number[] = [];
  private recentOAuthTimestamps: number[] = [];
  private dailyTotalCount = 0;
  private dailyModuleCounts: Record<BlingCallerModule, number> = {
    token: 0,
    webhook_p1_push_stock: 0,
    stock_sync: 0,
    price_check: 0,
    delta_enrich: 0,
    full_enrich: 0,
  };

  private queue: QueuedPermitRequest[] = [];
  private seqCounter = 0;
  private drainTimer: ReturnType<typeof setTimeout> | null = null;
  private penaltyUntilMs = 0;

  constructor(options?: BlingRateLimiterOptions) {
    this.maxPerSecond = options?.maxPerSecond ?? 3;
    this.windowMs = options?.windowMs ?? 1000;
    this.maxOAuthPerMinute = options?.maxOAuthPerMinute ?? 20;
    this.nowFn = options?.nowFn ?? (() => Date.now());
  }

  public getDailyStats(): {
    totalUsed: number;
    byModule: Record<BlingCallerModule, number>;
  } {
    return {
      totalUsed: this.dailyTotalCount,
      byModule: { ...this.dailyModuleCounts },
    };
  }

  public setDailyTotalUsedForTest(total: number): void {
    this.dailyTotalCount = total;
  }

  public resetDailyCounters(): void {
    this.dailyTotalCount = 0;
    this.dailyModuleCounts = {
      token: 0,
      webhook_p1_push_stock: 0,
      stock_sync: 0,
      price_check: 0,
      delta_enrich: 0,
      full_enrich: 0,
    };
  }

  public notifyRateLimitPenalty(retryAfterMs: number): void {
    const target = this.nowFn() + Math.max(retryAfterMs, this.windowMs);
    if (target > this.penaltyUntilMs) {
      this.penaltyUntilMs = target;
    }
  }

  private checkDailyQuota(callerModule: BlingCallerModule, now: number): void {
    if (callerModule === 'token') {
      this.recentOAuthTimestamps = this.recentOAuthTimestamps.filter(
        (t) => now - t < 60_000
      );
      if (this.recentOAuthTimestamps.length >= this.maxOAuthPerMinute) {
        throw new BlingQuotaExhaustedError(
          callerModule,
          this.dailyTotalCount,
          'oauth_20_per_60s_exceeded'
        );
      }
    }

    if (this.dailyTotalCount >= DAILY_QUOTA_LIMITS.TOTAL_DAILY_MAX) {
      throw new BlingQuotaExhaustedError(
        callerModule,
        this.dailyTotalCount,
        'daily_120k_exhausted'
      );
    }

    if (
      callerModule === 'full_enrich' &&
      this.dailyTotalCount >= DAILY_QUOTA_LIMITS.FULL_ENRICH_CEILING
    ) {
      throw new BlingQuotaExhaustedError(
        callerModule,
        this.dailyTotalCount,
        'full_enrich_96k_ceiling'
      );
    }

    if (
      callerModule !== 'token' &&
      callerModule !== 'webhook_p1_push_stock' &&
      this.dailyTotalCount >= DAILY_QUOTA_LIMITS.NON_P1_CEILING
    ) {
      throw new BlingQuotaExhaustedError(
        callerModule,
        this.dailyTotalCount,
        'non_p1_108k_ceiling'
      );
    }
  }

  /**
   * Solicita uma permissão no balde único de 3 req/s da conta Bling.
   * Retorna o timestamp (ms) em que a chamada foi autorizada.
   */
  public acquire(callerModule: BlingCallerModule): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      try {
        this.checkDailyQuota(callerModule, this.nowFn());
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }

      const item: QueuedPermitRequest = {
        seq: ++this.seqCounter,
        callerModule,
        priority: MODULE_PRIORITY[callerModule],
        resolve,
        reject,
      };

      this.queue.push(item);
      // Ordena pela prioridade (0 = token -> 5 = full_enrich) e depois FIFO (seq)
      this.queue.sort((a, b) =>
        a.priority !== b.priority ? a.priority - b.priority : a.seq - b.seq
      );

      this.processQueue();
    });
  }

  public async schedule<T>(
    callerModule: BlingCallerModule,
    fn: (grantedAtMs: number) => Promise<T>
  ): Promise<T> {
    const grantedAtMs = await this.acquire(callerModule);
    return fn(grantedAtMs);
  }

  private processQueue(): void {
    if (this.drainTimer) {
      clearTimeout(this.drainTimer);
      this.drainTimer = null;
    }

    if (this.queue.length === 0) {
      return;
    }

    const now = this.nowFn();

    if (this.penaltyUntilMs > now) {
      const waitPenalty = this.penaltyUntilMs - now;
      this.drainTimer = setTimeout(() => this.processQueue(), waitPenalty);
      return;
    }

    // Limpa timestamps com mais de windowMs (1.000 ms)
    this.recentRequestTimestamps = this.recentRequestTimestamps.filter(
      (ts) => now - ts < this.windowMs
    );

    while (
      this.queue.length > 0 &&
      this.recentRequestTimestamps.length < this.maxPerSecond
    ) {
      const next = this.queue.shift()!;
      const grantTime = this.nowFn();

      try {
        this.checkDailyQuota(next.callerModule, grantTime);
      } catch (err) {
        next.reject(err instanceof Error ? err : new Error(String(err)));
        continue;
      }

      this.recentRequestTimestamps.push(grantTime);
      if (next.callerModule === 'token') {
        this.recentOAuthTimestamps.push(grantTime);
      }
      this.dailyTotalCount += 1;
      this.dailyModuleCounts[next.callerModule] += 1;

      next.resolve(grantTime);
    }

    if (this.queue.length > 0 && this.recentRequestTimestamps.length > 0) {
      const oldestInWindow = this.recentRequestTimestamps[0]!;
      const waitMs = Math.max(5, this.windowMs - (this.nowFn() - oldestInWindow) + 2);
      this.drainTimer = setTimeout(() => this.processQueue(), waitMs);
    }
  }
}

export const sharedBlingRateLimiter = new BlingRateLimiter();
