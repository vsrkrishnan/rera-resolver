import type { FetchLog } from '../../registryFetch.js';

// Tamil Nadu RERA — the only live host (tnrera.in is dead: 410 Gone). Probed
// 2026-08-09: plain GET, no cookies/CSRF/CAPTCHA on any list or detail page.
const TN_HOST = 'https://rera.tn.gov.in';
const USER_AGENT = 'Mozilla/5.0 (compatible; rera-resolver/0.1)';

// The online Layout list is ~8.3 MB, so list fetches get a generous timeout;
// detail pages are small.
const LIST_TIMEOUT_MS = 60_000;
const DETAIL_TIMEOUT_MS = 20_000;

// Same shape as registryFetch.ts's timedFetch (returns null on any non-2xx,
// timeout, or throw; increments the shared HTTP-call counter) — kept local to
// the TN adapter rather than shared, since the two portals are independent.
async function timedGet(url: string, timeoutMs: number, log?: FetchLog): Promise<string | null> {
  if (log) log.httpCalls += 1;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: controller.signal });
    if (!resp.ok) return null;
    return await resp.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

// The two online registered-project tables (server-rendered HTML; DataTables is
// client-side only, no JSON/AJAX source — confirmed during probing, so HTML
// scraping is the correct integration point).
export function fetchBuildingListHtml(log?: FetchLog): Promise<string | null> {
  return timedGet(`${TN_HOST}/registered-building/tn`, LIST_TIMEOUT_MS, log);
}

export function fetchLayoutListHtml(log?: FetchLog): Promise<string | null> {
  return timedGet(`${TN_HOST}/registered-layout/tn`, LIST_TIMEOUT_MS, log);
}

// Detail pages are keyed by a random id embedded in the list row (harvested
// into IndexRecord.detailRefs at parse time), so fetchDetail is given the full
// URL directly — no id-lookup round trip (simpler than Karnataka's ongoing
// projects). Project and promoter are two separate pages/URLs.
export function fetchDetailPageHtml(url: string, log?: FetchLog): Promise<string | null> {
  return timedGet(url, DETAIL_TIMEOUT_MS, log);
}

// --- Offline archives (paper-filed projects, 2017 onward) --------------------
//
// TN published its early (pre-online-portal) registrations as per-year HTML
// tables, one page per year, reachable from a category landing page:
//   /building/list-project -> links to /building/offline/<year>
//   /layout/list-project   -> links to /layout/offline/<year>
// We discover the year-page URLs from the landing page rather than hardcoding
// the range, so a newly-published year is picked up automatically. Each
// category's year pages share one table shape (8 columns) and are concatenated
// into a single payload for one parser (parseTnOfflineList). Detail for these
// rows is only scanned PDFs (or absent), so there are no per-project detail
// pages to key — the live PDF URLs are harvested into detailRefs for reference.
const OFFLINE_INDEX = {
  building: `${TN_HOST}/building/list-project`,
  layout: `${TN_HOST}/layout/list-project`,
} as const;

async function fetchOfflineCategoryHtml(
  category: 'building' | 'layout',
  log?: FetchLog,
): Promise<string | null> {
  const index = await timedGet(OFFLINE_INDEX[category], LIST_TIMEOUT_MS, log);
  if (index === null) return null;

  // e.g. https://rera.tn.gov.in/building/offline/2020 — dedupe and sort.
  const yearUrlRe = new RegExp(`${TN_HOST}/${category}/offline/\\d+`, 'g');
  const yearUrls = [...new Set(index.match(yearUrlRe) ?? [])].sort();
  if (yearUrls.length === 0) return null; // landing page shape changed — treat as a fetch failure

  const pages = await Promise.all(yearUrls.map((u) => timedGet(u, LIST_TIMEOUT_MS, log)));
  if (pages.some((p) => p === null)) return null; // any year page failing fails the whole source
  return pages.join('\n');
}

export function fetchOfflineBuildingHtml(log?: FetchLog): Promise<string | null> {
  return fetchOfflineCategoryHtml('building', log);
}

export function fetchOfflineLayoutHtml(log?: FetchLog): Promise<string | null> {
  return fetchOfflineCategoryHtml('layout', log);
}
