# Changelog

All notable changes to this project will be documented in this file. Format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Added

- **Multi-state support via a pluggable `StateAdapter`.** The engine (resolve, matcher, storage,
  syncIndex, fetch) is now state-agnostic and drives each state's registry through an adapter.
  A `state` option (default `'KA'`) on every public function, a `--state` CLI flag, per-state
  indexes (`index-<state>.db`), and `state` echoed onto `Candidate` / `ProjectRecord`.
- **Tamil Nadu adapter (`state: 'TN'`).** Resolves messy TN project names against both the online
  registered-project tables (Building + Layout, ~3,400 projects) **and the offline paper-filed
  archives** (per-year 2017–2025, ~14,000 projects) — ~17,600 total — and fetches live project +
  promoter detail for online projects. See [docs/caveats.md](docs/caveats.md) for TN's coverage
  limits.
- **`ProjectRecord.documents`** — a map of official source-document URLs (label → URL) a state
  publishes when it exposes no structured detail. Populated for TN's offline projects (scanned
  approval / carpet-area PDFs); omitted otherwise. Never fabricated.
- **Much richer Tamil Nadu detail parsing.** The online "Form A" parse now returns stage of
  construction (`projectStatus`), dwelling-unit count, site extent, usage, and the RERA-designated
  bank name/branch (new `ProjectRecord.usage` / `siteAreaSqm`); the promoter parse now returns
  contact fields (`email`/`mobile`/`website`), CIN **or** GSTIN (auto-detected), the chairman/CEO
  or the list of partners/directors (`directorNames`), and individual-promoter fields
  (`occupation`/`fathersName`). Offline projects now also carry table-borne **GPS** (DMS→decimal),
  completion date, and status — so `fetch()` returns `complete` (not `detail_unavailable`) for them.
- **State-aware demo web app** (`web/`) — a KA/TN state selector; every query targets exactly one
  state (no cross-state search), and offline projects surface their official PDF documents.

### Changed

- **Adapter crawl model is now `sources: CrawlSource[]`.** Each source self-describes its own
  `fetch`, `parse`, and `sanityFloor`, and the engine iterates them opaquely. This replaces the
  `datasets` + `fetchList` + `parseList` + `sanityFloors.perDataset` quartet and decouples a
  crawl sub-source from the record-level `Dataset` label — so a state can carve its crawl into
  arbitrary pools (e.g. TN's online + offline-building + offline-layout) without the shared
  `Dataset` union growing per state.
- `Dataset` gains a neutral `'registered'` value for states without an ongoing/completed split
  (Tamil Nadu). The adapter detail interface is a single encapsulated
  `fetchDetail(record) -> { detail, promoter }`. `IndexRecord` gains an opaque `detailRefs` bag
  for portals that key detail pages (or documents) by a per-row id.


## [0.1.0] - 2026-07-19

Initial release.

### Added

- `resolve()` — tiered (exact / token-fuzzy / optional LLM bridge) fuzzy name resolution against
  the Karnataka RERA project index, returning ranked, scored candidates with evidence.
- `fetch()` — live project detail lookup by `regNumber` (status, dates, cost, bank details, GPS,
  promoter profile), for both ongoing and completed projects.
- `fetchPromoter()` — promoter profile plus every project they've registered.
- `projectsByPromoter()` — zero-cost local lookup of a promoter's project portfolio.
- `checkUnderInvestigation()` — cross-check against RERA's "Projects Under Investigation" list.
- `ensureIndex()` / `syncIndex()` — self-healing local index management, plus a `rera-resolver`
  CLI (`sync`, `status`, `fetch`, `promoter`).
- Optional Tier 3 LLM semantic bridge via a bring-your-own `LlmClient` interface.
