import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeSnapshot, readSnapshot, resolveDbPathForState } from '../../storage.js';
import { getAdapter, SUPPORTED_STATES } from '../../adapters/registry.js';
import type { IndexRecord } from '../../types.js';

const RECORD: IndexRecord = {
  regNumber: 'PRM/KA/RERA/0001',
  registeredName: 'Prestige Lakeside Habitat',
  promoterName: 'Prestige Estates Projects Ltd',
  dataset: 'ongoing',
};

test('resolveDbPathForState: an explicit RERA_RESOLVER_DB_PATH pins one file regardless of state (single-state mode)', () => {
  const prev = process.env.RERA_RESOLVER_DB_PATH;
  process.env.RERA_RESOLVER_DB_PATH = '/tmp/pinned.db';
  try {
    assert.equal(resolveDbPathForState('KA'), '/tmp/pinned.db');
    assert.equal(resolveDbPathForState('TN'), '/tmp/pinned.db');
  } finally {
    if (prev === undefined) delete process.env.RERA_RESOLVER_DB_PATH;
    else process.env.RERA_RESOLVER_DB_PATH = prev;
  }
});

test('resolveDbPathForState: without a pinned path, each state gets its own index-<state>.db under the dir override', () => {
  const prevPath = process.env.RERA_RESOLVER_DB_PATH;
  const prevDir = process.env.RERA_RESOLVER_DB_DIR;
  delete process.env.RERA_RESOLVER_DB_PATH;
  process.env.RERA_RESOLVER_DB_DIR = '/var/data/rera';
  try {
    assert.equal(resolveDbPathForState('KA'), '/var/data/rera/index-ka.db');
    assert.equal(resolveDbPathForState('TN'), '/var/data/rera/index-tn.db');
    assert.equal(resolveDbPathForState('MH'), '/var/data/rera/index-mh.db');
  } finally {
    if (prevPath !== undefined) process.env.RERA_RESOLVER_DB_PATH = prevPath;
    if (prevDir === undefined) delete process.env.RERA_RESOLVER_DB_DIR;
    else process.env.RERA_RESOLVER_DB_DIR = prevDir;
  }
});

test('storage round-trips the snapshot state via meta and stamps it onto every record', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rera-state-test-'));
  const dbPath = join(dir, 'index.db');
  try {
    writeSnapshot(
      { fetchedAt: new Date().toISOString(), state: 'KA', ongoingCount: 1, completedCount: 0, records: [RECORD] },
      { fetchedAt: new Date().toISOString(), records: [] },
      dbPath,
    );
    const snapshot = readSnapshot(dbPath);
    assert.ok(snapshot);
    assert.equal(snapshot.state, 'KA');
    assert.equal(snapshot.records[0].state, 'KA');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('storage defaults an older, state-less snapshot to KA on read (backward compatibility)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rera-state-test-'));
  const dbPath = join(dir, 'index.db');
  try {
    // Omit state entirely — mirrors a DB written before multi-state support.
    writeSnapshot(
      { fetchedAt: new Date().toISOString(), ongoingCount: 1, completedCount: 0, records: [RECORD] },
      { fetchedAt: new Date().toISOString(), records: [] },
      dbPath,
    );
    const snapshot = readSnapshot(dbPath);
    assert.equal(snapshot?.state, 'KA');
    assert.equal(snapshot?.records[0].state, 'KA');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('adapter registry: Karnataka is supported and shaped correctly; an unimplemented state errors clearly', () => {
  assert.ok(SUPPORTED_STATES.includes('KA'));
  const ka = getAdapter('KA');
  assert.equal(ka.code, 'KA');
  // Two crawl sources; the engine drives them opaquely (see CrawlSource).
  assert.deepEqual(
    ka.sources.map((s) => s.id),
    ['ongoing', 'completed'],
  );
  assert.equal(ka.hasInvestigationList, true);
  // MH has no adapter yet — must fail loudly, not silently crawl the wrong portal.
  assert.throws(() => getAdapter('MH'), /No RERA adapter for state "MH"/);
});

test('adapter registry: Tamil Nadu is supported and shaped for a single unsplit registered pool', () => {
  assert.ok(SUPPORTED_STATES.includes('TN'));
  const tn = getAdapter('TN');
  assert.equal(tn.code, 'TN');
  assert.equal(tn.name, 'Tamil Nadu');
  // TN crawls three sources — the online e-registered tables plus the offline
  // building and layout archives — and has no Karnataka-style investigation list.
  assert.deepEqual(
    tn.sources.map((s) => s.id).sort(),
    ['offline-building', 'offline-layout', 'online'],
  );
  assert.equal(tn.hasInvestigationList, false);
});
