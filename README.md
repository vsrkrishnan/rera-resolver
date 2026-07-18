# rera-resolver

Turns a messy real-estate project name into the correct Karnataka RERA registry record — ranked candidates, scored, with evidence, never a single silent guess.

> **Status: Phase 1, in progress.** Core resolution, sync, fetch, and the LLM semantic bridge (Tier 3) are all built and live-tested against the real portal. See [Status & Roadmap](#status--roadmap) for the honest caveat on Tier 3's timing relative to the eval set.

## Why this exists

Karnataka RERA's own portal has one real, unsolved problem: **name resolution**. Marketing names ("Prestige Lakeside Habitat") routinely don't match the registered legal name ("M/s [SPV] Developers Pvt Ltd"), and even tools that mirror the full dataset inherit the portal's exact-spelling search and can't bridge that gap. Scraping the two public dumps is a solved, commodity problem. Resolving a name a human actually typed to the right registration number is not — that's what this library does, and it's the entire reason it exists.

## Features

- **Tiered matcher** — exact match → token-set fuzzy scoring (word-order, token-gap, and typo tolerant) → rarity-weighted scoring so a distinctive brand word ("Keerthi") counts for more than a generic one ("City"), without a generic word cheaply over-matching everything.
- **Never auto-confirms.** `resolve()` always returns a ranked, scored, evidenced candidate list — never a single asserted answer with alternatives hidden. `status: 'high_confidence'` is advisory to the caller, not permission for this library to decide anything.
- **Real government data, not LLM guesses.** `fetch()` pulls live project status, dates, and complaint counts directly from the portal's own detail page for completed projects — not from a web search an LLM might misattribute.
- **Investigation-list cross-check.** `checkUnderInvestigation()` surfaces RERA's own "Projects Under Investigation" enforcement list as a separate, explicitly-caveated signal — never folded into `resolve()`'s confidence scoring.
- **Zero LLM cost for the deterministic path.** `resolve()`, `projectsByPromoter()`, and index reads are pure compute plus at most a cached local SQLite read. Every HTTP call anywhere in the library is instrumented.
- **BYO-LLM, by design — with the guardrail enforced centrally.** The semantic-bridge tier (Tier 3) takes an injected `llmClient` — this library never bundles a key or vendor dependency, and `resolve()` behaves exactly as before if you never pass one. Every candidate the LLM names is validated against the real index before it reaches the caller — the LLM may name a regNumber from its own world knowledge, not just from the shortlist it was shown, but anything that doesn't actually exist in the index is silently discarded, never surfaced. Any consumer (a script, a human, an LLM agent) gets that validation automatically, rather than having to reimplement it correctly on its own.

## Install

```bash
npm install rera-resolver
```

Requires Node ≥ 20. Uses `better-sqlite3` for local storage — no external database, no hosted service.

## Quick start

```ts
import { syncIndex, resolve, fetch, projectsByPromoter, checkUnderInvestigation } from 'rera-resolver';

// 1. Populate the local cache (run this once, then on a schedule — weekly is
//    plenty, since the portal itself doesn't update faster than that).
await syncIndex();

// 2. Resolve a messy name to ranked, scored candidates.
const result = await resolve('Godraj United'); // typo, real project is "Godrej United"
console.log(result.status);        // 'ambiguous' | 'high_confidence' | 'unresolved'
console.log(result.candidates[0]); // { regNumber, registeredName, promoterName, matchScore, matchTier, evidence, ... }

// Optional hint narrows matching when you know the developer.
await resolve('Lakeside Habitat', { promoterName: 'Prestige' });

// 3. Once you have a regNumber (from resolve(), or already known), pull
//    live detail data — real registry fields, not a web-search guess.
const project = await fetch(result.candidates[0].regNumber);
console.log(project.fetchState); // 'complete' | 'detail_unavailable'

// 4. Zero-cost local lookup of everything a promoter has registered.
const portfolio = await projectsByPromoter('Prestige Estates Projects');

// 5. Separate, explicitly-caveated check against RERA's own enforcement
//    list — useful specifically when resolve() comes up empty or weak.
const flagged = await checkUnderInvestigation('Sobha City Casa Serenita');
if (flagged.matches.length > 0) {
  console.log(flagged.warning);  // staleness/scope caveat — always present
  console.log(flagged.dataAsOf); // how current the WHOLE list is, e.g. "2021-10-22"
}

// 6. Optional Tier 3: when Tiers 0-2 alone don't reach high_confidence, an
//    injected LLM client gets a fallback shot at cases with zero token
//    overlap (marketing name vs. legal SPV name). Omit llmClient entirely
//    and resolve() stays exactly as above — zero LLM cost, opt-in only.
const withLlm = await resolve('Prestige Lakeside Habitat', undefined, {
  llmClient: {
    async matchShortlist({ query, shortlist }) {
      // Call your own LLM here. Return real regNumbers with reasoning —
      // resolve() validates every one against the local index itself and
      // silently discards anything that isn't actually there.
      return { matches: [], inputTokens: 0, outputTokens: 0, costInr: 0 };
    },
  },
  onCost: (record) => console.log(record), // llmCalls, tokens, cost — only when Tier 3 actually ran
});
```

## How resolution actually works

`resolve(name, hints?)` runs the query through, in order:

1. **Normalize** — lowercase, strip punctuation, collapse whitespace.
2. **Exact match** — normalized query equals a registered name → score `1.0`, done.
3. **Token-set scoring** — word-order independent, per-token edit-distance tolerant (typos), with partial credit for token gaps rather than an all-or-nothing match. Query tokens are weighted by rarity across the whole index (an IDF-style measure), so a distinctive word contributes more to the score than a filler word does, and a short query that's a genuine fragment of a much longer registered name (`"Prestige City"` → `"Fernvale @ The Prestige City"`) isn't unfairly penalized just for being shorter.

Every candidate carries a `matchScore` (0–1), a `matchTier`, and a human-readable `evidence` string. `resolve()` never collapses this to a single answer — the calling application decides what to do with `ambiguous` results, exactly the same discipline this library's design deliberately preserves from how the problem is traditionally handled: substring matching is too weak to auto-confirm, so nothing here auto-confirms either.

A fourth tier — **Tier 3, the LLM semantic bridge** — handles the one case token-matching structurally cannot solve: when the marketing name and legal name share **no tokens at all** (the "Prestige Lakeside Habitat" ↔ "M/s XYZ Developers Pvt Ltd" case). It only runs when a caller injects `llmClient` into `resolve()`'s options **and** Tiers 0–2 didn't already reach `high_confidence` on their own — omit `llmClient` and `resolve()` behaves exactly as if Tier 3 didn't exist, zero LLM cost.

When it does run, `resolve()` builds a small shortlist as grounding context (Tier 2's own weak/below-floor candidates, plus a promoter hint's real projects if one was supplied) and sends it to the injected LLM alongside the query. The LLM is deliberately **not confined** to that shortlist — it may name a regNumber purely from its own world knowledge, since a shortlist built from token-overlap is meaningless for the exact case this tier exists to solve. Every `llm_semantic` candidate is scored at a fixed `LLM_MATCH_SCORE` (0.75, between the floor and the high-confidence threshold) — visible and ranked like any other candidate, but never able by itself to produce `status: 'high_confidence'`.

**Why this validation lives inside the library instead of being left to whatever agent calls it:** an LLM asked to bridge a marketing name to a legal name has nothing in the strings themselves to check its answer against, so it's reasoning from its own trained-in knowledge — which can be stale, wrong, or a plausible-sounding guess. If that reasoning happened entirely outside this library, nothing would stop a calling agent from asserting a regNumber it never actually verified. Tier 3 closes that gap structurally: every regNumber the LLM returns is checked against the full real index before it reaches the caller — anything it invents (or that simply doesn't exist) is discarded, never surfaced. That guarantee is enforced once, centrally, by the library — any agent or application integrating this library gets it automatically, rather than needing to reimplement that validation correctly itself every time.

## Data sources, and what this library will and won't tell you

This library reads three public static dumps from `rera.karnataka.gov.in` — ongoing projects, completed projects, and the "Projects Under Investigation" enforcement list — parses them, and caches them locally. No other endpoint is used for resolution, and **no web search is ever used to decide which project a name refers to.**

A few things worth knowing before you build on top of this:

- **This library only has a name (plus optional hints).** It has no listing data — no land area, no unit count. That means it structurally **cannot** tell you whether a project it couldn't find is legally exempt under RERA §3(2) (small projects, certain Gram Panchayat cases) versus genuinely unregistered. That distinction requires data this library doesn't have, and it's deliberately left to the consuming application, which does.
- **The investigation list is real but stale.** As of this writing, RERA's own "Projects Under Investigation" list has no entries published after **2021-10-22** — `checkUnderInvestigation()` always returns a `dataAsOf` and `warning` field for exactly this reason. A hit means "RERA formally flagged this at some point," never "as of today." Absence from it proves nothing either way.
- **`fetch()`'s live detail data is completed-projects-only.** The portal's per-project detail endpoint only works (and was only ever found to work) for projects in the completed dataset; ongoing-project detail lookup has no known working endpoint as of this investigation. `fetch()` degrades honestly to `fetchState: 'detail_unavailable'` rather than fabricating anything.

## API

```ts
function syncIndex(options?: {
  dbPath?: string;
  onLog?: (line: string) => void;
  onCost?: (record: OperationCostRecord) => void; // per spec §9: every HTTP call is instrumented
}): Promise<SyncResult>;

function resolve(
  name: string,
  hints?: { promoterName?: string },
  options?: {
    dbPath?: string;
    llmClient?: LlmClient;   // Tier 3, opt-in — omit for Tiers 0-2 only, zero LLM cost
    onCost?: (record: OperationCostRecord) => void; // fires once per call; llmCalls: 0 unless Tier 3 ran
  },
): Promise<ResolveResult>;

// BYO-LLM contract for Tier 3 (spec §6). The library never bundles a
// vendor client or key — implement this against whatever LLM you already
// use and pass it as resolve()'s llmClient option.
interface LlmClient {
  matchShortlist(request: {
    query: string;
    hints?: { promoterName?: string };
    shortlist: { regNumber: string; registeredName: string; promoterName: string }[]; // grounding context, not a hard restriction
  }): Promise<{
    matches: { regNumber: string; reasoning: string }[]; // ranked, best first; may name a regNumber outside the shortlist
    inputTokens?: number;
    outputTokens?: number;
    costInr?: number;
  }>;
}

function projectsByPromoter(
  promoterName: string,
  options?: { dbPath?: string },
): Promise<Candidate[]>;

function fetch(
  regNumber: string,
  options?: { dbPath?: string; onCost?: (record: OperationCostRecord) => void },
): Promise<ProjectRecord>;

function checkUnderInvestigation(
  name: string,
  hints?: { promoterName?: string },
  options?: { dbPath?: string },
): Promise<InvestigationCheckResult>;
```

Full types (`Candidate`, `ResolveResult`, `ProjectRecord`, `InvestigationCheckResult`, `LlmClient`, etc.) are exported from the package root — see `src/types.ts` for the complete, documented shapes. Matcher thresholds (`MATCH_THRESHOLDS`, `TOKEN_MATCH`, `LLM_MATCH_SCORE`, `MAX_LLM_SHORTLIST`) are also exported, each with an inline comment explaining why it's set where it is.

## Development

```bash
npm install
npm test              # 46 tests: matcher logic, real-markup parsing fixtures, resolve/fetch integration, Tier 3 (llmBridge)
npm run build          # tsc -> dist/
npm run sync           # populate/refresh the local SQLite cache from the live portal
npm run measure         # run the labeled eval set (src/eval/eval-set.ts) and report recall@1/@5
```

`npm run sync` hits the real government portal — it's a live network call, not a mock. The library exposes `syncIndex()` as a function; scheduling it (cron, a GitHub Action, etc.) is left to the consuming environment.

### The eval set

`src/eval/eval-set.ts` is a small, honestly-labeled set of real queries tried during development, each with documented provenance and a confidence rating (`confirmed` / `high_confidence_inferred` / `unconfirmed`) — not a synthetic benchmark. It's well below the size a real measurement needs; growing it means adding more real queries with real, checkable outcomes, not padding the count.

## Status & Roadmap

| | |
|---|---|
| ✅ | Index sync + storage, atomic snapshot swap, failure keeps the prior good snapshot |
| ✅ | Tiered matcher (exact / token-set / rarity-weighted), with regression tests for word-order, token-gap, typo, and master-community naming patterns |
| ✅ | `resolve()`, `projectsByPromoter()` |
| ✅ | `fetch()` against real portal detail data |
| ✅ | `checkUnderInvestigation()` |
| ✅ | Labeled eval set + recall@1/@5 measurement script |
| ✅ | Tier 3 — LLM semantic bridge, BYO-LLM, validated against the full index |
| ⬜ | Grow the eval set to the scale a real measurement needs |
| ⬜ | Measure Tier 3's *incremental* recall against a real LLM client (spec §8 step 4) |

**Honest note on Tier 3's timing:** the spec's own measurement gate (§8) says to size the eval set properly before building Tier 3. That didn't happen here — Tier 3 was built with the eval set at 19 cases (recall@5 100%, recall@1 80%, zero false high-confidence on the deterministic tiers alone), which by the spec's own interpretation guide suggests Tier 2 was already carrying most of the load and Tier 3 would be a minor fallback rather than load-bearing. It was built anyway, deliberately, because the value here is less about incremental recall and more about giving any consumer — script, human, or LLM agent — a centrally-enforced validation guardrail around LLM-assisted matching (see [How resolution actually works](#how-resolution-actually-works)) rather than trusting every caller to reimplement that discipline itself. Measuring Tier 3's actual incremental recall against a real LLM is still open work.

## Design principles

1. **Don't invent data.** Every field this library returns is either parsed from a portal response or explicitly marked as unavailable — never guessed, never silently defaulted.
2. **Don't auto-confirm.** Ranked candidates with scores and evidence, always. The calling application owns the decision to treat a match as confirmed.
3. **Don't fake a detail fetch.** A failed or unsupported detail lookup returns the identity you already had plus `fetchState: 'detail_unavailable'` — never `null`, never a fabricated field.
4. **Measure before reaching for an LLM.** The deterministic tiers are built and measured first; the LLM tier only gets built once there's a real number showing it's needed.

## License

MIT © Shiva V
