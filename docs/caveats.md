# Prerequisites and caveats

## Prerequisites

For normal use you need just two things:

- **Node ≥ 20** — uses the global `fetch` and ESM.
- **Outbound network access to the RERA portal(s) for the state(s) you use.** The library
  contacts one government host per supported state — `rera.karnataka.gov.in` for Karnataka,
  `rera.tn.gov.in` for Tamil Nadu — and nothing else (no API key, no other host, and **never a
  web search** to decide a match). Each host is needed to build/refresh that state's local index
  (on install, via `npx rera-resolver sync [--state <code>]`, or whenever the cache goes stale)
  and by `fetch()` for live project detail. If a host isn't reachable — offline install,
  locked-down CI network, or a cloud region the portal is slow to answer from — bootstrap simply
  fails gracefully; run `npx rera-resolver sync` later from an environment that can reach it.

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

### State-specific coverage

Each state is a separate registry with its own portal, index (`index-<state>.db`), and quirks.
Pass `state` in the options (or `--state` on the CLI) to target one; it defaults to Karnataka.

- **Karnataka (`KA`)** — the reference. Ongoing + completed datasets, live project + promoter
  detail, and the "Projects Under Investigation" list (stale, as above).
- **Tamil Nadu (`TN`)** — covers both the **online** e-registered tables (Building + Layout,
  ~3,400 projects, reg `TNRERA/…`) **and the offline paper-filed archives** (per-year, 2017–2025,
  ~14,000 projects, reg `TN/…`), for ~17,600 projects total. Honest limits, by design:
  - **Online vs offline is a filing-mode distinction, not a project kind.** Every TN record's
    `dataset` is `'registered'` (TN has no ongoing/completed split, which carries no completion
    claim). The online/offline difference shows only in the reg-number prefix and in what detail
    is available.
  - **Online** projects have full live detail: project type, completion date, address, GPS, and
    plan-approval details, plus a promoter profile (type, registration no., PAN, address) — but
    **no project cost, bank details, complaint counts, or status**, because the TN portal doesn't
    publish them. Absent fields are `undefined`, never faked.
  - **Offline** projects are fully **resolvable** (name, promoter, reg number all come from the
    list table), but the portal exposes **no structured detail** for them — only scanned PDF
    documents. So `fetch()` returns `fetchState: 'detail_unavailable'` with a `documents` map of
    the official PDF URLs (approval, carpet-area) rather than fabricated fields. Older filings
    (esp. 2017–18) often recorded **no distinct project name**, only a construction description;
    the resolver falls back to that description so the row is still searchable, never inventing a
    name.
  - The promoter **name comes combined with its address**, and **PAN is published masked**
    (e.g. `XXXXXX230D`); both are stored verbatim as the portal presents them.
  - TN has **no `checkUnderInvestigation()` equivalent** — it has no Karnataka-style enforcement
    list, so that call returns empty for `state: 'TN'`.
