// Single, documented location for every tunable matcher constant (spec §5.1
// hard rule: "Thresholds must be named constants in one config location").
export const MATCH_THRESHOLDS = {
  // A candidate must score at or above this to be treated as "plausible" at
  // all — i.e. worth including in the returned candidate list. Below this,
  // a match is noise, not a weak lead.
  floor: 0.55,
  // A candidate at or above this, clearly ahead of the runner-up (see
  // clearMargin below), is reported as status: 'high_confidence'. This is
  // advisory to the consumer only — the library never auto-confirms (spec
  // §7.1) regardless of this threshold.
  highConfidence: 0.92,
  // Minimum score gap between the #1 and #2 candidate required to call the
  // #1 candidate "clearly ahead" rather than merely the best of an ambiguous
  // pack.
  clearMargin: 0.08,
} as const;

export const TOKEN_MATCH = {
  // Two tokens are treated as "the same word" (for evidence text and
  // per-token match counting) when their normalized edit-distance
  // similarity is at or above this — tolerates minor typos without treating
  // genuinely different words as equal.
  perTokenFuzzyThreshold: 0.8,

  // Master-planned communities register each tower/precinct as "<Name> @
  // The <Community>" (verified live: 9 real Prestige City sub-projects, plus
  // the same pattern for Brigade El Dorado, Purva Park Hill, Total
  // Environment's phases). A short query like "Prestige City" is then a
  // strict subset of a much longer registered name, and the symmetric
  // best-match average above unfairly drags that down just for having fewer
  // tokens than the candidate. A separate "containment" score (how well the
  // query alone is explained by the candidate, ignoring the candidate's
  // extra tokens) is taken instead whenever it beats the symmetric score.
  //
  // Eligibility for that boost is gated on the query's TOTAL TOKEN WEIGHT,
  // not raw token count — otherwise a single generic word ("City") would
  // cheaply "contain-match" anything, while a single rare, genuinely
  // distinctive word ("Keerthi" — a real builder brand appearing in only 7
  // of 8,836 real registered project names) would wrongly be blocked just
  // for being one token. Weight comes from tokenStats.ts's IDF-style
  // corpus-frequency calculation when a resolve() caller has real index
  // stats available; callers without corpus stats (e.g. isolated matcher
  // unit tests) fall back to defaultTokenWeight per token.
  //
  // Calibration (measured against the real ~8.8k-record index, 2026-07):
  //   single "phase"    (df  989) -> weight ~3.19  -> below gate (correct: too generic)
  //   single "layout"   (df  558) -> weight ~3.76  -> below gate (correct: too generic)
  //   single "city"     (df  261) -> weight ~4.52  -> below gate (correct: too generic)
  //   single "prestige" (df   90) -> weight ~5.58  -> below gate (a real brand, but
  //                                                    still ~90 real candidates —
  //                                                    left to symmetric scoring,
  //                                                    not boosted)
  //   single "keerthi"  (df    7) -> weight ~8.01  -> ABOVE gate (correct: genuinely
  //                                                    distinctive single word)
  // defaultTokenWeight=4 keeps existing no-corpus-stats callers behaving
  // exactly as the old "need >= 2 tokens" rule did (2*4=8 passes, 1*4=4
  // fails), so isolated unit tests are unaffected by this change.
  containmentMinQueryWeight: 6.5,
  containmentDiscount: 0.95,
  defaultTokenWeight: 4,
} as const;

export const PROMOTER_HINT = {
  // When hints.promoterName is supplied, the final score blends the
  // project-name token-set score with a promoter-name token-set score at
  // these weights (spec §6 Tier 2: "optionally weight/boost when
  // hints.promoterName also matches"). Name match dominates since the
  // promoter hint is corroborating evidence, not the primary signal.
  nameWeight: 0.8,
  promoterWeight: 0.2,
} as const;

// Caps on how many candidates resolve()/projectsByPromoter() return, to keep
// the ranked list usable rather than dumping hundreds of near-zero-score
// rows from a ~13k-record scan.
export const MAX_CANDIDATES = 10;
export const MAX_WEAK_CANDIDATES = 5;

// Tier 3 (LLM semantic bridge, spec §6). Kept in this single config location
// like every other matcher tunable.
export const MAX_LLM_SHORTLIST = 30;

// ensureIndex()'s staleness gate. The portal itself doesn't publish updates
// faster than this, so a snapshot older than this is worth a background
// refresh but is not itself untrustworthy — ensureIndex() keeps serving the
// existing snapshot while a refresh runs, never blocking a caller on it.
export const INDEX_MAX_AGE_DAYS = 7;

// Fixed score assigned to every llm_semantic candidate, deliberately between
// `floor` (0.55) and `highConfidence` (0.92). This means an LLM-sourced
// match can surface as a real, ranked candidate but can never by itself
// produce status: 'high_confidence' — an extra safety margin appropriate
// for a reasoned guess rather than a deterministic token/exact match, on top
// of the library's existing "never auto-confirm" rule.
export const LLM_MATCH_SCORE = 0.75;
