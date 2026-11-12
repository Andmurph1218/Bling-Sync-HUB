/** Estratégia registrada no worker. O job pede `type: 'jittered'`. */
export const JITTERED_BACKOFF = { type: 'jittered', delay: 5_000 } as const;

const FIVE_MINUTES_MS = 5 * 60_000;

/**
 * Teto = base × 2^tentativa, no máximo 5 min.
 * O valor devolvido é sorteado entre 1 ms e esse teto, para as retentativas não coincidirem.
 */
export function jitteredBackoffMs(
  attemptsMade: number,
  baseMs = 5_000,
  capMs = FIVE_MINUTES_MS,
  random: () => number = Math.random
): number {
  const step = Math.max(0, attemptsMade);
  const ceiling = Math.min(capMs, baseMs * 2 ** step);
  const roll = Math.min(1, Math.max(0, random()));
  return Math.min(ceiling, Math.max(1, Math.floor(roll * ceiling) + 1));
}

export function jitteredBackoffStrategy(attemptsMade: number): number {
  return jitteredBackoffMs(attemptsMade);
}

/** A carta morta só nasce quando a fila não vai tentar de novo. */
export function isFinalQueueAttempt(attemptsMade: number | undefined, maxAttempts: number | undefined): boolean {
  const made = attemptsMade ?? 1;
  const max = maxAttempts && maxAttempts > 0 ? maxAttempts : 1;
  return made >= max;
}
