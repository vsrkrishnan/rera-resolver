import { TOKEN_MATCH } from './config.js';

// Ported from REKI's rera.ts normalizeForCompare — same normalization so
// behavior stays comparable to the code this library replaces.
export function normalizeForCompare(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function tokenize(s: string): string[] {
  const normalized = normalizeForCompare(s);
  return normalized ? normalized.split(' ') : [];
}

// Classic Levenshtein edit distance, iterative DP with a rolling row (O(n*m)
// time, O(m) space) — token strings are short (a handful of characters),
// so this is fast even scanned across a ~13k-record index.
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prevRow = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const currRow = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      currRow.push(Math.min(prevRow[j] + 1, currRow[j - 1] + 1, prevRow[j - 1] + cost));
    }
    prevRow = currRow;
  }
  return prevRow[b.length];
}

// Normalized similarity in [0, 1]: 1.0 for identical tokens, 0.0 for
// maximally different (edit distance == length of the longer token).
export function tokenSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

export interface TokenSetMatch {
  score: number;
  matchedPairs: Array<{ queryToken: string; candidateToken: string; similarity: number }>;
}

export type TokenWeightFn = (token: string) => number;

// Used when a caller has no real corpus stats (e.g. isolated unit tests).
// Fixed at TOKEN_MATCH.defaultTokenWeight for every token so behavior
// matches the pre-IDF "needs >= 2 tokens" rule exactly — see config.ts's
// calibration comment for why 4 specifically.
const DEFAULT_WEIGHT: TokenWeightFn = () => TOKEN_MATCH.defaultTokenWeight;

// Token-set similarity, tolerant of word-order variation (both sides are
// treated as sets, so "Sri Sai Residency" vs "Sai Sri Residency" scores 1.0),
// token gaps/extra tokens (partial credit via a symmetric best-match
// average, not all-or-nothing), and minor typos (per-token fuzzy equality
// via normalized edit distance). This is the deterministic Tier 2 matcher —
// pure compute, no network, no LLM (spec §6).
//
// tokenWeightFn lets a caller weight tokens by rarity (see tokenStats.ts) so
// a distinctive word counts for more than a generic one. It defaults to
// uniform weight 1 for callers without corpus stats (e.g. isolated unit
// tests) — every sum below degrades to a plain count in that case, so the
// pre-weighting formula is a special case of this one, not a separate path.
export function tokenSetScore(
  queryTokens: string[],
  candidateTokens: string[],
  tokenWeightFn: TokenWeightFn = DEFAULT_WEIGHT,
): TokenSetMatch {
  if (queryTokens.length === 0 || candidateTokens.length === 0) {
    return { score: 0, matchedPairs: [] };
  }

  const bestForQuery = queryTokens.map((qt) => {
    let best = { candidateToken: '', similarity: 0 };
    for (const ct of candidateTokens) {
      const sim = tokenSimilarity(qt, ct);
      if (sim > best.similarity) best = { candidateToken: ct, similarity: sim };
    }
    return { queryToken: qt, ...best };
  });
  const bestForCandidate = candidateTokens.map((ct) => {
    let best = 0;
    for (const qt of queryTokens) {
      best = Math.max(best, tokenSimilarity(qt, ct));
    }
    return best;
  });

  const queryWeights = queryTokens.map(tokenWeightFn);
  const candidateWeights = candidateTokens.map(tokenWeightFn);
  const totalQueryWeight = queryWeights.reduce((a, b) => a + b, 0);
  const totalCandidateWeight = candidateWeights.reduce((a, b) => a + b, 0);

  // Symmetric best-match average (a soft Dice coefficient): each side's
  // tokens contribute their best available match on the other side, weighted
  // by rarity, so extra/missing tokens on either side drag the score down
  // proportionally rather than causing a hard miss.
  const weightedSumQuery = bestForQuery.reduce((acc, m, i) => acc + m.similarity * queryWeights[i], 0);
  const weightedSumCandidate = bestForCandidate.reduce((acc, s, i) => acc + s * candidateWeights[i], 0);
  const symmetricScore = (weightedSumQuery + weightedSumCandidate) / (totalQueryWeight + totalCandidateWeight);

  // Containment score: how well the query alone is explained by the
  // candidate, ignoring any extra tokens the candidate has beyond the query.
  // This is what a "<Tower> @ The <Community>" registered name needs — the
  // query ("The Community") can be fully contained in a much longer name
  // without the symmetric average punishing it for the tower-name tokens it
  // was never going to have. Gated on the query's TOTAL WEIGHT (not raw
  // token count) so a single generic word can't cheaply "contain-match"
  // everything, while a single rare/distinctive word can (see config.ts's
  // calibration comment).
  const queryRecall = weightedSumQuery / totalQueryWeight;
  const containmentScore =
    totalQueryWeight >= TOKEN_MATCH.containmentMinQueryWeight ? queryRecall * TOKEN_MATCH.containmentDiscount : 0;

  const score = Math.max(symmetricScore, containmentScore);

  const matchedPairs = bestForQuery
    .filter((m) => m.similarity >= TOKEN_MATCH.perTokenFuzzyThreshold)
    .map((m) => ({ queryToken: m.queryToken, candidateToken: m.candidateToken, similarity: m.similarity }));

  return { score, matchedPairs };
}
