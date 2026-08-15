import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeSnapshot } from '../../storage.js';
import { resolve } from '../../resolve.js';
import { MATCH_THRESHOLDS } from '../../config.js';
import type { IndexRecord } from '../../types.js';

// Regression fixtures for real queries verified live against the actual
// rera.karnataka.gov.in index during development (2026-07-17/18). These lock
// in behavior that was manually confirmed correct BEFORE any further matcher
// tuning (specifically the token-rarity/IDF weighting work), so a future
// change can't silently regress what already works. Record names/promoters
// are copied verbatim from the live portal.
//
// IDF weight is inherently corpus-relative (rarity is measured against
// whatever index is loaded), so a handful of hand-written fixture records
// can't reproduce the real ~8,836-record index's actual word frequencies —
// "Keerthi" being rare (7/8,836) or "city" being common (261/8,836) is a
// property of the REAL production data, not something a 10-row fixture can
// recreate by frequency-counting alone (a word appearing in, say, 9 of 12
// fixture rows computes as nowhere near as rare as it needs to look). Rather
// than fabricate thousands of filler rows to force realistic proportions,
// every test below injects the actual measured production weights directly
// (see config.ts's calibration comment for how these numbers were computed),
// so they verify "does the scoring logic behave correctly given real-world
// rarity", decoupled from "did this tiny fixture happen to reproduce
// real-world statistics." The live smoke test (run manually against the real
// synced index, not part of this automated suite) is what confirms the
// production numbers themselves still look like this.
const REALISTIC_PRODUCTION_WEIGHTS: Record<string, number> = {
  keerthi: 8.01, // df 7/8836
  city: 4.52, // df 261/8836
  the: 4.67, // df 225/8836
  prestige: 5.58, // df 90/8836
};
function realisticWeightFn(token: string): number {
  return REALISTIC_PRODUCTION_WEIGHTS[token] ?? 4; // 4 = TOKEN_MATCH.defaultTokenWeight fallback for unlisted words
}

function withTempDb(fn: (dbPath: string) => void | Promise<void>) {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rera-resolver-live-test-'));
    const dbPath = join(dir, 'index.db');
    try {
      await fn(dbPath);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

function seed(dbPath: string, records: IndexRecord[]) {
  writeSnapshot(
    { fetchedAt: new Date().toISOString(), ongoingCount: records.length, completedCount: 0, records },
    { fetchedAt: new Date().toISOString(), records: [] },
    dbPath,
  );
}

const GODREJ_UNITED_FIXTURE: IndexRecord[] = [
  { regNumber: 'PRM/KA/RERA/1251/446/PR/171010/000003', registeredName: 'Godrej United', promoterName: 'United Oxygen Company Private Limited', dataset: 'ongoing' },
  { regNumber: 'PRM/KA/RERA/1251/446/PR/200323/003385', registeredName: 'UNITED DREAMS', promoterName: 'UNITED PROJECTS', dataset: 'ongoing' },
  { regNumber: 'PRM/KA/RERA/1251/446/PR/210422/004143', registeredName: 'UNITED BLOSSOM', promoterName: 'UNITED PROJECTS', dataset: 'ongoing' },
  { regNumber: 'PRM/KA/RERA/1251/446/PR/180120/002280', registeredName: 'UNITED MEADOWS', promoterName: 'UNITED BUILDERS', dataset: 'ongoing' },
  { regNumber: 'PRM/KA/RERA/1265/347/PR/130825/007992', registeredName: 'UNITED SERINITY', promoterName: 'UNITED ESTATES', dataset: 'ongoing' },
];

test(
  'live regression: "Godraj United" (typo) still correctly top-ranks the real Godrej United, clearly ahead',
  withTempDb(async (dbPath) => {
    seed(dbPath, GODREJ_UNITED_FIXTURE);
    const r = await resolve('Godraj United', undefined, { dbPath, tokenWeightFn: realisticWeightFn });
    assert.equal(r.candidates[0].registeredName, 'Godrej United');
    assert.ok(r.candidates[0].matchScore >= MATCH_THRESHOLDS.floor);
    assert.ok(
      !r.candidates[1] || r.candidates[0].matchScore - r.candidates[1].matchScore >= 0.2,
      'should be clearly ahead of the next real candidate',
    );
  }),
);

const PRESTIGE_CITY_FIXTURE: IndexRecord[] = [
  { regNumber: 'A', registeredName: 'Eaton Park @ The Prestige City', promoterName: 'PRESTIGE PROJECTS PRIVATE LIMITED', dataset: 'ongoing' },
  { regNumber: 'B', registeredName: 'Fernvale @ The Prestige City', promoterName: 'PRESTIGE PROJECTS PRIVATE LIMITED', dataset: 'ongoing' },
  { regNumber: 'C', registeredName: 'Aston Park @ The Prestige City', promoterName: 'PRESTIGE PROJECTS PRIVATE LIMITED', dataset: 'ongoing' },
  { regNumber: 'D', registeredName: 'Meridian Park Phase III @ The Prestige City', promoterName: 'PRESTIGE PROJECTS PRIVATE LIMITED', dataset: 'ongoing' },
  { regNumber: 'E', registeredName: 'Meridian Park Phase II @ The Prestige City', promoterName: 'PRESTIGE PROJECTS PRIVATE LIMITED', dataset: 'ongoing' },
  { regNumber: 'F', registeredName: 'Meridian Park Phase I @ The Prestige City', promoterName: 'PRESTIGE PROJECTS PRIVATE LIMITED', dataset: 'completed' },
  { regNumber: 'G', registeredName: 'ASPEN GREENS @ THE PRESTIGE CITY', promoterName: 'PRESTIGE PROJECTS PRIVATE LIMITED', dataset: 'completed' },
  { regNumber: 'H', registeredName: 'EDEN PARK @ THE PRESTIGE CITY', promoterName: 'Prestige Projects Private Limited', dataset: 'completed' },
  { regNumber: 'I', registeredName: 'THE PRESTIGE CITY - AVALON PARK', promoterName: 'Prestige Projects Private Limited', dataset: 'completed' },
  // Decoy: a real but unrelated Prestige-branded project. Deliberately only
  // one here (not the 3 real decoys — Falcon City, 2x Jindal City — found
  // live) because those genuinely tie with the 9 real sub-projects on pure
  // token containment (both fully contain "prestige"+"city" too — a real,
  // separate, already-understood limitation: containment alone can't tell
  // "the actual community" from "a different project sharing both words"
  // without semantic knowledge, which is exactly Tier 3's job, not Tier 2's).
  // With all 3 real decoys included, 12 candidates legitimately tie at the
  // containment score and MAX_CANDIDATES=10 has to cut 2 — that's a correct
  // outcome of a hard cap facing genuine ambiguity, not a scoring bug, so
  // it's excluded from this specific regression assertion to keep the two
  // concerns separate.
  { regNumber: 'J', registeredName: 'Prestige Falcon City', promoterName: 'PRESTIGE NOTTINGHILL INVESTMENTS', dataset: 'ongoing' },
];

test(
  'live regression: "Prestige city" surfaces all 9 real "@ The Prestige City" sub-projects above the floor',
  withTempDb(async (dbPath) => {
    seed(dbPath, PRESTIGE_CITY_FIXTURE);
    const r = await resolve('Prestige city', undefined, { dbPath, tokenWeightFn: realisticWeightFn });
    const realSubProjectIds = new Set(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I']);
    const foundIds = new Set(r.candidates.map((c) => c.regNumber));
    for (const id of realSubProjectIds) {
      assert.ok(foundIds.has(id), `expected sub-project ${id} to be surfaced, candidates were: ${JSON.stringify(r.candidates.map((c) => c.registeredName))}`);
    }
    assert.equal(r.status, 'ambiguous', 'a bare community name genuinely cannot pick one of 9 sub-projects');
  }),
);

const NAMBIAR_FIXTURE: IndexRecord[] = [
  { regNumber: 'PRM/KA/RERA/1251/308/PR/200825/008011', registeredName: 'Nambiar District 25 Phase 2', promoterName: 'Nambiar EnsembleResidential Projects LLP', dataset: 'ongoing' },
  { regNumber: 'PRM/KA/RERA/1251/308/PR/260526/008686', registeredName: 'Nambiar District 25 Phase 3', promoterName: 'Nambiar EnsembleResidential Projects LLP', dataset: 'ongoing' },
  { regNumber: 'PRM/KA/RERA/1251/308/PR/100125/007377', registeredName: 'Nambiar District 25 Phase 1', promoterName: 'Nambiar EnsembleResidential Projects LLP', dataset: 'ongoing' },
];

test(
  'live regression: "Nambiar District 25" surfaces all 3 real phases',
  withTempDb(async (dbPath) => {
    seed(dbPath, NAMBIAR_FIXTURE);
    const r = await resolve('Nambiar District 25', undefined, { dbPath, tokenWeightFn: realisticWeightFn });
    assert.equal(r.candidates.length, 3);
    assert.equal(r.status, 'ambiguous');
  }),
);

const BRIGADE_EL_DORADO_FIXTURE: IndexRecord[] = [
  { regNumber: 'A', registeredName: 'Cobalt at Brigade El Dorado', promoterName: 'Brigade Tetrarch Private Limited', dataset: 'ongoing' },
  { regNumber: 'B', registeredName: 'Aurum at Brigade El Dorado', promoterName: 'Brigade Tetrarch Private Limited', dataset: 'ongoing' },
  { regNumber: 'C', registeredName: 'Feldspar at Brigade El Dorado', promoterName: 'Brigade Tetrarch Private Limited', dataset: 'ongoing' },
  { regNumber: 'D', registeredName: 'Jasper and Iridium at Brigade El Dorado', promoterName: 'Brigade Tetrarch Private Limited', dataset: 'ongoing' },
  { regNumber: 'E', registeredName: 'Helio at Brigade El Dorado', promoterName: 'Brigade Tetrarch Private Limited', dataset: 'completed' },
  { regNumber: 'F', registeredName: 'Gallium at Brigade El Dorado', promoterName: 'Brigade Tetrarch Private Limited', dataset: 'completed' },
  // decoy: a real but unrelated Brigade project
  { regNumber: 'G', registeredName: 'Brigade Gem', promoterName: 'Brigade Enterprises Ltd', dataset: 'ongoing' },
];

test(
  'live regression: "Brigade El Dorado" surfaces the real sub-towers ahead of an unrelated Brigade project',
  withTempDb(async (dbPath) => {
    seed(dbPath, BRIGADE_EL_DORADO_FIXTURE);
    const r = await resolve('Brigade El Dorado', undefined, { dbPath, tokenWeightFn: realisticWeightFn });
    const top6 = r.candidates.slice(0, 6).map((c) => c.regNumber);
    for (const id of ['A', 'B', 'C', 'D', 'E', 'F']) {
      assert.ok(top6.includes(id), `expected ${id} in the top 6, got: ${JSON.stringify(r.candidates.map((c) => c.registeredName))}`);
    }
  }),
);

// Known current limitation (documented, not yet fixed): a single rare but
// genuinely distinctive brand word should still surface all real matches.
// This is the target the token-rarity/IDF weighting work is meant to fix.
const KEERTHI_FIXTURE: IndexRecord[] = [
  { regNumber: 'A', registeredName: 'KEERTHI NANDINI THE ASCENT', promoterName: 'KEERTHI NANDINI LLP', dataset: 'ongoing' },
  { regNumber: 'B', registeredName: 'SBR KEERTHIPRIME', promoterName: 'SBR HABIITAT LLP', dataset: 'ongoing' },
  { regNumber: 'C', registeredName: 'SBR KEERTHI', promoterName: 'SBR HABIITAT LLP', dataset: 'ongoing' },
  { regNumber: 'D', registeredName: 'Keerthi Royal Palms-Phase-I', promoterName: 'Keerthi Estates Pvt Ltd', dataset: 'completed' },
  { regNumber: 'E', registeredName: 'Keerthi Krishna Viva', promoterName: 'Keerthi Estates Pvt Ltd', dataset: 'completed' },
  { regNumber: 'F', registeredName: 'Keerthi Surya Sakthi Towers-Block A', promoterName: 'Keerthi Estates Pvt Ltd', dataset: 'completed' },
  { regNumber: 'G', registeredName: 'Keerthi Regalia', promoterName: 'Keerthi Estates Pvt Ltd', dataset: 'completed' },
  { regNumber: 'H', registeredName: 'Keerthi Splendour', promoterName: 'Keerthi Estates Pvt Ltd', dataset: 'completed' },
];

test(
  'target behavior: "Keerthi" alone should surface all 8 real Keerthi-branded projects, not just the short ones',
  withTempDb(async (dbPath) => {
    seed(dbPath, KEERTHI_FIXTURE);
    const r = await resolve('Keerthi', undefined, { dbPath, tokenWeightFn: realisticWeightFn });
    const foundIds = new Set(r.candidates.map((c) => c.regNumber));
    for (const id of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']) {
      assert.ok(foundIds.has(id), `expected ${id} to be surfaced, candidates were: ${JSON.stringify(r.candidates.map((c) => c.registeredName))}`);
    }
  }),
);

// "City" alone must NOT get a containment boost against a LONG, mostly
// unrelated registered name just because "city" appears somewhere in it —
// that's the failure mode the containment gate exists to prevent. (A SHORT
// name that's genuinely mostly "___ City" scoring reasonably via the
// ordinary symmetric formula is a separate, correct behavior, not something
// this test is about — see the two-word "Vintage City" case, which
// legitimately shares half its identity with the query.)
const GENERIC_WORD_FIXTURE: IndexRecord[] = [
  { regNumber: 'A', registeredName: 'Silver City Grand Enclave Extension Phase Two', promoterName: 'Silver Estates', dataset: 'ongoing' },
  { regNumber: 'B', registeredName: 'Green Meadows City Layout Block Nine', promoterName: 'Green Builders', dataset: 'ongoing' },
  { regNumber: 'C', registeredName: 'Keerthi Regalia', promoterName: 'Keerthi Estates Pvt Ltd', dataset: 'completed' },
];

test(
  'target behavior: "City" alone should not get a containment boost against long, mostly-unrelated names',
  withTempDb(async (dbPath) => {
    seed(dbPath, GENERIC_WORD_FIXTURE);
    const r = await resolve('City', undefined, { dbPath, tokenWeightFn: realisticWeightFn });
    const aboveFloor = r.candidates.filter((c) => c.matchScore >= MATCH_THRESHOLDS.floor);
    const foundIds = new Set(aboveFloor.map((c) => c.regNumber));
    assert.ok(!foundIds.has('A'), `long unrelated name should not clear the floor via "city" alone: ${JSON.stringify(r.candidates)}`);
    assert.ok(!foundIds.has('B'), `long unrelated name should not clear the floor via "city" alone: ${JSON.stringify(r.candidates)}`);
  }),
);
