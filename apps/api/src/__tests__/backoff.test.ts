import { describe, expect, it } from 'vitest';
import { isFinalQueueAttempt, jitteredBackoffMs } from '../queues/backoff.js';

describe('backoff com jitter', () => {
  it('dobra o teto a cada tentativa e sorteia um valor dentro dele', () => {
    const first = jitteredBackoffMs(1, 5_000, 300_000, () => 0.999);
    const second = jitteredBackoffMs(2, 5_000, 300_000, () => 0.999);
    expect(first).toBeLessThanOrEqual(10_000);
    expect(second).toBeGreaterThan(first);
    expect(second).toBeLessThanOrEqual(20_000);
    expect(jitteredBackoffMs(1, 5_000, 300_000, () => 0)).toBe(1);
    expect(jitteredBackoffMs(8, 15_000, 60_000, () => 1)).toBe(60_000);
  });

  it('só trata como esgotada a última tentativa da fila', () => {
    expect(isFinalQueueAttempt(1, 5)).toBe(false);
    expect(isFinalQueueAttempt(5, 5)).toBe(true);
    expect(isFinalQueueAttempt(undefined, undefined)).toBe(true);
  });
});
