# rera-resolver

[![version](https://img.shields.io/badge/version-0.1.0-blue.svg)](CHANGELOG.md)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A TypeScript library that finds the correct Karnataka RERA registry record for a real-estate project when all you have is its **messy, human-typed name** — then pulls the real project and promoter detail behind it.

It turns a name like `"Godraj United"` (a typo for the real "Godrej United") into ranked, scored candidate records — with evidence for each, and never a single silent guess — and then, given a registration number, fetches the live registry detail: project status, dates, cost, bank details, and the promoter's CIN / PAN / GSTIN / address / directors.

```ts
import { resolve } from 'rera-resolver';

const result = await resolve('Godraj United'); // typo — real project is "Godrej United"
result.status;         // 'high_confidence' | 'ambiguous' | 'unresolved'
result.candidates[0];  // { regNumber, registeredName, promoterName, matchScore, matchTier, evidence }
```

## Why this exists

Karnataka's official RERA portal is searchable, but only by **exact spelling**. That's a problem, because the name a person actually knows a project by is almost never the name it's registered under:

- People know a project by its **marketing name** — "Prestige Lakeside Habitat", "Godrej United", "Brigade El Dorado" — often misspelled, abbreviated, or partial.
- The registry stores it under a **legal name** — frequently a special-purpose company like "M/s … Developers Private Limited" that shares few or no words with the marketing name.

So anyone who knows a project only by its common name — a buyer, a researcher, a due-diligence tool — can't reliably find its registry record. Downloading the whole dataset doesn't fix this: you still have to bridge "what a human typed" to "what the registry calls it". **Scraping the portal is a solved, commodity problem; resolving the name is the hard, unsolved one.** That bridge is the entire reason this library exists.

## How it works

`rera-resolver` keeps a **local, cached copy** of the official Karnataka RERA project index (built automatically on install, refreshed when it goes stale) and resolves a name against it through a tiered matcher:

- **Tier 0 — exact** normalized match.
- **Tier 2 — token-set fuzzy** matching, weighting rarer words more heavily and tolerating typos, word-order changes, and missing/extra tokens.
- **Tier 3 — optional LLM bridge** (opt-in, bring-your-own model): for the hard case where the marketing name and the legal name share *no words at all*. Every registration number the LLM returns is validated against the real local index before it reaches you — an invented one is silently discarded.

Every result is a **ranked list of candidates with scores and human-readable evidence**. The library never auto-confirms a single guess, never uses a web search to decide a match, and only ever contacts one host — `rera.karnataka.gov.in`. Once you've picked a candidate, `fetch()` and `fetchPromoter()` pull the real live detail behind it.

## Install

Not yet on the npm registry — install directly from GitHub:

```bash
npm install github:vsrkrishnan/rera-resolver
```

### Prerequisites

- **Node ≥ 20** (uses global `fetch` and ESM).
- **Outbound network access to `rera.karnataka.gov.in`** — the only external host this library ever contacts. It's used to build/refresh the local index and for live `fetch()` calls. Nothing else: no API key, no other host.

That's it for normal use. The local index builds itself after install; if that step can't reach the portal (offline install, locked-down CI), it fails gracefully — just run `npx rera-resolver sync` later from somewhere that can. See [docs/caveats.md](docs/caveats.md) for the full prerequisites (including the rare case where you'd need a build toolchain).

## Quick start

```ts
import { resolve } from 'rera-resolver';

// Resolve a messy name to ranked, scored candidates.
const result = await resolve('Godraj United'); // typo — real project is "Godrej United"
console.log(result.status);        // 'high_confidence' | 'ambiguous' | 'unresolved'
console.log(result.candidates[0]); // { regNumber, registeredName, promoterName, matchScore, matchTier, evidence, ... }

// Optional hint narrows matching when you know the developer.
await resolve('Lakeside Habitat', { promoterName: 'Prestige' });
```

`candidates` is always present and ranked by `matchScore` (highest first). Read `status` to decide how much to trust it:

- **`high_confidence`** — one candidate is a strong, clear match.
- **`ambiguous`** — several plausible candidates; you (or your user) should choose.
- **`unresolved`** — no usable match. Check `unresolvedReason`: `'no_candidates'` means the index was searched and nothing matched; `'index_not_ready'` means the local index hasn't been built yet — run `npx rera-resolver sync`.

The library deliberately never collapses `ambiguous` into a single confirmed answer — that decision belongs to you.

## What else it can do

Each of these has a runnable, worked example in the **[usage guide](docs/guide.md)**.

**`fetch(regNumber)` — live project detail.** Given a registration number, pull the real registry record behind it: status, dates, cost, bank details, GPS, and the promoter's own profile. Works for both ongoing and completed projects.

```ts
import { fetch } from 'rera-resolver';

const project = await fetch('PRM/KA/RERA/1251/308/PR/170726/008819');
```
```json
{
  "regNumber": "PRM/KA/RERA/1251/308/PR/170726/008819",
  "registeredName": "THE ROOTS BY ELEGANCE INFRA",
  "promoterName": "PIONIER DEVELOPMENTS PRIVATE LIMITED",
  "projectStatus": "Ongoing",
  "totalProjectCostInr": "368684262",
  "bankName": "STATE BANK OF INDIA",
  "promoter": {
    "registrationNumber": "U70100KA2022PTC163677",
    "pan": "AANCP0678D",
    "gstin": "AANCP0678D",
    "address": "#48, I STAR BUILDING, 100 FT ROAD,,KORAMANGALA, BANGALORE ,Bengaluru South ,Bengaluru Urban-560034"
    // ...plus district, directors, DIN, and more
  },
  "fetchState": "complete"
  // ...plus dates, GPS, plan approval, construction cost, and more — full real payload in docs/guide.md
}
```

**`fetchPromoter(name)`** — a promoter's profile plus every project they've registered.
**`projectsByPromoter(name)`** — zero-cost local lookup of a promoter's whole portfolio.
**`checkUnderInvestigation(name)`** — cross-check against RERA's own "Projects Under Investigation" enforcement list.
**Command-line interface** — the same operations from a terminal: `npx rera-resolver resolve "<name>"`, `fetch`, `promoter`, `sync`, `status`. See [the CLI section of the guide](docs/guide.md#command-line-usage).
**Tier 3 LLM bridge** — opt-in semantic matching with a model you provide, for names that share no words with the registered name. See [the guide](docs/guide.md#optional-tier-3-llm-semantic-bridge).

## Caveats

This library is honest about what it can and can't tell you:

- **It never auto-confirms.** `high_confidence` is advisory — you own the decision to treat a candidate as the answer.
- **It can't tell "exempt" from "unregistered".** With only a name, `resolve()` structurally cannot distinguish a project legally exempt from RERA registration from one that simply isn't found. That judgment is left to you.
- **The investigation list is stale.** RERA hasn't published new entries since 2021 — `checkUnderInvestigation()` always returns a `dataAsOf` date and a `warning` for exactly this reason.
- **Older projects expose fewer fields.** The portal's detail-page format has changed over the years; a field a given project doesn't publish is returned as `undefined`, never guessed or faked.

Full detail in [docs/caveats.md](docs/caveats.md).

## Documentation

- **[docs/guide.md](docs/guide.md)** — every function and the CLI, each with a runnable example: `fetch()`, `fetchPromoter()`, `projectsByPromoter()`, `checkUnderInvestigation()`, `ensureIndex()`, command-line usage, and the Tier 3 LLM bridge.
- **[docs/api.md](docs/api.md)** — full function signatures, the `LlmClient` contract, and exported types.
- **[docs/caveats.md](docs/caveats.md)** — full prerequisites and the honest limits of what this library can and can't tell you.

## Project

- **[CONTRIBUTING.md](CONTRIBUTING.md)** — dev workflow, the eval set, and design principles.
- **[CHANGELOG.md](CHANGELOG.md)** — notable changes per release.
- **[LICENSE](LICENSE)** — MIT.
- **[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)** · **[SECURITY.md](SECURITY.md)** — community expectations and how to report a vulnerability.
