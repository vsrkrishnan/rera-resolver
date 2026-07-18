import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreRecord } from '../matcher.js';
import { MATCH_THRESHOLDS } from '../config.js';
import type { IndexRecord } from '../types.js';

function record(overrides: Partial<IndexRecord>): IndexRecord {
  return {
    regNumber: 'PRM/KA/RERA/TEST/000001',
    registeredName: 'Green Valley Meadows',
    promoterName: 'ACME Developers Pvt Ltd',
    dataset: 'ongoing',
    ...overrides,
  };
}

test('Tier 1: exact normalized match scores 1.0', () => {
  const r = record({ registeredName: 'Prestige Lakeside Habitat' });
  const c = scoreRecord('prestige   LAKESIDE habitat!!', undefined, r);
  assert.equal(c.matchScore, 1.0);
  assert.equal(c.matchTier, 'exact');
});

test('Tier 2 failure mode: word-order variation scores high', () => {
  const r = record({ registeredName: 'Sri Sai Residency' });
  const c = scoreRecord('Sai Sri Residency', undefined, r);
  assert.ok(c.matchScore >= MATCH_THRESHOLDS.highConfidence, `expected >= ${MATCH_THRESHOLDS.highConfidence}, got ${c.matchScore}`);
  assert.equal(c.matchTier, 'token');
});

test('Tier 2 failure mode: token gap / extra token gives partial, not zero, credit', () => {
  const r = record({ registeredName: 'Green Valley Meadows' });
  const c = scoreRecord('Green Meadows', undefined, r);
  assert.ok(c.matchScore > 0.5 && c.matchScore < 1.0, `expected partial credit, got ${c.matchScore}`);
});

test('Tier 2 failure mode: minor typo still matches via per-token edit distance', () => {
  const r = record({ registeredName: 'Sri Sai Residency' });
  const c = scoreRecord('Sri Sai Residancy', undefined, r); // typo: Residancy vs Residency
  assert.ok(c.matchScore >= MATCH_THRESHOLDS.highConfidence, `expected >= ${MATCH_THRESHOLDS.highConfidence}, got ${c.matchScore}`);
});

test('unrelated names score low', () => {
  const r = record({ registeredName: 'Godrej Regent Park' });
  const c = scoreRecord('Totally Different Project Name', undefined, r);
  assert.ok(c.matchScore < MATCH_THRESHOLDS.floor, `expected below floor, got ${c.matchScore}`);
});

test('promoter hint boosts score when it corroborates', () => {
  const r = record({ registeredName: 'Green Meadows Phase 2', promoterName: 'Prestige Estates Projects Ltd' });
  const withoutHint = scoreRecord('Green Meadows', undefined, r);
  const withHint = scoreRecord('Green Meadows', { promoterName: 'Prestige Estates Projects' }, r);
  assert.ok(withHint.matchScore >= withoutHint.matchScore, 'promoter hint should not decrease score when it corroborates');
});

test('evidence is always populated', () => {
  const r = record({ registeredName: 'Any Project' });
  const c = scoreRecord('Any Project', undefined, r);
  assert.ok(c.evidence.length > 0);
});

// Real bug found via live testing: master-planned communities register each
// tower as "<Tower> @ The <Community>" (verified: 9 real "@ The Prestige
// City" sub-projects). A short community-name query is a strict subset of
// the much longer registered name, and the plain symmetric average
// unfairly penalized this down below unrelated same-length matches.
test('master-community naming: short community query matches a long "@ The Community" registered name well', () => {
  const r = record({ registeredName: 'Fernvale @ The Prestige City', promoterName: 'Prestige Projects Private Limited' });
  const c = scoreRecord('Prestige City', undefined, r);
  assert.ok(c.matchScore >= MATCH_THRESHOLDS.floor, `expected containment to lift this above floor, got ${c.matchScore}`);
});

test('master-community naming: containment does not trigger for a single generic token', () => {
  const r = record({ registeredName: 'Some Random City Layout' });
  const c = scoreRecord('City', undefined, r);
  assert.ok(c.matchScore < MATCH_THRESHOLDS.floor, `a single generic word should not cheaply "contain-match", got ${c.matchScore}`);
});
