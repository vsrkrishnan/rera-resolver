import type { IndexRecord } from './types.js';
import { tokenize } from './textSimilarity.js';

export interface TokenStats {
  totalRecords: number;
  docFreq: Map<string, number>;
}

// Document frequency per token across registeredName only (promoter-name
// rarity isn't currently used for weighting — see matcher.ts).
export function buildTokenStats(records: IndexRecord[]): TokenStats {
  const docFreq = new Map<string, number>();
  for (const r of records) {
    for (const t of new Set(tokenize(r.registeredName))) {
      docFreq.set(t, (docFreq.get(t) ?? 0) + 1);
    }
  }
  return { totalRecords: records.length, docFreq };
}

// Smoothed IDF+1: weight -> 1 as a token approaches "appears in every
// record" (no distinguishing power), grows unbounded (log-scale) as a token
// approaches "appears nowhere else" (maximally distinctive). +1 keeps a
// token that's in literally every record from collapsing to a weight of 0
// and zeroing out its contribution entirely.
export function tokenWeight(stats: TokenStats, token: string): number {
  const df = stats.docFreq.get(token) ?? 0;
  return Math.log((stats.totalRecords + 1) / (df + 1)) + 1;
}

export function makeTokenWeightFn(stats: TokenStats): (token: string) => number {
  return (token: string) => tokenWeight(stats, token);
}
