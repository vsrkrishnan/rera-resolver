import type {
  Candidate,
  IndexRecord,
  LlmClient,
  LlmMatchResponse,
  LlmShortlistEntry,
  ResolveHints,
} from './types.js';
import { MATCH_THRESHOLDS, MAX_LLM_SHORTLIST, LLM_MATCH_SCORE } from './config.js';
import { rankAndDedupe, scorePromoterMatch } from './matcher.js';
import type { TokenWeightFn } from './textSimilarity.js';

// Tier 3 shortlist (spec §6): grounding context for the LLM, built entirely
// from local, zero-cost sources — Tier 2's own candidates (even the
// below-floor ones, since "plausible" here just means "worth showing", not
// "worth returning") plus, when the caller supplies a promoter hint, that
// promoter's full real project list. Capped so the prompt stays small.
//
// This is NOT the boundary that keeps the LLM honest — see
// runLlmSemanticBridge below, which validates against the FULL index. A
// query with zero token overlap and no promoter hint will produce an empty
// or near-empty shortlist here; that's expected, not a bug, since nothing
// local can narrow that case down.
export function buildShortlist(
  hints: ResolveHints | undefined,
  records: IndexRecord[],
  tier2Candidates: Candidate[],
  tokenWeightFn?: TokenWeightFn,
): LlmShortlistEntry[] {
  const byRegNumber = new Map<string, LlmShortlistEntry>();

  const addAll = (candidates: Candidate[]) => {
    for (const c of candidates) {
      if (byRegNumber.size >= MAX_LLM_SHORTLIST) return;
      if (byRegNumber.has(c.regNumber)) continue;
      byRegNumber.set(c.regNumber, {
        regNumber: c.regNumber,
        registeredName: c.registeredName,
        promoterName: c.promoterName,
      });
    }
  };

  addAll(tier2Candidates);

  if (hints?.promoterName) {
    const promoterMatches = rankAndDedupe(
      records.map((r) => scorePromoterMatch(hints.promoterName!, r, tokenWeightFn)),
    ).filter((c) => c.matchScore >= MATCH_THRESHOLDS.floor);
    addAll(promoterMatches);
  }

  return Array.from(byRegNumber.values());
}

export interface LlmBridgeOutcome {
  candidates: Candidate[];
  // null when the LLM call itself failed (network error, thrown exception,
  // etc.) — distinguished from "not attempted" by the caller, which only
  // invokes this function when it has already decided Tier 3 applies.
  response: LlmMatchResponse | null;
}

// Runs the actual Tier 3 call and enforces the one non-negotiable rule (spec
// §6): every regNumber the LLM returns is checked against the REAL, FULL
// index before it can become a Candidate — never just the shortlist we sent
// it, since the LLM is deliberately allowed to name something outside that
// shortlist from its own world knowledge (the whole reason this tier
// exists). Anything that doesn't resolve to a real record is silently
// discarded, never surfaced, never fabricated into a partial result.
export async function runLlmSemanticBridge(
  name: string,
  hints: ResolveHints | undefined,
  shortlist: LlmShortlistEntry[],
  records: IndexRecord[],
  llmClient: LlmClient,
): Promise<LlmBridgeOutcome> {
  let response: LlmMatchResponse;
  try {
    response = await llmClient.matchShortlist({ query: name, hints, shortlist });
  } catch {
    return { candidates: [], response: null };
  }

  const byRegNumber = new Map(records.map((r) => [r.regNumber, r]));
  const candidates: Candidate[] = [];
  for (const match of response.matches) {
    const record = byRegNumber.get(match.regNumber);
    if (!record) continue;
    candidates.push({
      regNumber: record.regNumber,
      registeredName: record.registeredName,
      promoterName: record.promoterName,
      dataset: record.dataset,
      state: record.state,
      matchScore: LLM_MATCH_SCORE,
      matchTier: 'llm_semantic',
      evidence: `LLM semantic match: ${match.reasoning}`,
    });
  }

  return { candidates, response };
}
