import type { Candidate, IndexRecord, IndexSnapshot, ResolveHints, ResolveResult } from './types.js';
import { readSnapshot, DEFAULT_DB_PATH } from './storage.js';
import { scoreAll, rankAndDedupe } from './matcher.js';
import { MATCH_THRESHOLDS, MAX_CANDIDATES, MAX_WEAK_CANDIDATES } from './config.js';
import { normalizeForCompare, tokenize, tokenSetScore, type TokenWeightFn } from './textSimilarity.js';
import { buildTokenStats, makeTokenWeightFn } from './tokenStats.js';

export interface ResolveOptions {
  dbPath?: string;
  // Overrides the corpus-rarity weighting resolve() would otherwise compute
  // from the snapshot itself. Production callers should never need this —
  // it exists so tests can inject known, real-world-calibrated weights
  // instead of relying on a small fixture's own (unrealistic) word
  // frequencies to reproduce production statistics.
  tokenWeightFn?: TokenWeightFn;
}

// Rebuilding document-frequency stats over ~8.8k records on every single
// resolve() call would be wasteful when the index only changes on a weekly
// syncIndex() cadence. Cached per (dbPath, fetchedAt) so a fresh snapshot
// invalidates it automatically, without needing an explicit cache-clear API.
const tokenStatsCache = new Map<string, TokenWeightFn>();

function getTokenWeightFn(dbPath: string, snapshot: IndexSnapshot): TokenWeightFn {
  const cacheKey = `${dbPath}::${snapshot.fetchedAt}`;
  const cached = tokenStatsCache.get(cacheKey);
  if (cached) return cached;
  const weightFn = makeTokenWeightFn(buildTokenStats(snapshot.records));
  tokenStatsCache.set(cacheKey, weightFn);
  return weightFn;
}

// Tiers 0-2 only (spec §6: Tier 3 is gated by the §8 measurement and is not
// built yet). Hard rules enforced here per spec §5.1:
//  - always returns the full ranked list with scores, never a single
//    asserted answer;
//  - 'high_confidence' is advisory only — this function never marks
//    anything as confirmed;
//  - thresholds come from the single config.ts location, not inline magic
//    numbers.
export async function resolve(name: string, hints?: ResolveHints, options: ResolveOptions = {}): Promise<ResolveResult> {
  const dbPath = options.dbPath ?? DEFAULT_DB_PATH;
  const snapshot = readSnapshot(dbPath);
  const query = { name, hints };

  if (!snapshot || snapshot.records.length === 0) {
    return { status: 'unresolved', candidates: [], unresolvedReason: 'no_candidates', query };
  }

  const tokenWeightFn = options.tokenWeightFn ?? getTokenWeightFn(dbPath, snapshot);
  const scored = rankAndDedupe(scoreAll(name, hints, snapshot.records, tokenWeightFn));
  const withSignal = scored.filter((c) => c.matchScore > 0);

  if (withSignal.length === 0) {
    return { status: 'unresolved', candidates: [], unresolvedReason: 'no_candidates', query };
  }

  const aboveFloor = withSignal.filter((c) => c.matchScore >= MATCH_THRESHOLDS.floor);

  if (aboveFloor.length === 0) {
    // Real near-misses exist but none clear the floor — surfaced for
    // transparency (capped) rather than silently discarded, since a human
    // reviewer benefits from seeing "closest, but not close enough" rather
    // than nothing at all. Status still correctly reads 'unresolved'.
    return {
      status: 'unresolved',
      candidates: withSignal.slice(0, MAX_WEAK_CANDIDATES),
      unresolvedReason: 'only_weak_candidates',
      query,
    };
  }

  const top = aboveFloor[0];
  const second = aboveFloor[1];
  const clearlyAhead = !second || top.matchScore - second.matchScore >= MATCH_THRESHOLDS.clearMargin;
  const status = top.matchScore >= MATCH_THRESHOLDS.highConfidence && clearlyAhead ? 'high_confidence' : 'ambiguous';

  return {
    status,
    candidates: aboveFloor.slice(0, MAX_CANDIDATES),
    query,
  };
}

// Freebie (spec §5.4): local-index-only, zero LLM cost, zero remote calls.
// Promoter names vary just as project names do, so this reuses the same
// token-set matcher rather than a plain substring/equality check.
export async function projectsByPromoter(promoterName: string, options: ResolveOptions = {}): Promise<Candidate[]> {
  const dbPath = options.dbPath ?? DEFAULT_DB_PATH;
  const snapshot = readSnapshot(dbPath);
  if (!snapshot) return [];

  const scored = snapshot.records.map((record) => {
    const c = candidateFromPromoterMatch(promoterName, record);
    return c;
  });

  return rankAndDedupe(scored)
    .filter((c) => c.matchScore >= MATCH_THRESHOLDS.floor)
    .slice(0, MAX_CANDIDATES);
}

function candidateFromPromoterMatch(promoterName: string, record: IndexRecord): Candidate {
  // projectsByPromoter matches on promoterName, not registeredName — reuse
  // the same normalize/tokenize/tokenSetScore primitives as scoreRecord,
  // applied to the promoter field instead, rather than distorting
  // scoreRecord's signature to serve two different fields.
  const normalizedQuery = normalizeForCompare(promoterName);
  const normalizedCandidate = normalizeForCompare(record.promoterName);

  if (normalizedQuery && normalizedQuery === normalizedCandidate) {
    return {
      regNumber: record.regNumber,
      registeredName: record.registeredName,
      promoterName: record.promoterName,
      dataset: record.dataset,
      matchScore: 1.0,
      matchTier: 'exact',
      evidence: 'exact normalized promoter match',
    };
  }

  const queryTokens = tokenize(promoterName);
  const candidateTokens = tokenize(record.promoterName);
  const match = tokenSetScore(queryTokens, candidateTokens);

  return {
    regNumber: record.regNumber,
    registeredName: record.registeredName,
    promoterName: record.promoterName,
    dataset: record.dataset,
    matchScore: match.score,
    matchTier: 'token',
    evidence: `promoter token overlap ${match.matchedPairs.length}/${queryTokens.length || 1}`,
  };
}
