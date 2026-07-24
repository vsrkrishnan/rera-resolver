import type {
  Candidate,
  IndexRecord,
  IndexSnapshot,
  LlmClient,
  LlmMatchResponse,
  OperationCostRecord,
  ResolveHints,
  ResolveResult,
} from './types.js';
import { readSnapshot, DEFAULT_DB_PATH } from './storage.js';
import { scoreAll, scorePromoterMatch, rankAndDedupe } from './matcher.js';
import { MATCH_THRESHOLDS, MAX_CANDIDATES, MAX_WEAK_CANDIDATES } from './config.js';
import type { TokenWeightFn } from './textSimilarity.js';
import { buildTokenStats, makeTokenWeightFn } from './tokenStats.js';
import { buildShortlist, runLlmSemanticBridge } from './llmBridge.js';

export interface ResolveOptions {
  dbPath?: string;
  // Overrides the corpus-rarity weighting resolve() would otherwise compute
  // from the snapshot itself. Production callers should never need this —
  // it exists so tests can inject known, real-world-calibrated weights
  // instead of relying on a small fixture's own (unrealistic) word
  // frequencies to reproduce production statistics.
  tokenWeightFn?: TokenWeightFn;
  // Tier 3 (LLM semantic bridge, spec §6). BYO-LLM: omitted entirely by
  // default, so resolve() stays Tiers 0-2 only, zero LLM cost, unless a
  // caller explicitly injects an implementation.
  llmClient?: LlmClient;
  onCost?: (record: OperationCostRecord) => void;
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

// Shared by the Tiers-0-2-only result and the post-Tier-3 merged result, so
// the "what counts as high_confidence / ambiguous / unresolved" rule lives
// in exactly one place regardless of which tiers actually ran (spec §5.1
// hard rule: thresholds come from config.ts, not duplicated inline logic).
function buildResult(
  withSignal: Candidate[],
  aboveFloor: Candidate[],
  query: ResolveResult['query'],
): ResolveResult {
  if (withSignal.length === 0) {
    return { status: 'unresolved', candidates: [], unresolvedReason: 'no_candidates', query };
  }

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

  return { status, candidates: aboveFloor.slice(0, MAX_CANDIDATES), query };
}

// Tiers 0-2 (deterministic, zero LLM cost) always run. Tier 3 (LLM semantic
// bridge) runs only when the caller injects an llmClient AND Tiers 0-2
// didn't already reach high_confidence on their own (spec §6: "only as a
// fallback"). Hard rules enforced throughout per spec §5.1:
//  - always returns the full ranked list with scores, never a single
//    asserted answer;
//  - 'high_confidence' is advisory only — this function never marks
//    anything as confirmed;
//  - thresholds come from the single config.ts location, not inline magic
//    numbers.
export async function resolve(name: string, hints?: ResolveHints, options: ResolveOptions = {}): Promise<ResolveResult> {
  const dbPath = options.dbPath ?? DEFAULT_DB_PATH;
  const startedAt = Date.now();
  const snapshot = readSnapshot(dbPath);
  const query = { name, hints };

  const emitCost = (llmAttempted: boolean, llmResponse: LlmMatchResponse | null) => {
    options.onCost?.({
      operation: 'resolve',
      httpCalls: 0,
      llmCalls: llmAttempted ? 1 : 0,
      llmInputTokens: llmResponse?.inputTokens,
      llmOutputTokens: llmResponse?.outputTokens,
      llmCostInr: llmResponse?.costInr,
      latencyMs: Date.now() - startedAt,
      at: new Date().toISOString(),
    });
  };

  if (!snapshot) {
    // No file at all: the local index has never been built. Distinct from a
    // real search coming up empty — see ensureIndex() to build/refresh it.
    emitCost(false, null);
    return { status: 'unresolved', candidates: [], unresolvedReason: 'index_not_ready', query };
  }

  if (snapshot.records.length === 0) {
    emitCost(false, null);
    return { status: 'unresolved', candidates: [], unresolvedReason: 'no_candidates', query };
  }

  const tokenWeightFn = options.tokenWeightFn ?? getTokenWeightFn(dbPath, snapshot);
  const scored = rankAndDedupe(scoreAll(name, hints, snapshot.records, tokenWeightFn));
  const withSignal = scored.filter((c) => c.matchScore > 0);
  const aboveFloor = withSignal.filter((c) => c.matchScore >= MATCH_THRESHOLDS.floor);
  const tier12Result = buildResult(withSignal, aboveFloor, query);

  if (!options.llmClient || tier12Result.status === 'high_confidence') {
    emitCost(false, null);
    return tier12Result;
  }

  const shortlist = buildShortlist(hints, snapshot.records, withSignal, tokenWeightFn);
  const outcome = await runLlmSemanticBridge(name, hints, shortlist, snapshot.records, options.llmClient);
  emitCost(true, outcome.response);

  if (outcome.candidates.length === 0) {
    return tier12Result;
  }

  const merged = rankAndDedupe([...scored, ...outcome.candidates]);
  const mergedWithSignal = merged.filter((c) => c.matchScore > 0);
  const mergedAboveFloor = mergedWithSignal.filter((c) => c.matchScore >= MATCH_THRESHOLDS.floor);
  return buildResult(mergedWithSignal, mergedAboveFloor, query);
}

// Freebie (spec §5.4): local-index-only, zero LLM cost, zero remote calls.
// Promoter names vary just as project names do, so this reuses the same
// token-set matcher rather than a plain substring/equality check.
export async function projectsByPromoter(promoterName: string, options: ResolveOptions = {}): Promise<Candidate[]> {
  const dbPath = options.dbPath ?? DEFAULT_DB_PATH;
  const snapshot = readSnapshot(dbPath);
  if (!snapshot) return [];

  // Same corpus-rarity weighting resolve() uses for project-name matching
  // (see getTokenWeightFn above) — without it, every token defaults to
  // tokenSetScore's generic weight, so even a rare, distinctive surname
  // never clears the containment-boost gate and a single-word promoter
  // query against a multi-token registered name (e.g. "Nambiar" vs "NAMBIAR
  // BUILDERS PVT LTD") scores near zero and is filtered out entirely.
  const tokenWeightFn = options.tokenWeightFn ?? getTokenWeightFn(dbPath, snapshot);
  const scored = snapshot.records.map((record) => scorePromoterMatch(promoterName, record, tokenWeightFn));

  return rankAndDedupe(scored)
    .filter((c) => c.matchScore >= MATCH_THRESHOLDS.floor)
    .slice(0, MAX_CANDIDATES);
}
