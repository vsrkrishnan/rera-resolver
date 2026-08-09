import type { OperationCostRecord, ProjectRecord, StateCode } from './types.js';
import { readSnapshot, resolveDbPathForState } from './storage.js';
import type { FetchLog } from './registryFetch.js';
import { getAdapter } from './adapters/registry.js';
import { DEFAULT_STATE } from './config.js';

export interface FetchOptions {
  dbPath?: string;
  state?: StateCode; // which state's registry the regNumber belongs to (defaults to KA)
  onCost?: (record: OperationCostRecord) => void;
}

// fetch() takes an already-resolved regNumber (spec §7.2: "Unresolved
// identity is a resolve() concern, not fetch()"). If it isn't in our cached
// index, we have no identity to stand behind — that's a caller error, not a
// degraded-result case, so it throws rather than fabricating a placeholder
// record.
export class UnknownRegNumberError extends Error {
  constructor(regNumber: string) {
    super(`regNumber "${regNumber}" is not present in the cached index. fetch() requires a regNumber already produced by resolve() or projectsByPromoter().`);
    this.name = 'UnknownRegNumberError';
  }
}

// Findings this implements:
//  - completed-dataset projects: projectDetails (POST, action=<completedRowId>)
//    is a real, working per-project detail endpoint — verified live against
//    4 distinct row ids, each returning correct, distinct data. The id comes
//    directly from the completed dump's own "VIEW PROJECT DETAILS" button.
//  - ongoing-dataset projects: Phase 1.0 found no working detail endpoint
//    (projectViewDetails's search form appeared to ignore its input). A
//    later live re-check (2026-07-19) found that finding is now stale — see
//    fetchOngoingProjectId's comment — so ongoing projects get one extra
//    lookup call to find their id, then the same projectDetails call.
export async function fetchProject(regNumber: string, options: FetchOptions = {}): Promise<ProjectRecord> {
  const state = options.state ?? DEFAULT_STATE;
  const adapter = getAdapter(state);
  const dbPath = options.dbPath ?? resolveDbPathForState(state);
  const startedAt = Date.now();
  const fetchLog: FetchLog = { httpCalls: 0 };
  const onCost = options.onCost ?? (() => {});
  const emitCost = () =>
    onCost({
      operation: 'fetch',
      httpCalls: fetchLog.httpCalls,
      llmCalls: 0,
      latencyMs: Date.now() - startedAt,
      at: new Date().toISOString(),
    });

  const snapshot = readSnapshot(dbPath);
  const record = snapshot?.records.find((r) => r.regNumber === regNumber);
  if (!record) {
    emitCost();
    throw new UnknownRegNumberError(regNumber);
  }

  const base = {
    regNumber: record.regNumber,
    registeredName: record.registeredName,
    promoterName: record.promoterName,
    dataset: record.dataset,
    state: record.state,
    fetchedAt: new Date().toISOString(),
  };

  const result = await adapter.fetchDetail(record, fetchLog);
  emitCost();

  if (!result) {
    return { ...base, fetchState: 'detail_unavailable' };
  }

  const hasPromoterData = result.promoter
    ? Object.values(result.promoter).some((v) => v !== undefined)
    : false;

  return {
    ...base,
    ...result.detail,
    promoter: hasPromoterData ? result.promoter : undefined,
    fetchState: 'complete',
  };
}
