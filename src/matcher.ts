import type { Candidate, IndexRecord, ResolveHints } from './types.js';
import { normalizeForCompare, tokenize, tokenSetScore, type TokenWeightFn } from './textSimilarity.js';
import { PROMOTER_HINT } from './config.js';

function buildEvidence(
  nameMatch: ReturnType<typeof tokenSetScore>,
  queryTokenCount: number,
  promoterMatch: { match: ReturnType<typeof tokenSetScore>; hintTokenCount: number } | null,
): string {
  const overlap = `token overlap ${nameMatch.matchedPairs.length}/${queryTokenCount}`;
  const fuzzyNote = nameMatch.matchedPairs.some((p) => p.queryToken !== p.candidateToken)
    ? '; includes fuzzy (typo-tolerant) token match'
    : '';
  const promoterNote = promoterMatch
    ? `; promoter hint overlap ${promoterMatch.match.matchedPairs.length}/${promoterMatch.hintTokenCount} (score ${promoterMatch.match.score.toFixed(2)})`
    : '';
  return `${overlap}${fuzzyNote}${promoterNote}`;
}

// Scores a single record against the query name (+ optional hints). This is
// Tiers 0-2 combined: Tier 0 normalizes/tokenizes, Tier 1 short-circuits to a
// perfect score on exact match, Tier 2 falls back to token-set similarity.
// tokenWeightFn is optional corpus-rarity weighting (see tokenStats.ts) —
// omitted, it falls back to tokenSetScore's own default (see
// textSimilarity.ts), which reproduces the pre-IDF behavior exactly.
export function scoreRecord(
  name: string,
  hints: ResolveHints | undefined,
  record: IndexRecord,
  tokenWeightFn?: TokenWeightFn,
): Candidate {
  const normalizedQuery = normalizeForCompare(name);
  const normalizedRegistered = normalizeForCompare(record.registeredName);

  if (normalizedQuery && normalizedQuery === normalizedRegistered) {
    return {
      regNumber: record.regNumber,
      registeredName: record.registeredName,
      promoterName: record.promoterName,
      dataset: record.dataset,
      state: record.state,
      matchScore: 1.0,
      matchTier: 'exact',
      evidence: 'exact normalized match',
    };
  }

  const queryTokens = tokenize(name);
  const registeredTokens = tokenize(record.registeredName);
  const nameMatch = tokenSetScore(queryTokens, registeredTokens, tokenWeightFn);

  let score = nameMatch.score;
  let promoterInfo: { match: ReturnType<typeof tokenSetScore>; hintTokenCount: number } | null = null;
  if (hints?.promoterName) {
    const hintTokens = tokenize(hints.promoterName);
    const promoterMatch = tokenSetScore(hintTokens, tokenize(record.promoterName), tokenWeightFn);
    promoterInfo = { match: promoterMatch, hintTokenCount: hintTokens.length || 1 };
    score = nameMatch.score * PROMOTER_HINT.nameWeight + promoterMatch.score * PROMOTER_HINT.promoterWeight;
  }

  return {
    regNumber: record.regNumber,
    registeredName: record.registeredName,
    promoterName: record.promoterName,
    dataset: record.dataset,
    state: record.state,
    matchScore: score,
    matchTier: 'token',
    evidence: buildEvidence(nameMatch, queryTokens.length || 1, promoterInfo),
  };
}

// Scores a record's promoterName against a promoter-name query. Used by
// projectsByPromoter (matching on promoter, not project name) and by the
// Tier 3 shortlist builder (llmBridge.ts, for hints.promoterName-based
// narrowing) — kept here rather than duplicated in both call sites.
export function scorePromoterMatch(promoterName: string, record: IndexRecord, tokenWeightFn?: TokenWeightFn): Candidate {
  const normalizedQuery = normalizeForCompare(promoterName);
  const normalizedCandidate = normalizeForCompare(record.promoterName);

  if (normalizedQuery && normalizedQuery === normalizedCandidate) {
    return {
      regNumber: record.regNumber,
      registeredName: record.registeredName,
      promoterName: record.promoterName,
      dataset: record.dataset,
      state: record.state,
      matchScore: 1.0,
      matchTier: 'exact',
      evidence: 'exact normalized promoter match',
    };
  }

  const queryTokens = tokenize(promoterName);
  const candidateTokens = tokenize(record.promoterName);
  const match = tokenSetScore(queryTokens, candidateTokens, tokenWeightFn);

  return {
    regNumber: record.regNumber,
    registeredName: record.registeredName,
    promoterName: record.promoterName,
    dataset: record.dataset,
    state: record.state,
    matchScore: match.score,
    matchTier: 'token',
    evidence: `promoter token overlap ${match.matchedPairs.length}/${queryTokens.length || 1}`,
  };
}

export function scoreAll(
  name: string,
  hints: ResolveHints | undefined,
  records: IndexRecord[],
  tokenWeightFn?: TokenWeightFn,
): Candidate[] {
  return records.map((r) => scoreRecord(name, hints, r, tokenWeightFn));
}

// Ranking rule (spec §6): merge candidates, dedupe by regNumber keeping the
// highest score, sort desc. Tier 3 (LLM) candidates get merged in the same
// way once built — this function already accepts a flat Candidate[] from any
// tier(s).
export function rankAndDedupe(candidates: Candidate[]): Candidate[] {
  const byRegNumber = new Map<string, Candidate>();
  for (const c of candidates) {
    const existing = byRegNumber.get(c.regNumber);
    if (!existing || c.matchScore > existing.matchScore) {
      byRegNumber.set(c.regNumber, c);
    }
  }
  return Array.from(byRegNumber.values()).sort((a, b) => b.matchScore - a.matchScore);
}
