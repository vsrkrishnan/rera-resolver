# rera-resolver

Turns a messy real-estate project name into the correct Karnataka RERA registry record — ranked candidates, scored, with evidence, never a single silent guess.

> **Status: Phase 1, in progress.** Core resolution, sync, and fetch are built and live-tested against the real portal. The LLM semantic bridge (Tier 3) is intentionally not built yet — see [Status & Roadmap](#status--roadmap).

## Why this exists

Karnataka RERA's own portal has one real, unsolved problem: **name resolution**. Marketing names ("Prestige Lakeside Habitat") routinely don't match the registered legal name ("M/s [SPV] Developers Pvt Ltd"), and even tools that mirror the full dataset inherit the portal's exact-spelling search and can't bridge that gap. Scraping the two public dumps is a solved, commodity problem. Resolving a name a human actually typed to the right registration number is not — that's what this library does, and it's the entire reason it exists.

## Features

- **Tiered matcher** — exact match → token-set fuzzy scoring (word-order, token-gap, and typo tolerant) → rarity-weighted scoring so a distinctive brand word ("Keerthi") counts for more than a generic one ("City"), without a generic word cheaply over-matching everything.
- **Never auto-confirms.** `resolve()` always returns a ranked, scored, evidenced candidate list — never a single asserted answer with alternatives hidden. `status: 'high_confidence'` is advisory to the caller, not permission for this library to decide anything.
- **Real government data, not LLM guesses.** `fetch()` pulls live project status, dates, and complaint counts directly from the portal's own detail page for completed projects — not from a web search an LLM might misattribute.
- **Investigation-list cross-check.** `checkUnderInvestigation()` surfaces RERA's own "Projects Under Investigation" enforcement list as a separate, explicitly-caveated signal — never folded into `resolve()`'s confidence scoring.
- **Zero LLM cost for the deterministic path.** `resolve()`, `projectsByPromoter()`, and index reads are pure compute plus at most a cached local SQLite read. Every HTTP call anywhere in the library is instrumented.
- **BYO-LLM, by design.** The (not-yet-built) semantic-bridge tier takes an injected LLM client — this library never bundles a key or vendor dependency.

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
```

## How resolution actually works

`resolve(name, hints?)` runs the query through, in order:

1. **Normalize** — lowercase, strip punctuation, collapse whitespace.
2. **Exact match** — normalized query equals a registered name → score `1.0`, done.
3. **Token-set scoring** — word-order independent, per-token edit-distance tolerant (typos), with partial credit for token gaps rather than an all-or-nothing match. Query tokens are weighted by rarity across the whole index (an IDF-style measure), so a distinctive word contributes more to the score than a filler word does, and a short query that's a genuine fragment of a much longer registered name (`"Prestige City"` → `"Fernvale @ The Prestige City"`) isn't unfairly penalized just for being shorter.

Every candidate carries a `matchScore` (0–1), a `matchTier`, and a human-readable `evidence` string. `resolve()` never collapses this to a single answer — the calling application decides what to do with `ambiguous` results, exactly the same discipline this library's design deliberately preserves from how the problem is traditionally handled: substring matching is too weak to auto-confirm, so nothing here auto-confirms either.

A fourth tier — LLM-assisted semantic matching for cases where the marketing name and legal name share **no tokens at all** (the "Prestige Lakeside Habitat" ↔ "M/s XYZ Developers Pvt Ltd" case token-matching structurally cannot solve) — is planned but gated on measuring how far the deterministic tiers get first. See [Status & Roadmap](#status--roadmap).

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
  options?: { dbPath?: string },
): Promise<ResolveResult>;

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

Full types (`Candidate`, `ResolveResult`, `ProjectRecord`, `InvestigationCheckResult`, etc.) are exported from the package root — see `src/types.ts` for the complete, documented shapes. Matcher thresholds (`MATCH_THRESHOLDS`, `TOKEN_MATCH`) are also exported, each with an inline comment explaining why it's set where it is.

## Development

```bash
npm install
npm test              # 35 tests: matcher logic, real-markup parsing fixtures, resolve/fetch integration
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
| ⬜ | Grow the eval set to the scale a real measurement needs |
| ⬜ | Tier 3 — LLM semantic bridge (gated on the above) |
| ⬜ | REKI integration (swap-in replacement for its existing substring matcher) |

## Design principles

1. **Don't invent data.** Every field this library returns is either parsed from a portal response or explicitly marked as unavailable — never guessed, never silently defaulted.
2. **Don't auto-confirm.** Ranked candidates with scores and evidence, always. The calling application owns the decision to treat a match as confirmed.
3. **Don't fake a detail fetch.** A failed or unsupported detail lookup returns the identity you already had plus `fetchState: 'detail_unavailable'` — never `null`, never a fabricated field.
4. **Measure before reaching for an LLM.** The deterministic tiers are built and measured first; the LLM tier only gets built once there's a real number showing it's needed.

## License

MIT © Shiva V
