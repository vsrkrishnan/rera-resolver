import type { OperationCostRecord, StateCode } from './types.js';
import { readSnapshot, resolveDbPathForState } from './storage.js';
import { syncIndex } from './syncIndex.js';
import { DEFAULT_STATE, INDEX_MAX_AGE_DAYS } from './config.js';

export interface EnsureIndexOptions {
  dbPath?: string;
  state?: StateCode; // which state's index to ensure (defaults to KA)
  maxAgeDays?: number;
  onLog?: (line: string) => void;
  onCost?: (record: OperationCostRecord) => void;
}

export type EnsureIndexStatus = 'ready' | 'built' | 'refreshing' | 'unavailable';

export interface EnsureIndexResult {
  status: EnsureIndexStatus;
  fetchedAt?: string;
}

// The bootstrap/freshness primitive behind both the postinstall hook and the
// `rera-resolver sync`/`status` CLI. Not called automatically by resolve()
// itself — resolve() stays a pure local read (no surprise network calls
// inside a query), and instead reports unresolvedReason: 'index_not_ready'
// so a caller can decide when to call this.
export async function ensureIndex(options: EnsureIndexOptions = {}): Promise<EnsureIndexResult> {
  const state = options.state ?? DEFAULT_STATE;
  const dbPath = options.dbPath ?? resolveDbPathForState(state);
  const maxAgeDays = options.maxAgeDays ?? INDEX_MAX_AGE_DAYS;
  const log = options.onLog ?? (() => {});
  const onCost = options.onCost;

  const snapshot = readSnapshot(dbPath);

  if (!snapshot || snapshot.records.length === 0) {
    log('[ensureIndex] no local index found — building now (this hits the live portal)...');
    const result = await syncIndex({ dbPath, state, onLog: log, onCost });
    return result.ok ? { status: 'built', fetchedAt: result.fetchedAt } : { status: 'unavailable' };
  }

  const ageMs = Date.now() - new Date(snapshot.fetchedAt).getTime();
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  if (ageMs <= maxAgeMs) {
    return { status: 'ready', fetchedAt: snapshot.fetchedAt };
  }

  log(`[ensureIndex] local index is stale (fetchedAt=${snapshot.fetchedAt}), refreshing in the background...`);
  // Stale-while-revalidate: never block the caller on a portal crawl for data
  // that's still usable. Errors are swallowed — a failed background refresh
  // just leaves the current (stale-but-usable) snapshot in place for the next
  // ensureIndex() call to retry.
  void syncIndex({ dbPath, state, onLog: log, onCost }).catch(() => {});

  return { status: 'refreshing', fetchedAt: snapshot.fetchedAt };
}
