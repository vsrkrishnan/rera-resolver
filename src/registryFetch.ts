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

// Mirrors REKI's own registry-fetch timeout (rera.ts REGISTRY_FETCH_TIMEOUT_MS)
// so a slow/hanging portal never blocks a caller indefinitely.
const REGISTRY_FETCH_TIMEOUT_MS = 6_000;

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

// Phase 1.0: only confirmed functional for completed-dataset projects, keyed
// by the internal row id harvested from that dump's "VIEW PROJECT DETAILS"
// button (IndexRecord.completedRowId) — NOT the registration number. Do not
// call this for ongoing-dataset records; there is no known id for them.
export async function fetchProjectDetailsHtml(completedRowId: string, log?: FetchLog): Promise<string | null> {
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
      body: new URLSearchParams({ action: completedRowId }).toString(),
    },
    REGISTRY_FETCH_TIMEOUT_MS,
  );
  return resp ? await resp.text() : null;
}
