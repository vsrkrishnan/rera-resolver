import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchBuildingListHtml, fetchOfflineBuildingHtml } from '../../adapters/tamilnadu/fetch.js';
import { parseTnList } from '../../adapters/tamilnadu/parseList.js';
import { parseTnOfflineList } from '../../adapters/tamilnadu/parseOfflineList.js';
import { tamilNaduAdapter } from '../../adapters/tamilnadu.js';

// Opt-in, network-hitting smoke test — deliberately NOT part of ordinary
// `npm test` (no CI box should depend on rera.tn.gov.in being up, and a
// portal outage must never fail the build). This is the live counterpart to
// realFixtures.test.ts: that file pins parser behavior to a point-in-time
// HTML capture, so it can drift from what the portal serves TODAY without
// any test noticing. This file is what actually notices — it hits the real
// portal, right now, and confirms fetchDetail's enrichment (Form-A project
// fields, promoter contact/registration fields, offline table-borne GPS/
// status/date) is still coming back non-empty on a project chosen live, not
// a project baked into a fixture.
//
// Run it explicitly:
//   RERA_LIVE_TESTS=1 node --import tsx --test src/__tests__/tamilnadu/liveSmoke.test.ts
//
// Assertions are deliberately loose (field presence / plausible shape, not
// exact values) — real portal data changes over time; a live test asserting
// exact values would be a flaky test wearing a smoke-test costume.
const LIVE = process.env.RERA_LIVE_TESTS === '1';
const skip = LIVE ? false : 'set RERA_LIVE_TESTS=1 to run against the real rera.tn.gov.in';

test(
  'live: fetching + parsing the real online building list yields records with detail refs',
  { skip },
  async () => {
    const raw = await fetchBuildingListHtml();
    assert.ok(raw, 'expected the live building list to be reachable');
    const records = parseTnList(raw!);
    assert.ok(records.length > 100, `expected a substantial real list, got ${records.length}`);
    const withRefs = records.find((r) => r.detailRefs?.project && r.detailRefs?.promoter);
    assert.ok(withRefs, 'expected at least one record with both detail-page refs');
  },
);

test(
  'live: fetchDetail on a real online project returns enriched Form-A fields and a promoter profile',
  { skip },
  async () => {
    const raw = await fetchBuildingListHtml();
    assert.ok(raw);
    const records = parseTnList(raw!);
    const record = records.find((r) => r.detailRefs?.project && r.detailRefs?.promoter);
    assert.ok(record, 'expected a record with detail refs to pick for the live lookup');

    const fetched = await tamilNaduAdapter.fetchDetail(record!);
    assert.ok(fetched, 'expected live detail to be obtainable for a project the list just returned');

    // Enrichment fields, not just the bare minimum the pre-enrichment parser
    // used to return — this is precisely the gap the user's manual testing
    // caught (2026-08-13/15). At least a majority of these should be present
    // on a real, recently-registered project; not every field is guaranteed
    // (an individual project may leave one blank), so this checks the field
    // SET is being extracted at all, not that any one field is populated.
    const { detail, promoter } = fetched!;
    const populatedDetailFields = [
      detail.projectType,
      detail.usage,
      detail.siteAreaSqm,
      detail.numberOfPlotsOrUnits,
      detail.projectStatus,
      detail.projectEndDate,
      detail.pinCode,
      detail.approvedPlanNumber,
      detail.bankName,
    ].filter((v) => v !== undefined);
    assert.ok(
      populatedDetailFields.length >= 5,
      `expected most Form-A fields populated on a real project, got ${populatedDetailFields.length}/9: ${JSON.stringify(detail)}`,
    );

    assert.ok(promoter, 'expected a promoter profile for an online project with a promoter detailRef');
    const populatedPromoterFields = [promoter!.typeOfFirm, promoter!.pan, promoter!.address].filter(
      (v) => v !== undefined,
    );
    assert.ok(
      populatedPromoterFields.length >= 1,
      `expected at least one promoter field populated, got: ${JSON.stringify(promoter)}`,
    );
  },
);

test(
  'live: an offline project assembles table-borne detail (no OCR, no detail-page network) from the real list row',
  { skip },
  async () => {
    const raw = await fetchOfflineBuildingHtml();
    assert.ok(raw, 'expected the live offline building archive to be reachable');
    const records = parseTnOfflineList(raw!);
    assert.ok(records.length > 100, `expected a substantial real offline archive, got ${records.length}`);

    // Look for a row that actually carries table-borne detail (GPS/status/
    // endDate) — ~40% of offline rows have GPS, but every row should carry
    // at least ONE of these fields since the archive always states a
    // completion date, so this should be easy to find.
    const withDetail = records.find(
      (r) => r.detailRefs?.lat || r.detailRefs?.status || r.detailRefs?.endDate,
    );
    assert.ok(withDetail, 'expected at least one real offline row to carry table-borne detail');

    const fetched = await tamilNaduAdapter.fetchDetail(withDetail!);
    assert.ok(fetched, 'expected offline fetchDetail to assemble a result with no network call');
    const { detail } = fetched!;
    const populated = [detail.latitude, detail.longitude, detail.projectStatus, detail.projectEndDate].filter(
      (v) => v !== undefined,
    );
    assert.ok(populated.length > 0, `expected offline detail to carry at least one field, got: ${JSON.stringify(detail)}`);
  },
);
