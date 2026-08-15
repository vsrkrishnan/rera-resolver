import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildShortlist, runLlmSemanticBridge } from '../../llmBridge.js';
import { MAX_LLM_SHORTLIST } from '../../config.js';
import type { Candidate, IndexRecord, LlmClient, LlmMatchRequest } from '../../types.js';

function record(overrides: Partial<IndexRecord>): IndexRecord {
  return {
    regNumber: 'PRM/KA/RERA/TEST/000001',
    registeredName: 'Green Valley Meadows',
    promoterName: 'ACME Developers Pvt Ltd',
    dataset: 'ongoing',
    ...overrides,
  };
}

function candidate(overrides: Partial<Candidate>): Candidate {
  return {
    regNumber: 'PRM/KA/RERA/TEST/000001',
    registeredName: 'Green Valley Meadows',
    promoterName: 'ACME Developers Pvt Ltd',
    dataset: 'ongoing',
    matchScore: 0.3,
    matchTier: 'token',
    evidence: 'test',
    ...overrides,
  };
}

test('buildShortlist includes Tier 2 candidates, even below-floor ones', () => {
  const tier2 = [candidate({ regNumber: 'A', matchScore: 0.1 }), candidate({ regNumber: 'B', matchScore: 0.05 })];
  const shortlist = buildShortlist(undefined, [], tier2);
  assert.deepEqual(
    shortlist.map((s) => s.regNumber).sort(),
    ['A', 'B'],
  );
});

test('buildShortlist unions in a promoter hint\'s real projects', () => {
  const records = [
    record({ regNumber: 'X', promoterName: 'Prestige Estates Projects Ltd', registeredName: 'Prestige Falcon City' }),
    record({ regNumber: 'Y', promoterName: 'Totally Unrelated Builders', registeredName: 'Something Else' }),
  ];
  const shortlist = buildShortlist({ promoterName: 'Prestige Estates Projects' }, records, []);
  assert.deepEqual(
    shortlist.map((s) => s.regNumber),
    ['X'],
  );
});

test('buildShortlist caps at MAX_LLM_SHORTLIST', () => {
  const tier2 = Array.from({ length: MAX_LLM_SHORTLIST + 10 }, (_, i) =>
    candidate({ regNumber: `R${i}`, matchScore: 0.01 }),
  );
  const shortlist = buildShortlist(undefined, [], tier2);
  assert.equal(shortlist.length, MAX_LLM_SHORTLIST);
});

test('buildShortlist returns empty for the true zero-signal, no-hint case', () => {
  const shortlist = buildShortlist(undefined, [], []);
  assert.deepEqual(shortlist, []);
});

test('runLlmSemanticBridge surfaces a real regNumber the LLM names, even one outside the shortlist', () => {
  const records = [record({ regNumber: 'REAL/001', registeredName: 'Prestige Lakeside Habitat', promoterName: 'Prestige Estates Projects Ltd' })];
  const fakeLlm: LlmClient = {
    async matchShortlist(_req: LlmMatchRequest) {
      // Deliberately names a regNumber that was NOT in the shortlist we sent
      // it (empty shortlist) — this is the whole point of Tier 3: the LLM
      // can draw on world knowledge beyond what local matching narrowed
      // down to.
      return { matches: [{ regNumber: 'REAL/001', reasoning: 'Prestige Lakeside relates to Prestige Estates Projects' }] };
    },
  };

  return runLlmSemanticBridge('Prestige Lakeside Habitat', undefined, [], records, fakeLlm).then((outcome) => {
    assert.equal(outcome.candidates.length, 1);
    assert.equal(outcome.candidates[0].regNumber, 'REAL/001');
    assert.equal(outcome.candidates[0].matchTier, 'llm_semantic');
    assert.ok(outcome.candidates[0].evidence.includes('Prestige Estates Projects'));
  });
});

test('runLlmSemanticBridge discards a hallucinated regNumber not present in the real index', async () => {
  const records = [record({ regNumber: 'REAL/001' })];
  const fakeLlm: LlmClient = {
    async matchShortlist() {
      return { matches: [{ regNumber: 'INVENTED/999', reasoning: 'sounds plausible' }] };
    },
  };

  const outcome = await runLlmSemanticBridge('Anything', undefined, [], records, fakeLlm);
  assert.deepEqual(outcome.candidates, []);
});

test('runLlmSemanticBridge degrades to empty candidates (not a throw) when the LLM call itself fails', async () => {
  const records = [record({ regNumber: 'REAL/001' })];
  const fakeLlm: LlmClient = {
    async matchShortlist() {
      throw new Error('network error');
    },
  };

  const outcome = await runLlmSemanticBridge('Anything', undefined, [], records, fakeLlm);
  assert.deepEqual(outcome.candidates, []);
  assert.equal(outcome.response, null);
});
