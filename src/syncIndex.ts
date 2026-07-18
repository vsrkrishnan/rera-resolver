import type { SyncResult, OperationCostRecord } from './types.js';
import {
  fetchOngoingHtml,
  fetchCompletedHtml,
  fetchUnregisteredProjectsHtml,
  type FetchLog,
} from './registryFetch.js';
import { parseOngoing, parseCompleted, parseInvestigationList, dedupeRecords } from './parse.js';
import { readSnapshot, readInvestigationSnapshot, writeSnapshot, DEFAULT_DB_PATH } from './storage.js';

// Sanity floors, not hard-coded expectations of an exact count — the portal's
// real counts drift week to week. These exist purely to catch the failure
// mode the spec calls out explicitly: a parser silently breaking (portal HTML
// structure changes) making counts crater to near-zero while still returning
// HTTP 200. Confirmed live order of magnitude (Phase 1.0): ongoing ~9.7k,
// completed ~3.4k. Investigation list confirmed 2026-07-18: ~1,050.
const MIN_PLAUSIBLE_ONGOING = 3_000;
const MIN_PLAUSIBLE_COMPLETED = 1_000;
const MIN_PLAUSIBLE_INVESTIGATION = 500;

export interface SyncOptions {
  dbPath?: string;
  onLog?: (line: string) => void;
  // Per spec §9: every external call must be instrumented. SyncResult's shape
  // is normative (spec §5.5) so this rides along as a side-channel callback
  // rather than an extra field on the return value.
  onCost?: (record: OperationCostRecord) => void;
}

export async function syncIndex(options: SyncOptions = {}): Promise<SyncResult> {
  const dbPath = options.dbPath ?? DEFAULT_DB_PATH;
  const log = options.onLog ?? (() => {});
  const onCost = options.onCost ?? (() => {});
  const startedAt = Date.now();
  const fetchLog: FetchLog = { httpCalls: 0 };
  const fetchedAt = new Date().toISOString();
  const emitCost = () => onCost(toSyncCostRecord(startedAt, fetchLog.httpCalls));

  const previous = readSnapshot(dbPath);
  const previousInvestigations = readInvestigationSnapshot(dbPath);

  const [ongoingHtml, completedHtml, investigationHtml] = await Promise.all([
    fetchOngoingHtml(fetchLog),
    fetchCompletedHtml(fetchLog),
    fetchUnregisteredProjectsHtml(fetchLog),
  ]);

  // Ongoing/completed are the core path — either failing fails the whole
  // sync, same as before this dataset was added.
  if (!ongoingHtml || !completedHtml) {
    log(
      `[syncIndex] FAILED: fetch failure (ongoing=${ongoingHtml ? 'ok' : 'null'}, completed=${completedHtml ? 'ok' : 'null'}). Keeping prior snapshot.`,
    );
    emitCost();
    return {
      fetchedAt,
      ongoingCount: previous?.ongoingCount ?? 0,
      completedCount: previous?.completedCount ?? 0,
      investigationCount: previousInvestigations?.records.length ?? 0,
      added: 0,
      removed: 0,
      ok: false,
    };
  }

  const ongoingRecords = parseOngoing(ongoingHtml);
  const completedRecords = parseCompleted(completedHtml);

  if (ongoingRecords.length < MIN_PLAUSIBLE_ONGOING || completedRecords.length < MIN_PLAUSIBLE_COMPLETED) {
    log(
      `[syncIndex] FAILED: parsed counts below sanity floor (ongoing=${ongoingRecords.length}, completed=${completedRecords.length}) — likely a portal HTML structure change broke the parser. Keeping prior snapshot, NOT swapping.`,
    );
    emitCost();
    return {
      fetchedAt,
      ongoingCount: previous?.ongoingCount ?? 0,
      completedCount: previous?.completedCount ?? 0,
      investigationCount: previousInvestigations?.records.length ?? 0,
      added: 0,
      removed: 0,
      ok: false,
    };
  }

  // Investigation list is a secondary/supplementary dataset — a hiccup on
  // this specific endpoint (or a parser break) does NOT fail the whole sync,
  // it just carries the previous investigation snapshot forward rather than
  // wiping real data. This list has historically gone stale for years at a
  // stretch (Phase 1.0 investigation: last publish date 2021-10-22 as of a
  // 2026-07-18 check) — degrading gracefully here matters more than usual.
  let investigationRecords = investigationHtml ? parseInvestigationList(investigationHtml) : [];
  let investigationFetchedAt = fetchedAt;
  if (!investigationHtml || investigationRecords.length < MIN_PLAUSIBLE_INVESTIGATION) {
    log(
      `[syncIndex] WARN: investigation list fetch/parse looked wrong (html=${investigationHtml ? 'ok' : 'null'}, parsed=${investigationRecords.length}) — keeping prior investigation snapshot.`,
    );
    investigationRecords = previousInvestigations?.records ?? [];
    investigationFetchedAt = previousInvestigations?.fetchedAt ?? fetchedAt;
  }

  const records = dedupeRecords([...ongoingRecords, ...completedRecords]);

  const previousRegNumbers = new Set((previous?.records ?? []).map((r) => r.regNumber));
  const currentRegNumbers = new Set(records.map((r) => r.regNumber));
  const added = [...currentRegNumbers].filter((r) => !previousRegNumbers.has(r)).length;
  const removed = [...previousRegNumbers].filter((r) => !currentRegNumbers.has(r)).length;

  // Build fully, then swap (writeSnapshot renames a temp file over dbPath) —
  // never leaves the store half-written even on a crash mid-write.
  writeSnapshot(
    {
      fetchedAt,
      ongoingCount: ongoingRecords.length,
      completedCount: completedRecords.length,
      records,
    },
    {
      fetchedAt: investigationFetchedAt,
      records: investigationRecords,
    },
    dbPath,
  );

  log(
    `[syncIndex] OK: ongoing=${ongoingRecords.length} completed=${completedRecords.length} deduped_total=${records.length} added=${added} removed=${removed} investigations=${investigationRecords.length} httpCalls=${fetchLog.httpCalls}`,
  );
  emitCost();

  return {
    fetchedAt,
    ongoingCount: ongoingRecords.length,
    completedCount: completedRecords.length,
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
