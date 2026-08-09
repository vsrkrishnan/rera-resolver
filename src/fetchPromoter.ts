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

  // A completed project's detail costs one HTTP call; an ongoing project's
  // costs two (id lookup + detail — see fetchProject/fetchOngoingProjectId).
  // Prefer a completed project as the representative to keep the common
  // case cheap; fall back to whatever's available otherwise.
  const representative = projects.find((p) => p.dataset === 'completed') ?? projects[0];

  // regNumber came straight from this same index/dbPath via
  // projectsByPromoter, so it's guaranteed present — fetchProject won't
  // throw UnknownRegNumberError here. httpCalls is captured locally (not
  // forwarded to the caller's onCost) so fetchPromoter reports exactly one
  // consolidated cost record, matching every other public function's
  // one-record-per-call contract.
  const detail = await fetchProject(representative.regNumber, {
    dbPath,
    state,
    onCost: (record) => {
      httpCalls += record.httpCalls;
    },
  });

  const fetchState: PromoterFetchState = detail.promoter ? 'complete' : 'profile_unavailable';
  emitCost();

  return {
    promoterName,
    profile: detail.promoter,
    projects,
    fetchState,
    fetchedAt,
  };
}
