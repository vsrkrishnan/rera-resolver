import type { OperationCostRecord, PromoterFetchState, PromoterRecord, StateCode } from './types.js';
import { projectsByPromoter } from './resolve.js';
import { fetchProject } from './fetchProject.js';
import { resolveDbPathForState } from './storage.js';
import { DEFAULT_STATE } from './config.js';

export interface FetchPromoterOptions {
  dbPath?: string;
  state?: StateCode; // which state's registry to search (defaults to KA)
  onCost?: (record: OperationCostRecord) => void;
}

// The portal has no promoter-profile endpoint of its own — a promoter's
// profile only exists as part of one of their PROJECTS' own detail pages
// (see parseProjectDetails.ts's parsePromoterProfile). This fetches one
// representative project's detail and lifts its promoter block out,
// alongside the promoter's full project list (from the local index, no
// network cost — reuses projectsByPromoter's own token-match scan rather
// than reimplementing it).
export async function fetchPromoter(
  promoterName: string,
  options: FetchPromoterOptions = {},
): Promise<PromoterRecord> {
  const state = options.state ?? DEFAULT_STATE;
  const dbPath = options.dbPath ?? resolveDbPathForState(state);
  const startedAt = Date.now();
  const onCost = options.onCost ?? (() => {});
  const fetchedAt = new Date().toISOString();

  const projects = await projectsByPromoter(promoterName, { dbPath, state });

  let httpCalls = 0;
  const emitCost = () =>
    onCost({
      operation: 'fetchPromoter',
      httpCalls,
      llmCalls: 0,
      latencyMs: Date.now() - startedAt,
      at: new Date().toISOString(),
    });

  if (projects.length === 0) {
    emitCost();
    return { promoterName, projects: [], fetchState: 'profile_unavailable', fetchedAt };
  }

  // Try the promoter's projects, in order, until one actually yields a
  // profile — not just whichever is fetchable first. A single "prefer this
  // dataset" heuristic isn't enough across states. For Karnataka, preferring
  // 'completed' is purely a cost optimization (one HTTP call vs. an
  // ongoing project's id-lookup + detail = two): either dataset's single
  // detail page always carries the promoter block (see karnataka.ts's
  // fetchDetail), so the first attempt succeeds in the common case. For
  // Tamil Nadu it's a correctness issue, not just cost: offline ('TN/…')
  // projects have NO promoter page at all (fetchDetail returns {detail}
  // only, or null — see tamilnadu.ts), so if a promoter's first project
  // happens to be offline, stopping there wrongly reports
  // profile_unavailable even when an online sibling of the SAME promoter
  // has a full profile. `projects` is already capped at MAX_CANDIDATES (10)
  // by projectsByPromoter, so trying all of them in the worst case is
  // bounded, and the loop stops at the first success.
  const ordered = [...projects].sort(
    (a, b) => Number(a.dataset !== 'completed') - Number(b.dataset !== 'completed'),
  );

  for (const candidate of ordered) {
    // regNumber came straight from this same index/dbPath via
    // projectsByPromoter, so it's guaranteed present — fetchProject won't
    // throw UnknownRegNumberError here. httpCalls accumulates across every
    // attempt (not just the winning one) and is captured locally, not
    // forwarded to the caller's onCost, so fetchPromoter still reports
    // exactly one consolidated cost record, matching every other public
    // function's one-record-per-call contract.
    const detail = await fetchProject(candidate.regNumber, {
      dbPath,
      state,
      onCost: (record) => {
        httpCalls += record.httpCalls;
      },
    });
    if (detail.promoter) {
      emitCost();
      return { promoterName, profile: detail.promoter, projects, fetchState: 'complete', fetchedAt };
    }
  }

  emitCost();
  const fetchState: PromoterFetchState = 'profile_unavailable';
  return { promoterName, projects, fetchState, fetchedAt };
}
