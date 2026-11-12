import { jaroWinklerSimilarity } from '../../engines/pire.js';

export type ListingSignal = 'sku' | 'ean' | 'title';

export function sameIdentity(left?: string | null, right?: string | null): boolean {
  const a = (left ?? '').trim().toLowerCase();
  const b = (right ?? '').trim().toLowerCase();
  return a.length > 0 && a === b;
}

/** Dois sinais confirmam o vínculo. Um sinal só fica para revisão. */
export function linkStatusFromSignals(signals: ListingSignal[]): 'vinculado' | 'sugerido' {
  return new Set(signals).size >= 2 ? 'vinculado' : 'sugerido';
}

export function collectListingSignals(input: {
  hubSku?: string | null;
  hubEan?: string | null;
  hubName?: string | null;
  channelSku?: string | null;
  channelEan?: string | null;
  channelTitle?: string | null;
  matchedBy?: Array<'sku' | 'ean'>;
}): ListingSignal[] {
  const signals: ListingSignal[] = [];
  if (input.matchedBy?.includes('sku') || sameIdentity(input.channelSku, input.hubSku)) signals.push('sku');
  if (input.matchedBy?.includes('ean') || sameIdentity(input.channelEan, input.hubEan)) signals.push('ean');
  if (jaroWinklerSimilarity(input.channelTitle, input.hubName) >= 0.9) signals.push('title');
  return [...new Set(signals)];
}
