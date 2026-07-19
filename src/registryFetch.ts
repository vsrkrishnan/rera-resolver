// Confirmed live (Phase 1.0): both are static server-rendered dumps, no
// pagination, `?language=en` is the only query param needed. Do not add any
// other endpoint here without re-running the investigation.
const ONGOING_URL = 'https://rera.karnataka.gov.in/viewAllProjects?language=en';
const COMPLETED_URL = 'https://rera.karnataka.gov.in/viewAllCompletedProjects?language=en';
// "Projects Under Investigation" — investigated 2026-07-18. Same static-dump
// shape as the other two (no pagination, no search), but its own dataset
// with no regNumber, since these were never registered. See parse.ts's
// parseInvestigationList for the malformed-HTML caveat.
const UNREGISTERED_URL = 'https://rera.karnataka.gov.in/unregProjectList?language=en';
// A later live re-investigation (2026-07-19) found this endpoint DOES filter
// by regNo now, contrary to the Phase 1.0 finding — see fetchOngoingProjectId.
const PROJECT_VIEW_DETAILS_URL = 'https://rera.karnataka.gov.in/projectViewDetails';

// Mirrors REKI's own registry-fetch timeout (rera.ts REGISTRY_FETCH_TIMEOUT_MS)
// so a slow/hanging portal never blocks a caller indefinitely.
const REGISTRY_FETCH_TIMEOUT_MS = 6_000;
// projectViewDetails's response is the full ~6MB ongoing-dump markup
// (server-side filtered down to the matching row, but the page shell/scripts
// are the same size as the full dump) — needs more headroom than the other
// calls.
const ONGOING_ID_LOOKUP_TIMEOUT_MS = 20_000;
const ROW_ID_PATTERN = /<a\s+id="(\d+)"/;

export interface FetchLog {
  httpCalls: number;
}

async function timedFetch(url: string, init: RequestInit, timeoutMs: number): Promise<Response | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { ...init, signal: controller.signal });
    if (!resp.ok) return null;
    return resp;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function fetchOngoingHtml(log?: FetchLog): Promise<string | null> {
  if (log) log.httpCalls += 1;
  const resp = await timedFetch(
    ONGOING_URL,
    { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; rera-resolver/0.1)' } },
    REGISTRY_FETCH_TIMEOUT_MS,
  );
  return resp ? await resp.text() : null;
}

export async function fetchCompletedHtml(log?: FetchLog): Promise<string | null> {
  if (log) log.httpCalls += 1;
  const resp = await timedFetch(
    COMPLETED_URL,
    { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; rera-resolver/0.1)' } },
    REGISTRY_FETCH_TIMEOUT_MS,
  );
  return resp ? await resp.text() : null;
}

export async function fetchUnregisteredProjectsHtml(log?: FetchLog): Promise<string | null> {
  if (log) log.httpCalls += 1;
  const resp = await timedFetch(
    UNREGISTERED_URL,
    { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; rera-resolver/0.1)' } },
    REGISTRY_FETCH_TIMEOUT_MS,
  );
  return resp ? await resp.text() : null;
}

// Confirmed live: this endpoint works for BOTH datasets, keyed by the
// portal's internal row id (not the registration number) — for completed
// rows that id is harvested directly from the list dump
// (IndexRecord.completedRowId); for ongoing rows it has no equivalent in the
// list dump and must be looked up first via fetchOngoingProjectId. (Phase
// 1.0's original note that ongoing detail has "no known id" is now stale —
// see fetchOngoingProjectId's comment for what changed.)
export async function fetchProjectDetailsHtml(rowId: string, log?: FetchLog): Promise<string | null> {
  if (log) log.httpCalls += 1;
  const resp = await timedFetch(
    'https://rera.karnataka.gov.in/projectDetails',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest',
        'User-Agent': 'Mozilla/5.0 (compatible; rera-resolver/0.1)',
      },
      body: new URLSearchParams({ action: rowId }).toString(),
    },
    REGISTRY_FETCH_TIMEOUT_MS,
  );
  return resp ? await resp.text() : null;
}

// Ongoing projects have no per-row id in the list dump (see parse.ts), so
// fetch()'s detail lookup for them needs this extra step first. Phase 1.0
// found projectViewDetails's search form ignored its input entirely
// (returned the full unfiltered dataset regardless of what was submitted);
// a live re-check (2026-07-19) found this is no longer true — POSTing
// `regNo` now genuinely filters the response down to the one matching
// project's row, which carries the same `<a id="...">` detail-button id the
// completed dump exposes directly. The response is the full page shell
// (~6MB) even though only one data row survives the filter.
export async function fetchOngoingProjectId(regNumber: string, log?: FetchLog): Promise<string | null> {
  if (log) log.httpCalls += 1;
  const resp = await timedFetch(
    PROJECT_VIEW_DETAILS_URL,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (compatible; rera-resolver/0.1)',
      },
      body: new URLSearchParams({
        project: '',
        firm: '',
        appNo: '',
        regNo: regNumber,
        district: '',
        subdistrict: '',
      }).toString(),
    },
    ONGOING_ID_LOOKUP_TIMEOUT_MS,
  );
  if (!resp) return null;
  const html = await resp.text();
  const match = ROW_ID_PATTERN.exec(html);
  return match ? match[1] : null;
}
