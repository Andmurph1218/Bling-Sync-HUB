import { afterEach, describe, expect, it } from 'vitest';
import {
  nuvemshopFetch,
  nuvemshopWaitMs,
  resetNuvemshopRateLimitForTests,
} from '../connectors/strategy/nuvemshop-http.js';
import { setRedis } from '../lib/redis.js';

describe('cota da Nuvemshop', () => {
  afterEach(() => {
    resetNuvemshopRateLimitForTests();
    setRedis(null);
  });

  it('não espera enquanto ainda há chamadas e limita a espera a um minuto', () => {
    expect(nuvemshopWaitMs(12, 400)).toBe(0);
    expect(nuvemshopWaitMs(0, 400)).toBe(400);
    expect(nuvemshopWaitMs(0, 120_000)).toBe(60_000);
    expect(nuvemshopWaitMs(0, null)).toBe(1_000);
    const now = 1_700_000_000_000;
    expect(nuvemshopWaitMs(0, now + 2_000, now)).toBe(2_000);
    expect(nuvemshopWaitMs(0, 1_700_000_002, now)).toBe(2_000);
  });

  it('segura a próxima chamada até o reset quando a cota chega a zero', async () => {
    setRedis({ ping: async () => 'PONG', quit: async () => 'OK' });
    resetNuvemshopRateLimitForTests();
    let now = 1_000_000;
    const sleeps: number[] = [];
    const calls: string[] = [];
    const clock = {
      now: () => now,
      sleep: async (ms: number) => {
        sleeps.push(ms);
        now += ms;
      },
      fetch: async (url: string) => {
        calls.push(url);
        const remaining = calls.length === 1 ? '0' : '39';
        return new Response('{}', {
          status: 200,
          headers: {
            'x-rate-limit-remaining': remaining,
            'x-rate-limit-reset': '250',
          },
        });
      },
    };
    await nuvemshopFetch('https://api.nuvemshop.com.br/a', undefined, clock);
    await nuvemshopFetch('https://api.nuvemshop.com.br/b', undefined, clock);
    expect(calls).toEqual(['https://api.nuvemshop.com.br/a', 'https://api.nuvemshop.com.br/b']);
    expect(sleeps).toEqual([250]);
  });
});