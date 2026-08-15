import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseTnList } from '../../adapters/tamilnadu/parseList.js';
import { parseTnOfflineList } from '../../adapters/tamilnadu/parseOfflineList.js';
import { parseTnProjectDetail, parseTnPromoter } from '../../adapters/tamilnadu/parseDetail.js';

// Every hand-written fixture elsewhere in this suite (parseList/parseDetail/
// parseOffline.test.ts) is synthetic — built to isolate one parsing rule at a
// time. That's the right tool for unit coverage, but it leaves a real gap: no
// test ever runs the parsers against markup TN actually served. A portal
// redesign that keeps our synthetic shapes "valid" but changes the real one
// would sail through every other test in this suite.
//
// These four fixtures close that gap. Each is REAL HTML captured live from
// rera.tn.gov.in on 2026-08-15 (see the header comment in each fixture file
// for the exact source URL) — with only inert chrome (head/script/style/svg,
// nav, footer, and — for the two detail pages — mid-page sections the parser
// never reads, e.g. Floor-Area/Parking/Amenity tables) trimmed out to keep
// the files reviewable. Every trim was verified byte-for-byte parser-output-
// identical against the untrimmed capture before being committed (not
// re-checked here — the fixture header records that it was done). Never
// hand-edit a fixture file; re-capture and re-verify instead.
//
// This is deliberately NOT a live-network test — see liveSmoke.test.ts for
// that. This suite runs in ordinary `npm test`, no network, and its job is
// narrower: "the parsers still handle a real page's real shape," pinned to a
// point-in-time capture rather than to whatever the portal returns right now.

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixture = (name: string) => readFileSync(join(FIXTURES_DIR, name), 'utf8');

test('parseTnList on a real registered-building/tn page: extracts real regNumbers, names, and both detail-page refs', () => {
  const records = parseTnList(fixture('online-list.html'));
  assert.equal(records.length, 6);

  // TNUHDB's own Thiruvottiyur Scheme — a government (not private-developer)
  // promoter, and the first real row on the live page.
  const thiruvottiyur = records.find((r) => r.regNumber === 'TNRERA/29/BLG/0001/2026');
  assert.ok(thiruvottiyur);
  assert.equal(thiruvottiyur.registeredName, 'Thiruvottiyur Scheme');
  assert.match(thiruvottiyur.promoterName, /^TNUHDB/);
  assert.equal(
    thiruvottiyur.detailRefs?.project,
    'https://rera.tn.gov.in/public-view2/building/pfirm/0af6b560-e2db-11f0-a6cd-a96dc02c0a0b',
  );
  assert.equal(
    thiruvottiyur.detailRefs?.promoter,
    'https://rera.tn.gov.in/public-view1/building/pfirm/bae43e00-e2d3-11f0-9cab-a7ac0dd72276',
  );

  // A recognizable branded developer among the real rows, to prove the parser
  // isn't just handling the one government-promoter shape.
  const casagrand = records.find((r) => r.regNumber === 'TNRERA/35/BLG/0005/2026');
  assert.ok(casagrand);
  assert.equal(casagrand.registeredName, 'CASAGRAND GLENMERE');
});

test('parseTnOfflineList on a real building/offline/2023 page: extracts real regNumbers, GPS, completion date, status', () => {
  const records = parseTnOfflineList(fixture('offline-list-2023.html'));
  assert.equal(records.length, 8);

  // Purva Windermere Phase-4A — the same landmark project the eval set
  // (src/eval/eval-set.ts) resolves by name against the live index; this
  // fixture proves the row that resolution ultimately rests on parses
  // correctly on its own.
  const purva = records.find((r) => r.regNumber === 'TN/29/Building/0008/2023');
  assert.ok(purva);
  assert.equal(purva.registeredName, 'Purva Windermere Phase-4A');
  assert.match(purva.promoterName, /Puravankara Limited/);
  assert.equal(purva.detailRefs?.endDate, '31.12.2027');
  assert.equal(purva.detailRefs?.status, 'Progress of Work as on March 2024');
  assert.equal(
    purva.detailRefs?.approval,
    'https://rera.tn.gov.in/cms/Other_Details/Building/Approval_Details/2023/8-2023.pdf',
  );

  // A row with real hand-typed DMS GPS, independent of the Purva row (which
  // this particular 2023 capture happens not to carry coordinates for).
  const janaPalace = records.find((r) => r.regNumber === 'TN/29/Building/006/2023');
  assert.ok(janaPalace);
  assert.equal(janaPalace.detailRefs?.lat, '13.155278');
  assert.equal(janaPalace.detailRefs?.long, '80.405250');
});

test('parseTnProjectDetail on a real Form-A project page: extracts the real field set (status, units, extent, bank, GPS)', () => {
  const detail = parseTnProjectDetail(fixture('online-project-detail.html'));
  assert.equal(detail.projectType, 'Non-High Rise Building (NHRB)');
  assert.equal(detail.usage, 'Residential');
  assert.equal(detail.siteAreaSqm, '10480');
  assert.equal(detail.numberOfPlotsOrUnits, '366');
  assert.equal(detail.projectStatus, 'Under Construction');
  assert.equal(detail.projectEndDate, '21/12/2030');
  assert.equal(detail.pinCode, '600019');
  assert.equal(detail.latitude, '13.163286');
  assert.equal(detail.longitude, '80.301217');
  assert.equal(detail.approvedPlanNumber, 'PC/NHRB/N/6076/2024');
  assert.equal(detail.bankName, 'Indian Overseas Bank');
  assert.equal(detail.bankBranch, 'Chennai - Thiruvanmiyur');
});

test('parseTnPromoter on a real promoter page: extracts contact fields and a real (non-CIN, non-GSTIN) registration number verbatim', () => {
  const promoter = parseTnPromoter(fixture('online-promoter-detail.html'));
  assert.equal(promoter.typeOfFirm, 'firm');
  assert.equal(promoter.email, 'tnuhdbdivision1@gmail.com');
  assert.equal(promoter.mobile, '9629284414');
  assert.equal(promoter.pinCode, '600019');
  // TNUHDB (a government housing board, not a private company) files a
  // 10-char value here that matches neither the 21-char CIN nor the 15-char
  // GSTIN shape the parser checks for — a real portal quirk the fixture
  // pins down. It still lands in registrationNumber (the CIN-or-fallback
  // slot), never fabricated into a gstin it isn't.
  assert.equal(promoter.registrationNumber, 'ADWPG4230D');
  assert.equal(promoter.gstin, undefined);
});
