# Changelog

All notable changes to this project will be documented in this file. Format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Added

- **Multi-state support via a pluggable `StateAdapter`.** The engine (resolve, matcher, storage,
  syncIndex, fetch) is now state-agnostic and drives each state's registry through an adapter.
  A `state` option (default `'KA'`) on every public function, a `--state` CLI flag, per-state
  indexes (`index-<state>.db`), and `state` echoed onto `Candidate` / `ProjectRecord`.
- **Tamil Nadu adapter (`state: 'TN'`).** Resolves messy TN project names against the online
  registered-project tables (Building + Layout, ~3,400 projects) and fetches live project +
  promoter detail. See [docs/caveats.md](docs/caveats.md) for TN's coverage limits.

### Changed

- `Dataset` gains a neutral `'registered'` value for states without an ongoing/completed split
  (Tamil Nadu). The adapter detail interface is now a single encapsulated
  `fetchDetail(record) -> { detail, promoter }`. `IndexRecord` gains an opaque `detailRefs` bag
  for portals that key detail pages by a per-row id.


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
