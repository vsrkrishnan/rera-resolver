# Demo app

A small web app that shows `rera-resolver` solving the actual problem: type a messy,
human-typed project name, watch it resolve to a ranked, evidenced registry match, then pull
the live project/promoter detail (status, cost, bank, complaint counts, CIN/PAN/GSTIN,
directors) behind it.

It lives entirely under [`web/`](../web) as its **own package** (own `package.json`, own
dependency — `express`) that imports the library's built output from `../dist/index.js`. It is
never merged into the library's `package.json`, `src/`, or npm-published `dist/`.

## Why a separate backend at all

The library can't run in a browser: it uses `better-sqlite3` (a native Node addon) and makes
server-to-server calls to `rera.karnataka.gov.in`. So `web/server.js` is a small Express app
that wraps the library and exposes a handful of JSON endpoints; `web/public/` is plain
HTML/CSS/vanilla JS with no build step, calling those endpoints from the browser.

## Run it locally

```bash
npm ci && npm run build     # builds the library into dist/
cd web && npm ci
node server.js              # listens on :3000 (set PORT to override)
```

Open `http://localhost:3000`. On first boot the server calls the library's own `ensureIndex()`
to build/refresh its local project index against the live portal — if no index exists yet this
blocks briefly (a handful of bulk HTTP calls, not a per-project scrape); if one already exists
it serves immediately and refreshes in the background once it's stale (>7 days).

Point at a specific index file (e.g. this repo's own `data/index.db`, if you've already run
`npm run sync`) with:

```bash
RERA_RESOLVER_DB_PATH=$(pwd)/../data/index.db node server.js
```

### API surface

| Endpoint | Backed by | Speed |
|---|---|---|
| `GET /api/status` | `readSnapshot()` | instant |
| `GET /api/resolve?name=&promoter=` | `resolve()` | instant, local |
| `GET /api/project?regNumber=` | `fetch()`, TTL-cached | live portal call, ~1–20s |
| `GET /api/promoter?name=` | `fetchPromoter()` + `checkUnderInvestigation()`, TTL-cached | live portal call |

Live endpoints cache successful responses in-memory for 1 hour (`web/cache.js`) so repeat
views are instant and the demo tolerates brief portal downtime.

> **Hosting note:** the live `fetch()`/`fetchPromoter()` detail calls only work from an
> environment that can reach `rera.karnataka.gov.in` with reasonable latency. Cloud regions
> far from India (or that the portal blocks) will time out on those calls and fall back to the
> honest "detail unavailable" state, while local resolve/search still works. This app is meant
> to be run locally against the live portal.

## Known limitations of the demo

- **Tier 3 (LLM semantic bridge)** is not wired up — it needs a bring-your-own model/API key.
  `resolve()` still runs Tiers 0–2 (exact + fuzzy token matching) without it.
- **No rate limiting or auth** — fine for a demo, not for public production traffic.
- **`checkUnderInvestigation()`'s data is stale** by design of the source list (RERA hasn't
  published new entries since 2021) — the UI always surfaces the library's own `warning` text
  about this rather than hiding it.
