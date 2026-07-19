# Changelog

All notable changes to this project will be documented in this file. Format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

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
