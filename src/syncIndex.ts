import type { Dataset, IndexRecord, SyncResult, OperationCostRecord, StateCode } from './types.js';
import type { FetchLog } from './registryFetch.js';
import { dedupeRecords } from './parse.js';
import { readSnapshot, readInvestigationSnapshot, writeSnapshot, resolveDbPathForState } from './storage.js';
import { getAdapter } from './adapters/registry.js';
import { DEFAULT_STATE } from './config.js';

export interface SyncOptions {
  dbPath?: string;
  state?: StateCode; // which state's registry to crawl (defaults to KA)
  onLog?: (line: string) => void;
  // Per spec §9: every external call must be instrumented. SyncResult's shape
  // is normative (spec §5.5) so this rides along as a side-channel callback
  // rather than an extra field on the return value.
  onCost?: (record: OperationCostRecord) => void;
}

export async function syncIndex(options: SyncOptions = {}): Promise<SyncResult> {
  const state = options.state ?? DEFAULT_STATE;
  const adapter = getAdapter(state);
  const dbPath = options.dbPath ?? resolveDbPathForState(state);
  const log = options.onLog ?? (() => {});
  const onCost = options.onCost ?? (() => {});
  const startedAt = Date.now();
  const fetchLog: FetchLog = { httpCalls: 0 };
  const fetchedAt = new Date().toISOString();
  const emitCost = () => onCost(toSyncCostRecord(startedAt, fetchLog.httpCalls));

  const previous = readSnapshot(dbPath);
  const previousInvestigations = readInvestigationSnapshot(dbPath);

  // Counts are reported per the (Karnataka-shaped) SyncResult contract:
  // ongoingCount/completedCount. A state whose datasets aren't literally
  // 'ongoing'/'completed' simply reports 0 for the absent ones.
  const countByDataset: Partial<Record<Dataset, number>> = {};
  const keepPrior = (): SyncResult => ({
    fetchedAt,
    ongoingCount: previous?.ongoingCount ?? 0,
    completedCount: previous?.completedCount ?? 0,
    investigationCount: previousInvestigations?.records.length ?? 0,
    added: 0,
    removed: 0,
    ok: false,
  });

  // Fetch every dataset (and the optional investigation list) in parallel.
  const [rawByDataset, investigationHtml] = await Promise.all([
    Promise.all(adapter.datasets.map((ds) => adapter.fetchList(ds, fetchLog))),
    adapter.hasInvestigationList && adapter.fetchInvestigationList
      ? adapter.fetchInvestigationList(fetchLog)
      : Promise.resolve(null),
  ]);

  // Every declared dataset is mandatory — any fetch failure fails the whole
  // sync and keeps the prior snapshot (matches Karnataka's original behavior
  // where a missing ongoing OR completed dump aborted the sync).
  const parsedByDataset: IndexRecord[][] = [];
  for (let i = 0; i < adapter.datasets.length; i++) {
    const ds = adapter.datasets[i];
    const raw = rawByDataset[i];
    if (!raw) {
      log(`[syncIndex] FAILED: fetch failure for dataset "${ds}" (${state}). Keeping prior snapshot.`);
      emitCost();
      return keepPrior();
    }
    const parsed = adapter.parseList(raw, ds);
    const floor = adapter.sanityFloors.perDataset[ds];
    if (floor !== undefined && parsed.length < floor) {
      log(
        `[syncIndex] FAILED: parsed count for "${ds}" below sanity floor (${parsed.length} < ${floor}) — likely a portal HTML structure change broke the parser. Keeping prior snapshot, NOT swapping.`,
      );
      emitCost();
      return keepPrior();
    }
    countByDataset[ds] = parsed.length;
    parsedByDataset.push(parsed);
  }

  // Investigation list is a secondary/supplementary dataset — a hiccup on this
  // specific endpoint (or a parser break) does NOT fail the whole sync, it
  // just carries the previous investigation snapshot forward rather than
  // wiping real data.
  let investigationRecords =
    investigationHtml && adapter.parseInvestigationList ? adapter.parseInvestigationList(investigationHtml) : [];
  let investigationFetchedAt = fetchedAt;
  const investigationFloor = adapter.sanityFloors.investigation ?? 0;
  if (adapter.hasInvestigationList && (!investigationHtml || investigationRecords.length < investigationFloor)) {
    log(
      `[syncIndex] WARN: investigation list fetch/parse looked wrong (html=${investigationHtml ? 'ok' : 'null'}, parsed=${investigationRecords.length}) — keeping prior investigation snapshot.`,
    );
    investigationRecords = previousInvestigations?.records ?? [];
    investigationFetchedAt = previousInvestigations?.fetchedAt ?? fetchedAt;
  }

  const records = dedupeRecords(parsedByDataset.flat());

  const previousRegNumbers = new Set((previous?.records ?? []).map((r) => r.regNumber));
  const currentRegNumbers = new Set(records.map((r) => r.regNumber));
  const added = [...currentRegNumbers].filter((r) => !previousRegNumbers.has(r)).length;
  const removed = [...previousRegNumbers].filter((r) => !currentRegNumbers.has(r)).length;

  // Build fully, then swap (writeSnapshot renames a temp file over dbPath) —
  // never leaves the store half-written even on a crash mid-write.
  writeSnapshot(
    {
      fetchedAt,
      state,
      ongoingCount: countByDataset.ongoing ?? 0,
      completedCount: countByDataset.completed ?? 0,
      records,
    },
    {
      fetchedAt: investigationFetchedAt,
      records: investigationRecords,
    },
    dbPath,
  );

  log(
    `[syncIndex] OK (${state}): ${adapter.datasets
      .map((ds) => `${ds}=${countByDataset[ds] ?? 0}`)
      .join(' ')} deduped_total=${records.length} added=${added} removed=${removed} investigations=${investigationRecords.length} httpCalls=${fetchLog.httpCalls}`,
  );
  emitCost();

  return {
    fetchedAt,
    ongoingCount: countByDataset.ongoing ?? 0,
    completedCount: countByDataset.completed ?? 0,
    investigationCount: investigationRecords.length,
    added,
    removed,
    ok: true,
  };
}

export function toSyncCostRecord(startedAt: number, httpCalls: number): OperationCostRecord {
  return {
    operation: 'syncIndex',
    httpCalls,
    llmCalls: 0,
    latencyMs: Date.now() - startedAt,
    at: new Date().toISOString(),
  };
}
