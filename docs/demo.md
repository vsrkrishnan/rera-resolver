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

## Run it in Docker

```bash
docker build -t rera-resolver-demo .
docker run -p 3000:3000 -e PORT=3000 rera-resolver-demo
```

No index is baked into the image and none needs to be committed to git — the container
self-heals its index against the live portal on first boot, the same as running it locally.
The image installs `python3 make g++` so `better-sqlite3` can compile from source if no
prebuilt binary matches the target platform.

## Deploy to Render

This repo includes a `render.yaml` blueprint targeting the free plan:

1. Push this repo to GitHub (already the case — `origin` is
   `github.com/vsrkrishnan/rera-resolver`).
2. In the Render dashboard: **New → Blueprint**, point it at the repo. Render reads
   `render.yaml` and provisions the Docker web service automatically.
3. First deploy: the container boots with no index, so the first request after a cold start
   pays the (small) cost of `ensureIndex()`'s bulk sync. Subsequent requests are instant until
   the container restarts (Render's free plan has no persistent disk, so the index doesn't
   survive a restart/spin-down — seconds of extra latency on the next cold request, not a
   failure).
4. To keep the index warm across restarts instead: upgrade to a paid instance type, add a
   `disk:` block in `render.yaml` mounted at some path, and point `RERA_RESOLVER_DB_PATH` at
   it (Render disks require a paid plan, so this isn't in the default blueprint).

**Why Render and not Vercel:** the library needs a native module (`better-sqlite3`), a
writable filesystem for its self-refreshing index, and tolerates the government portal being
slow (no fixed timeout budget). Vercel's serverless functions fight all three — read-only
filesystem, function timeouts, fragile native-binary packaging. Render (or any always-on
container host — Railway, Fly.io) just runs it as a normal long-lived process, which is what
this app actually is. The Dockerfile has no Render-specific code, so it deploys unmodified to
any of them.

## Known limitations of the demo

- **Tier 3 (LLM semantic bridge)** is not wired up — it needs a bring-your-own model/API key.
  `resolve()` still runs Tiers 0–2 (exact + fuzzy token matching) without it.
- **No rate limiting or auth** — fine for a demo, not for public production traffic.
- **`checkUnderInvestigation()`'s data is stale** by design of the source list (RERA hasn't
  published new entries since 2021) — the UI always surfaces the library's own `warning` text
  about this rather than hiding it.
