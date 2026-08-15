import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTokenStats, tokenWeight } from '../../tokenStats.js';
import type { IndexRecord } from '../../types.js';

function record(registeredName: string): IndexRecord {
  return { regNumber: registeredName, registeredName, promoterName: 'X', dataset: 'ongoing' };
}

test('a token appearing in fewer records gets a higher weight than a common one', () => {
  const records = [
    record('Keerthi Regalia'),
    record('Prestige Falcon City'),
    record('Prestige Jindal City'),
    record('Vintage City'),
    record('Silver City Layout'),
  ];
  const stats = buildTokenStats(records);
  const rare = tokenWeight(stats, 'keerthi'); // appears in 1/5
  const common = tokenWeight(stats, 'city'); // appears in 4/5
  assert.ok(rare > common, `expected rare word to outweigh common word, got rare=${rare} common=${common}`);
});

test('a token present in every record approaches the minimum weight (no distinguishing power)', () => {
  const records = [record('Alpha Layout'), record('Beta Layout'), record('Gamma Layout')];
  const stats = buildTokenStats(records);
  const weight = tokenWeight(stats, 'layout');
  assert.ok(weight > 0 && weight < 2, `expected a near-floor weight for a universal token, got ${weight}`);
});

test('a token unseen anywhere in the corpus still returns a finite, well-defined weight', () => {
  const records = [record('Alpha Layout')];
  const stats = buildTokenStats(records);
  const weight = tokenWeight(stats, 'nonexistentword');
  assert.ok(Number.isFinite(weight) && weight > 0);
});
