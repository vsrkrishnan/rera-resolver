# Prerequisites and caveats

## Prerequisites

For normal use you need just two things:

- **Node ≥ 20** — uses the global `fetch` and ESM.
- **Outbound network access to `rera.karnataka.gov.in`.** This is the only external host the
  library ever contacts (no API key, no other host, and **never a web search** to decide a
  match). It's needed to build/refresh the local index (on install, via `npx rera-resolver sync`,
  or whenever the cache goes stale) and by `fetch()` for live project detail. If that host isn't
  reachable — offline install, locked-down CI network — bootstrap simply fails gracefully; run
  `npx rera-resolver sync` later from an environment that can reach it.

Two more things you almost certainly already have: **local disk write access** to your user cache
directory (where the SQLite index lives), and — only if you opt into the Tier 3 semantic bridge
(see [guide.md](guide.md)) — **an LLM of your own**. This library bundles no LLM vendor or key.

### Troubleshooting: build toolchain

The one runtime dependency, `better-sqlite3` (used for local storage — no external database, no
hosted service), ships prebuilt binaries for common platforms, so most installs need nothing
extra. Only on an unusual platform with no prebuilt binary will `npm install` need a **C/C++ build
toolchain** to compile it from source.

## Good to know

- **`resolve()` itself only matches on a name (plus optional hints)** — it structurally cannot
  tell you whether an unfound project is legally exempt under RERA §3(2) versus genuinely
  unregistered; that's left to the consuming application. Once you have a `regNumber`,
  `fetch()`/`fetchPromoter()` pull real project/promoter detail (status, dates, cost, bank,
  CIN/PAN/GSTIN, directors) — but not everything is guaranteed present on every project: the
  portal's own detail-page format has changed over the years, so older completed projects may
  expose fewer fields than newer ones. A missing field is `undefined`, never guessed.
- **The investigation list is real but stale.** No entries published after 2021-10-22 as of this
  writing — `checkUnderInvestigation()` always returns `dataAsOf` and `warning` for exactly this
  reason.
- **`resolve()` never auto-confirms.** `status: 'high_confidence'` is advisory only — you decide
  what to do with the ranked candidate list, especially `'ambiguous'` results.
