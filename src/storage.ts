import Database from 'better-sqlite3';
import { existsSync, renameSync, unlinkSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import type { IndexRecord, IndexSnapshot, InvestigationRecord, StateCode } from './types.js';
import { DEFAULT_STATE } from './config.js';

// SQLite over a flat JSON file (spec §4.2 — either is acceptable, this is the
// documented choice): ~13k rows is trivial for SQLite, and projectsByPromoter
// (§5.4) is a natural indexed query rather than a full in-memory linear scan
// re-implemented by hand. A relational store also leaves room for a future
// promoter->projects edge table without a storage-layer rewrite.
//
// The path must be stable and absolute rather than cwd-relative: an installed
// package's postinstall bootstrap and a consuming app's later resolve() call
// run from different working directories, so a relative path would silently
// point each of them at a different file. RERA_RESOLVER_DB_PATH lets a
// consumer (or this repo's own dev scripts) override it explicitly.
function resolveDefaultDbPath(): string {
  if (process.env.RERA_RESOLVER_DB_PATH) return process.env.RERA_RESOLVER_DB_PATH;
  return join(resolveCacheDir(), 'rera-resolver', 'index.db');
}

function resolveCacheDir(): string {
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Caches');
  if (process.platform === 'win32') return process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local');
  return process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache');
}

export const DEFAULT_DB_PATH = resolveDefaultDbPath();

// Per-state DB path. Each state gets its own SQLite file (index-ka.db,
// index-tn.db, …) so each syncs and goes stale independently and adding a
// state can never corrupt another's data (the writeSnapshot atomic whole-file
// rebuild below stays per-file). An explicit RERA_RESOLVER_DB_PATH still wins
// and pins a single file regardless of state — this is the "single-state"
// mode the dev scripts, tests, and single-registry consumers use.
// RERA_RESOLVER_DB_DIR overrides just the directory, keeping the per-state
// filenames.
export function resolveDbPathForState(state: StateCode): string {
  if (process.env.RERA_RESOLVER_DB_PATH) return process.env.RERA_RESOLVER_DB_PATH;
  const baseDir = process.env.RERA_RESOLVER_DB_DIR ?? join(resolveCacheDir(), 'rera-resolver');
  return join(baseDir, `index-${state.toLowerCase()}.db`);
}

export interface InvestigationSnapshot {
  fetchedAt: string;
  records: InvestigationRecord[];
}

function ensureDir(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE records (
      regNumber TEXT PRIMARY KEY,
      registeredName TEXT NOT NULL,
      promoterName TEXT NOT NULL,
      dataset TEXT NOT NULL,
      projectType TEXT,
      district TEXT,
      taluk TEXT,
      proposedCompletionDate TEXT,
      appliedForCompletionDate TEXT,
      completedRowId TEXT
    );
    CREATE INDEX idx_records_promoter ON records(promoterName);
    CREATE TABLE investigations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      projectName TEXT NOT NULL,
      promoterName TEXT NOT NULL,
      status TEXT NOT NULL,
      rawStatus TEXT NOT NULL,
      corporateAddress TEXT NOT NULL,
      publishedDate TEXT NOT NULL
    );
  `);
}

// Builds a brand-new DB file at a temp path, then renames it over dbPath.
// rename() is atomic on POSIX, so a crash mid-write never leaves dbPath
// pointing at a half-populated file, and a reader never observes a partial
// swap (spec §5.5: "build the new snapshot fully, then swap"). Both tables
// are written in the same temp-file-then-rename cycle so the registered-
// project index and the investigation list can never observe each other
// half-updated. `investigations` is a required (not optional-defaulting-to-
// empty) parameter deliberately — writeSnapshot always does a full rebuild,
// so an accidentally-omitted investigations argument would otherwise silently
// wipe real data rather than erroring.
export function writeSnapshot(
  snapshot: IndexSnapshot,
  investigations: InvestigationSnapshot,
  dbPath: string = DEFAULT_DB_PATH,
): void {
  ensureDir(dbPath);
  const tmpPath = `${dbPath}.${process.pid}.${Date.now()}.tmp`;
  if (existsSync(tmpPath)) unlinkSync(tmpPath);

  const db = new Database(tmpPath);
  try {
    createSchema(db);
    const insertMeta = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)');
    insertMeta.run('fetchedAt', snapshot.fetchedAt);
    // Which state this DB holds. Stored once here (not as a per-row column)
    // since a DB is single-state; readSnapshot stamps it onto every record.
    insertMeta.run('state', snapshot.state ?? DEFAULT_STATE);
    insertMeta.run('ongoingCount', String(snapshot.ongoingCount));
    insertMeta.run('completedCount', String(snapshot.completedCount));
    insertMeta.run('investigationFetchedAt', investigations.fetchedAt);
    insertMeta.run('investigationCount', String(investigations.records.length));

    const insertRecord = db.prepare(`
      INSERT INTO records (
        regNumber, registeredName, promoterName, dataset,
        projectType, district, taluk, proposedCompletionDate, appliedForCompletionDate, completedRowId
      ) VALUES (@regNumber, @registeredName, @promoterName, @dataset,
        @projectType, @district, @taluk, @proposedCompletionDate, @appliedForCompletionDate, @completedRowId)
    `);
    const insertInvestigation = db.prepare(`
      INSERT INTO investigations (projectName, promoterName, status, rawStatus, corporateAddress, publishedDate)
      VALUES (@projectName, @promoterName, @status, @rawStatus, @corporateAddress, @publishedDate)
    `);

    const insertAll = db.transaction((records: IndexRecord[], investigationRecords: InvestigationRecord[]) => {
      for (const r of records) {
        insertRecord.run({
          regNumber: r.regNumber,
          registeredName: r.registeredName,
          promoterName: r.promoterName,
          dataset: r.dataset,
          projectType: r.projectType ?? null,
          district: r.district ?? null,
          taluk: r.taluk ?? null,
          proposedCompletionDate: r.proposedCompletionDate ?? null,
          appliedForCompletionDate: r.appliedForCompletionDate ?? null,
          completedRowId: r.completedRowId ?? null,
        });
      }
      for (const inv of investigationRecords) {
        insertInvestigation.run(inv);
      }
    });
    insertAll(snapshot.records, investigations.records);
  } finally {
    db.close();
  }

  renameSync(tmpPath, dbPath);
}

function rowToRecord(row: Record<string, unknown>, state: StateCode): IndexRecord {
  return {
    regNumber: row.regNumber as string,
    registeredName: row.registeredName as string,
    promoterName: row.promoterName as string,
    dataset: row.dataset as IndexRecord['dataset'],
    state,
    projectType: (row.projectType as string) ?? undefined,
    district: (row.district as string) ?? undefined,
    taluk: (row.taluk as string) ?? undefined,
    proposedCompletionDate: (row.proposedCompletionDate as string) ?? undefined,
    appliedForCompletionDate: (row.appliedForCompletionDate as string) ?? undefined,
    completedRowId: (row.completedRowId as string) ?? undefined,
  };
}

function rowToInvestigationRecord(row: Record<string, unknown>): InvestigationRecord {
  return {
    projectName: row.projectName as string,
    promoterName: row.promoterName as string,
    status: row.status as InvestigationRecord['status'],
    rawStatus: row.rawStatus as string,
    corporateAddress: row.corporateAddress as string,
    publishedDate: row.publishedDate as string,
  };
}

export function readSnapshot(dbPath: string = DEFAULT_DB_PATH): IndexSnapshot | null {
  if (!existsSync(dbPath)) return null;
  const db = new Database(dbPath, { readonly: true });
  try {
    const meta = new Map(
      (db.prepare('SELECT key, value FROM meta').all() as { key: string; value: string }[]).map((r) => [
        r.key,
        r.value,
      ]),
    );
    // Older DB files (written before multi-state support) have no `state`
    // meta key — they are Karnataka by definition, so default to it.
    const state = (meta.get('state') as StateCode) ?? DEFAULT_STATE;
    const records = (db.prepare('SELECT * FROM records').all() as Record<string, unknown>[]).map((row) =>
      rowToRecord(row, state),
    );
    return {
      fetchedAt: meta.get('fetchedAt') ?? '',
      ongoingCount: Number(meta.get('ongoingCount') ?? 0),
      completedCount: Number(meta.get('completedCount') ?? 0),
      records,
      state,
    };
  } finally {
    db.close();
  }
}

export function readInvestigationSnapshot(dbPath: string = DEFAULT_DB_PATH): InvestigationSnapshot | null {
  if (!existsSync(dbPath)) return null;
  const db = new Database(dbPath, { readonly: true });
  try {
    const meta = new Map(
      (db.prepare('SELECT key, value FROM meta').all() as { key: string; value: string }[]).map((r) => [
        r.key,
        r.value,
      ]),
    );
    // Tables created by an older writeSnapshot (before this table existed)
    // won't have `investigations` — treat that the same as "no data yet"
    // rather than throwing, since it's a real state a not-yet-resynced
    // consumer's cached db file can be in.
    const tableExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='investigations'")
      .get();
    if (!tableExists) return null;
    const records = (db.prepare('SELECT * FROM investigations').all() as Record<string, unknown>[]).map(
      rowToInvestigationRecord,
    );
    return {
      fetchedAt: meta.get('investigationFetchedAt') ?? '',
      records,
    };
  } finally {
    db.close();
  }
}
