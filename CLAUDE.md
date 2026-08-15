# rera-resolver

> Standalone library that resolves messy Indian RERA project names to registry records, via a
> tiered deterministic/LLM matcher over a local SQLite index. MIT, published to npm.

**Default branch:** `main` | **Version:** 0.1.0

---

## Current state

Karnataka (reference adapter) and Tamil Nadu are implemented. Maharashtra is declared but
`undefined` in [src/adapters/registry.ts](src/adapters/registry.ts) — `getAdapter('MH')` throws a
clear error rather than silently crawling the wrong registry. **Next: Maharashtra.** Use the
`add-state-adapter` skill; it encodes the sequence and the gate. (If the skill or this file drifts
from the code — the seam has evolved twice — fix the doc as part of the work.)

Tamil Nadu is the worked precedent for a second, structurally-different portal. It forced **two
deliberate seam extensions**, in order:
1. `Dataset` gained a neutral `'registered'` value (TN has no ongoing/completed split).
2. The adapter crawl model became **`sources: CrawlSource[]`** — each source self-describes its own
   `fetch`, `parse`, and `sanityFloor` — replacing the old `datasets`/`fetchList`/`parseList`/
   `sanityFloors.perDataset` quartet. This decouples a *crawl sub-source* from the record-level
   `Dataset` label, so a state can carve arbitrary crawl topologies (TN has **three** sources:
   `online`, `offline-building`, `offline-layout`) without the shared `Dataset` union growing per
   state. Expect Maharashtra to need little or no seam change if it fits `sources[]` + `fetchDetail`.

**TN coverage is deep.** Both the online e-registered tables (~3.4k, reg `TNRERA/…`) **and** the
offline paper-filed archives (per-year 2017–2025, ~14k, reg `TN/…`) = **~17.6k records**. Online
detail is a rich "Form A" parse (~16 fields: stage of construction, dwelling units, site extent,
usage, RERA bank name/branch, plus a polymorphic promoter — CIN/GSTIN, CEO or partner/director
list, contact). Offline detail comes from the **list row itself** — GPS (hand-typed DMS →
decimal, ~40% of rows), completion date, current status, **no OCR** — plus scanned-PDF links
surfaced as `ProjectRecord.documents`. The only OCR/LLM-gated tier is the *contents* of those
offline scanned PDFs.

Baseline as of 2026-08-15 (uncommitted work on `feat/tamil-nadu-adapter`, atop commit `01a85ff`):

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npm test` | 90/93 pass, 3 skipped by default. Suites: **common 35, karnataka 29, tamilnadu 29** (see Conventions). |
| `npm run measure` | 24 cases. **Karnataka portion unchanged: recall@1 8/10, recall@5 10/10, no-false-high-confidence 9/9.** Aggregate (KA+TN) recall@1 11/13, recall@5 13/13, no-false 11/11. |

The KA numbers above are the invariant: any state work that moves them touched shared engine/config
and must be reverted, not re-baselined.

**Real-data test gap — closed (2026-08-15).** The eval set covers *resolution* (name → regNumber)
against the real index; detail *parsing* is now covered at two more layers too:
[realFixtures.test.ts](src/__tests__/tamilnadu/realFixtures.test.ts) runs all four TN parsers
against real HTML captured live from rera.tn.gov.in (trimmed of inert chrome only, verified
parser-output-identical to the untrimmed capture before committing — fixtures live in
`src/__tests__/tamilnadu/fixtures/`), and
[liveSmoke.test.ts](src/__tests__/tamilnadu/liveSmoke.test.ts) hits the real portal right now to
confirm `fetchDetail`'s enrichment is still there — gated behind `RERA_LIVE_TESTS=1` (the 3 tests
skipped in the count above), never part of ordinary `npm test`/CI.

---

## Locked invariants — do not re-litigate

These are load-bearing. Each was decided deliberately and several were learned the hard way; the
reasoning lives in comments at the cited locations.

| Invariant | Where | Why |
|---|---|---|
| **A match is never auto-confirmed.** `resolve()` always returns a `status` plus a full ranked `candidates` array. `status: 'high_confidence'` is advisory to the consumer, nothing more. | [src/config.ts](src/config.ts), [docs/caveats.md](docs/caveats.md) | Legal/financial consequence. The consumer decides, not the library. |
| **A sanity floor is parser-break protection, not a tuning knob.** Each `CrawlSource` carries its own `sanityFloor`; a source parsing fewer records than its floor keeps the prior snapshot and returns `ok: false`. Per-source, so one pool's break can't be masked by another's volume. | [src/adapters/types.ts](src/adapters/types.ts), [src/syncIndex.ts](src/syncIndex.ts) | Portal HTML changes without notice. Never lower a floor to make a sync pass — that swaps a near-empty index in for a good one. |
| **The eval bar for absence cases is "never falsely asserts `high_confidence`"** — *not* "must return `unresolved`". An `ambiguous` result with weak, hedged candidates is honest behavior. | [src/eval/eval-set.ts](src/eval/eval-set.ts) | Learned against `measure.ts`'s first run. A query sharing a real brand token with real same-developer projects legitimately comes back ambiguous; labeling that a regression is a false alarm. |
| **The engine is state-agnostic.** `syncIndex`, `resolve`, `matcher`, `storage`, `fetchProject`, `fetchPromoter` drive states only through the `StateAdapter` interface — iterating `adapter.sources` opaquely and calling `adapter.fetchDetail`. Adding a state means writing an adapter, never editing the engine. | [src/adapters/types.ts](src/adapters/types.ts) | The whole point of the seam. Engine edits during state work are the signal something is wrong (a *deliberate, separately-reviewed* seam extension is the sanctioned exception). |
| **Eval cases require real verified provenance.** Every case records how its label was verified and an honest `confidence`. No synthetic padding to hit a case count. | [src/eval/eval-set.ts](src/eval/eval-set.ts) | 24 real cases (19 KA + 5 TN) with provenance beat 50 invented ones. Each `EvalCase` carries its `state`; `measure` resolves it against that state's index. |
| **Missing data is omitted, never faked.** An unconfirmed field is `undefined`, not `null`, `""`, or a guess. `fetchState` / `PromoterFetchState` report partial success. | [src/types.ts](src/types.ts) | Honesty contract (spec §7.2 / §5.3). |
| **Matcher thresholds live in exactly one place.** | [src/config.ts](src/config.ts) | Spec §5.1 hard rule. Never inline a threshold at a call site. |
| **No web search decides a match.** Tier 3 is a bring-your-own `LlmClient`; the library bundles no vendor or key, and every LLM-named `regNumber` is validated against the local index before it reaches a caller. | [src/llmBridge.ts](src/llmBridge.ts), [docs/caveats.md](docs/caveats.md) | Groundedness. An LLM may name a real project outside the shortlist — that's the point of the tier — but never a hallucinated one. |

---

## Architecture

```
resolve(name, hints?)
    │
    ├─ Tier 0  exact / normalized-exact          ─┐
    ├─ Tier 1  token-set fuzzy (typo-tolerant)    │ deterministic, local index only,
    ├─ Tier 2  corpus-rarity (IDF) token weights ─┘ zero network, zero LLM cost
    └─ Tier 3  optional LLM semantic bridge        opt-in via ResolveOptions.llmClient
                                                  fixed score 0.75 — can never alone
                                                  reach high_confidence
    ▼
ranked Candidate[] + status + evidence string per candidate
```

**Layers.** The state-agnostic engine sits above a per-state adapter:

- **Engine** — [resolve.ts](src/resolve.ts) (172 lines), [matcher.ts](src/matcher.ts) (132),
  [syncIndex.ts](src/syncIndex.ts) (145), [storage.ts](src/storage.ts),
  [tokenStats.ts](src/tokenStats.ts) (IDF weights), [ensureIndex.ts](src/ensureIndex.ts).
- **Adapter seam** — [adapters/types.ts](src/adapters/types.ts) defines the `StateAdapter`
  interface; [adapters/registry.ts](src/adapters/registry.ts) is the single place that knows which
  states exist; [adapters/karnataka.ts](src/adapters/karnataka.ts) and
  [adapters/tamilnadu.ts](src/adapters/tamilnadu.ts) are pure wiring (no parse/fetch logic of their
  own).
- **State primitives** — each state's fetch + parse modules, assembled by its adapter. Karnataka:
  [registryFetch.ts](src/registryFetch.ts), [parse.ts](src/parse.ts),
  [parseProjectDetails.ts](src/parseProjectDetails.ts) (in `src/` for historical reasons). Tamil
  Nadu: [adapters/tamilnadu/](src/adapters/tamilnadu/) (`fetch.ts`, `parseList.ts`,
  `parseDetail.ts`) — new states follow this layout. Unit-tested in place.

**Four adapter details worth knowing before writing a new state:**

- **The crawl is a list of `sources: CrawlSource[]`.** Each source is `{ id, sanityFloor, fetch,
  parse }` and the engine iterates them opaquely — it never branches on a source's `id`. This is
  how a state expresses its crawl topology: Karnataka = two sources (`ongoing`, `completed`); Tamil
  Nadu = three (`online`, `offline-building`, `offline-layout`), the last two sharing one parser.
  A source's `fetch` may hit one URL or many (TN's offline sources fan out across ~19 year-pages).
  This deliberately decouples a *crawl sub-source* from the record `Dataset` label — so adding a
  state's novel partitioning never grows the shared `Dataset` union.
- **Detail fetching is encapsulated in one member: `fetchDetail(record) -> { detail, promoter } | null`.**
  The adapter owns the entire mechanism — so the engine (`fetchProject`) never learns a portal's
  shape. Karnataka does an id lookup (completed rows carry `completedRowId`; ongoing rows need an
  extra `fetchOngoingProjectId` call) then parses one page into both. Tamil Nadu fetches **two**
  separately-keyed pages for *online* projects, but for *offline* projects assembles the detail
  from the record's own stored fields **with no network** (see `detailRefs`). Do what the portal
  requires — don't reflexively copy a shape.
- **`IndexRecord.detailRefs`** (a generic `Record<string,string>` bag, persisted as a JSON column)
  routes *and* carries per-row detail. Tamil Nadu uses it three ways: online detail-page URLs
  (`{ project, promoter }`, read back in `fetchDetail`); offline **data values** parsed from the
  list row (`lat`, `long`, `status`, `endDate` — table-borne, no OCR); and official scanned-PDF
  URLs. `fetchProject` surfaces any `.pdf` entry (only those) as `ProjectRecord.documents`.
  Karnataka uses `completedRowId` for its own routing.
- **`Dataset` is now purely the record's *kind* label** (`'ongoing' | 'completed' | 'registered'`),
  not a crawl key — TN's online and offline records are both `'registered'`. Adding a `Dataset`
  value, or any seam/interface change, is a *deliberate, separately-reviewed* edit to engine/type
  files — the sanctioned exception to "never edit the engine," not a license to branch on state.
- Storage is per-state: `resolveDbPathForState(state)` yields `index-<state>.db` under
  `RERA_RESOLVER_DB_DIR` (or the OS cache dir), unless `RERA_RESOLVER_DB_PATH` pins a single file
  (single-state mode). Snapshots round-trip `state` through a meta key and stamp it onto every
  record on read; a state-less older snapshot reads back as `KA`.

---

## Commands

```bash
npm run build                    # tsc -> dist/
npx tsc --noEmit                 # fast typecheck gate
npm test                         # 86 tests; uses temp DBs/fixtures, no index or network needed
npm run sync -- --state <code>   # crawl one state's live portal -> data/index-<state>.db (default KA)
npm run measure                  # §8 eval gate — run before AND after matcher work
```

The `sync` and `measure` scripts set `RERA_RESOLVER_DB_DIR=data`, so each state's index is a
separate file `data/index-<state>.db` (Karnataka is `data/index-ka.db`). `measure` resolves each
eval case against its own state's index and runs Tiers 0–2 only — no LLM, no network. When invoking
`node`/`tsx` directly, set `RERA_RESOLVER_DB_DIR=data` yourself (or `RERA_RESOLVER_DB_PATH=<file>`
to pin a single-state file).

## Conventions

- ESM, `.js` extensions on all relative imports (TS with `"type": "module"`).
- Node's built-in test runner (`node:test` + `node:assert/strict`), not a framework. Tests live in
  three suites under [src/__tests__/](src/__tests__/): **`common/`** (state-agnostic engine —
  matcher, tokenStats, resolve, state/storage, llmBridge), **`karnataka/`** and **`tamilnadu/`**
  (each state's list/detail/parse tests). A new state adds a `tamilnadu/`-shaped folder; shared
  engine tests go in `common/`. Most parser tests use small hand-written fixtures (real portal
  values, synthetic markup) to isolate one rule at a time — no live fetch in an ordinary unit test.
  `tamilnadu/` additionally has **real committed HTML** under `fixtures/` (trimmed of inert chrome
  only, parser-output-verified against the untrimmed capture — see
  [realFixtures.test.ts](src/__tests__/tamilnadu/realFixtures.test.ts)) and one **opt-in live
  test** ([liveSmoke.test.ts](src/__tests__/tamilnadu/liveSmoke.test.ts), gated behind
  `RERA_LIVE_TESTS=1`, skipped by default and never run in CI) that hits the real portal. A new
  state should add the same pair once its adapter is stable.
- Comments explain *why*, at length where the reasoning is non-obvious — match that density.
  Several comments in this repo are the only record of a hard-won decision; don't compress them.
- Node ≥ 20 (global `fetch`).
- `docs/caveats.md` documents one government host **per supported state** (`rera.karnataka.gov.in`,
  `rera.tn.gov.in`) — keep that list correct as states are added, and add a state-specific coverage
  entry (datasets, live-detail fields absent, enforcement-list presence) for each new state.
