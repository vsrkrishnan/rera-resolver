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
