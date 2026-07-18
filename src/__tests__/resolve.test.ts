import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeSnapshot } from '../storage.js';
import { resolve, projectsByPromoter } from '../resolve.js';
import type { IndexRecord, LlmClient, OperationCostRecord } from '../types.js';

function withTempDb(fn: (dbPath: string) => void | Promise<void>) {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rera-resolver-test-'));
    const dbPath = join(dir, 'index.db');
    try {
      await fn(dbPath);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

function seed(dbPath: string, records: IndexRecord[], ongoingCount = 2, completedCount = 1) {
  writeSnapshot(
    { fetchedAt: new Date().toISOString(), ongoingCount, completedCount, records },
    { fetchedAt: new Date().toISOString(), records: [] },
    dbPath,
  );
}

const RECORDS: IndexRecord[] = [
  {
    regNumber: 'PRM/KA/RERA/0001',
    registeredName: 'Prestige Lakeside Habitat',
    promoterName: 'Prestige Estates Projects Ltd',
    dataset: 'ongoing',
  },
  {
    regNumber: 'PRM/KA/RERA/0002',
    registeredName: 'Sri Sai Residency',
    promoterName: 'Sai Constructions',
    dataset: 'completed',
    completedRowId: '999',
  },
  {
    regNumber: 'PRM/KA/RERA/0003',
    registeredName: 'Green Valley Meadows',
    promoterName: 'ACME Developers Pvt Ltd',
    dataset: 'ongoing',
  },
];

test(
  'resolve returns high_confidence for an exact match',
  withTempDb(async (dbPath) => {
    seed(dbPath, RECORDS);
    const result = await resolve('Prestige Lakeside Habitat', undefined, { dbPath });
    assert.equal(result.status, 'high_confidence');
    assert.equal(result.candidates[0].regNumber, 'PRM/KA/RERA/0001');
    assert.equal(result.query.name, 'Prestige Lakeside Habitat');
  }),
);

test(
  'resolve returns unresolved with no_candidates against an empty index',
  withTempDb(async (dbPath) => {
    seed(dbPath, [], 0, 0);
    const result = await resolve('Anything At All', undefined, { dbPath });
    assert.equal(result.status, 'unresolved');
    assert.equal(result.unresolvedReason, 'no_candidates');
    assert.deepEqual(result.candidates, []);
  }),
);

test(
  'resolve never auto-confirms: candidates array always present with scores, even at high_confidence',
  withTempDb(async (dbPath) => {
    seed(dbPath, RECORDS);
    const result = await resolve('Sri Sai Residency', undefined, { dbPath });
    assert.equal(result.status, 'high_confidence');
    assert.ok(result.candidates.length >= 1);
    assert.ok(typeof result.candidates[0].matchScore === 'number');
    assert.ok(result.candidates[0].evidence.length > 0);
  }),
);

test(
  'projectsByPromoter matches on promoter name via the local index only',
  withTempDb(async (dbPath) => {
    seed(dbPath, RECORDS);
    const scoped = await projectsByPromoter('Prestige Estates Projects', { dbPath });
    assert.ok(scoped.length >= 1);
    assert.equal(scoped[0].regNumber, 'PRM/KA/RERA/0001');
  }),
);

// Tier 3 (LLM semantic bridge). "M/s XYZ Developers Pvt Ltd" shares zero
// tokens with any registeredName in RECORDS, so Tiers 0-2 alone produce no
// signal at all — the exact zero-overlap case Tier 3 exists for.
const ZERO_OVERLAP_QUERY = 'M/s XYZ Developers Pvt Ltd';

test(
  'resolve without an llmClient never invokes Tier 3 (opt-in, zero LLM cost by default)',
  withTempDb(async (dbPath) => {
    seed(dbPath, RECORDS);
    const result = await resolve(ZERO_OVERLAP_QUERY, undefined, { dbPath });
    assert.equal(result.status, 'unresolved');
    assert.equal(result.candidates.some((c) => c.matchTier === 'llm_semantic'), false);
  }),
);

test(
  'resolve with an llmClient surfaces a real regNumber the LLM names, even outside the shortlist, as llm_semantic',
  withTempDb(async (dbPath) => {
    seed(dbPath, RECORDS);
    const llmClient: LlmClient = {
      async matchShortlist() {
        return {
          matches: [{ regNumber: 'PRM/KA/RERA/0001', reasoning: 'Lakeside Habitat is a Prestige Estates project' }],
        };
      },
    };
    const result = await resolve(ZERO_OVERLAP_QUERY, undefined, { dbPath, llmClient });
    assert.equal(result.status, 'ambiguous'); // never high_confidence from an llm_semantic match alone
    const llmCandidate = result.candidates.find((c) => c.regNumber === 'PRM/KA/RERA/0001');
    assert.ok(llmCandidate);
    assert.equal(llmCandidate!.matchTier, 'llm_semantic');
  }),
);

test(
  'resolve discards a hallucinated regNumber from the llmClient, never surfacing it',
  withTempDb(async (dbPath) => {
    seed(dbPath, RECORDS);
    const llmClient: LlmClient = {
      async matchShortlist() {
        return { matches: [{ regNumber: 'PRM/KA/RERA/DOES-NOT-EXIST', reasoning: 'plausible-sounding guess' }] };
      },
    };
    const result = await resolve(ZERO_OVERLAP_QUERY, undefined, { dbPath, llmClient });
    assert.equal(result.status, 'unresolved');
    assert.equal(result.candidates.some((c) => c.regNumber === 'PRM/KA/RERA/DOES-NOT-EXIST'), false);
  }),
);

test(
  'resolve emits an onCost record with llmCalls: 1 only when Tier 3 actually ran',
  withTempDb(async (dbPath) => {
    seed(dbPath, RECORDS);
    const llmClient: LlmClient = {
      async matchShortlist() {
        return { matches: [], inputTokens: 42, outputTokens: 7, costInr: 0.01 };
      },
    };

    const costRecords: OperationCostRecord[] = [];
    await resolve(ZERO_OVERLAP_QUERY, undefined, { dbPath, llmClient, onCost: (r) => costRecords.push(r) });
    assert.equal(costRecords.length, 1);
    assert.equal(costRecords[0].llmCalls, 1);
    assert.equal(costRecords[0].llmInputTokens, 42);

    // Tiers 0-2 already high_confidence on an exact match -> Tier 3 must not run.
    costRecords.length = 0;
    await resolve('Prestige Lakeside Habitat', undefined, { dbPath, llmClient, onCost: (r) => costRecords.push(r) });
    assert.equal(costRecords.length, 1);
    assert.equal(costRecords[0].llmCalls, 0);
  }),
);
