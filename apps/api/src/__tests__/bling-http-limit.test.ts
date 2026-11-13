import { describe, expect, it } from 'vitest';
import {
  acquireBlingRequestSlot,
  BLING_DAILY_PAUSE_AT,
  BLING_DAILY_QUOTA,
  BLING_MAX_REQUESTS_PER_SECOND,
  BLING_MIN_INTERVAL_MS,
  BLING_RATE_LIMIT_KEY,
  decideDailyQuota,
  notifyBlingGlobalPenalty,
  quotaPauseDelayMs,
  resetBlingRequestSlotsForTests,
  setBlingSlotRedisForTests,
  takeBlingSlot,
} from '../connectors/bling/bling-http-limit.js';

describe('cota global do Bling', () => {
  it('não concede a quarta chamada dentro do mesmo segundo', () => {
    resetBlingRequestSlotsForTests();
    const now = 1_000_000;
    const granted = [takeBlingSlot(now), takeBlingSlot(now), takeBlingSlot(now)];
    expect(granted.every((slot) => slot.ok)).toBe(true);
    expect(BLING_MAX_REQUESTS_PER_SECOND).toBe(3);
    const blocked = takeBlingSlot(now);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.waitMs).toBeGreaterThan(0);
    expect(takeBlingSlot(now + 1000).ok).toBe(true);
  });

  it('pausa a fila em 80% da cota diária e reserva o resto para o token', () => {
    expect(BLING_DAILY_PAUSE_AT).toBe(Math.floor(BLING_DAILY_QUOTA * 0.8));
    expect(decideDailyQuota(BLING_DAILY_PAUSE_AT - 1, 'bulk')).toBe('open');
    expect(decideDailyQuota(BLING_DAILY_PAUSE_AT, 'bulk')).toBe('paused');
    expect(decideDailyQuota(BLING_DAILY_PAUSE_AT, 'critical')).toBe('open');
    expect(decideDailyQuota(BLING_DAILY_QUOTA, 'critical')).toBe('exhausted');
    expect(quotaPauseDelayMs('paused')).toBe(15 * 60_000);
    expect(quotaPauseDelayMs('exhausted')).toBeGreaterThanOrEqual(60_000);
  });

  it('agenda slots globalmente na chave bling:rate_limit e respeita penalidade 429 entre workers', async () => {
    resetBlingRequestSlotsForTests();
    const store = new Map<string, string>();
    const keysUsed: string[] = [];
    setBlingSlotRedisForTests({
      eval: async (script: string, _numKeys: number, ...args: Array<string | number>) => {
        const key = String(args[0]);
        keysUsed.push(key);
        if (key.startsWith('bling:http:day:')) {
          const current = Number(store.get(key) ?? '0') + 1;
          store.set(key, String(current));
          return [1, current, 'open'];
        }
        if (script.includes('updatedNext')) {
          const now = Number(args[1]);
          const minGap = Number(args[2]);
          const nextAt = Number(store.get(key) ?? '0');
          const scheduled = nextAt > now ? nextAt : now;
          store.set(key, String(scheduled + minGap));
          return scheduled - now;
        }
        const target = Number(args[1]);
        const current = Number(store.get(key) ?? '0');
        if (target > current) store.set(key, String(target));
        return Number(store.get(key) ?? '0');
      },
    });

    const start = Date.now();
    await Promise.all([
      acquireBlingRequestSlot('bulk'),
      acquireBlingRequestSlot('bulk'),
    ]);
    const elapsed = Date.now() - start;
    expect(keysUsed).toContain(BLING_RATE_LIMIT_KEY);
    expect(elapsed).toBeGreaterThanOrEqual(BLING_MIN_INTERVAL_MS - 30);

    await notifyBlingGlobalPenalty(500);
    expect(Number(store.get(BLING_RATE_LIMIT_KEY))).toBeGreaterThanOrEqual(Date.now() + 400);
    resetBlingRequestSlotsForTests();
  });
});
