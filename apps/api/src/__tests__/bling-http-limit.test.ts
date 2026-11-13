import { describe, expect, it } from 'vitest';
import {
  BLING_DAILY_PAUSE_AT,
  BLING_DAILY_QUOTA,
  BLING_MAX_REQUESTS_PER_SECOND,
  decideDailyQuota,
  quotaPauseDelayMs,
  resetBlingRequestSlotsForTests,
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
});
