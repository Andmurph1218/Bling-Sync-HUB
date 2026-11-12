import { describe, expect, it } from 'vitest';
import { BLING_MAX_REQUESTS_PER_SECOND, resetBlingRequestSlotsForTests, takeBlingSlot } from '../connectors/bling/bling-http-limit.js';

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
});
