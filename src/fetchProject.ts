import type { OperationCostRecord, ProjectRecord } from './types.js';
import { readSnapshot, DEFAULT_DB_PATH } from './storage.js';
import { fetchProjectDetailsHtml, type FetchLog } from './registryFetch.js';
import { parseProjectDetails } from './parseProjectDetails.js';

export interface FetchOptions {
  dbPath?: string;
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

// Phase 1.0 findings this implements:
//  - completed-dataset projects: projectDetails (POST, action=<completedRowId>)
//    is a real, working per-project detail endpoint — verified live against
//    4 distinct row ids, each returning correct, distinct data.
//  - ongoing-dataset projects: no working detail endpoint was found. The
//    portal's projectViewDetails search form ignores its input and returns
//    the full unfiltered dataset regardless of what's submitted (verified
//    live with two different real registration numbers, byte-identical
//    dataset both times) — calling it would not produce a real result, so we
//    don't call it at all. This keeps the "one remote call maximum" rule
//    trivially satisfied (zero calls) rather than spending a call on a
//    known-broken endpoint.
export async function fetchProject(regNumber: string, options: FetchOptions = {}): Promise<ProjectRecord> {
  const dbPath = options.dbPath ?? DEFAULT_DB_PATH;
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
    fetchedAt: new Date().toISOString(),
  };

  if (record.dataset !== 'completed' || !record.completedRowId) {
    emitCost();
    return { ...base, fetchState: 'detail_unavailable' };
  }

  const html = await fetchProjectDetailsHtml(record.completedRowId, fetchLog);
  emitCost();

  if (!html) {
    return { ...base, fetchState: 'detail_unavailable' };
  }

  const parsed = parseProjectDetails(html);
  return {
    ...base,
    ...parsed,
    fetchState: 'complete',
  };
}
