import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseInvestigationList } from '../../parse.js';
import { writeSnapshot } from '../../storage.js';
import { checkUnderInvestigation } from '../../checkUnderInvestigation.js';
import type { InvestigationRecord } from '../../types.js';

// Fixture reproduces the real unregProjectList markup verified live
// 2026-07-18: <thead> is well-formed, but <tbody> rows are opened with <tr>
// and never closed with a matching </tr> — a real portal defect, not a
// typo in this fixture. A </tr>-anchored parser (like parseCompleted's)
// would silently return zero rows against this; splitting on <tr> openings
// is what actually works here.
const INVESTIGATION_FIXTURE = `
<table id="unregprojList">
<thead>
  <tr><th>S.NO</th><th>PROJECT NAME</th><th>PROMOTER NAME</th><th>STATUS</th><th>CORPORATE ADDRESS</th><th>PUBLISHED DATE</th></tr>
</thead>
<tbody>
  <tr>
    <td>1</td>
    <td>Sobha City - Casa serenita</td>
    <td>RADHAKRISHNAN MEENAKSHISUNDARAM</td>
    <td>No Reply from Promoter</td>
    <td>SOBHA, Sarjapur-Marathahalli Outer Ring Road (ORR) Devarabisanahalli, Bellandur Post, Bangalore Bangalore KA 560103 IN</td>
    <td><p>22-10-2021</p></td>

  <tr>
    <td>2</td>
    <td>Marvel Orial</td>
    <td>Marvel Omega Builder</td>
    <td>Not Satisfactory</td>
    <td>plot no. 7 PID 76-7-7 primrose road Bangalore</td>
    <td>04-10-2021</td>

  <tr>
    <td>3</td>
    <td>Atz Areva</td>
    <td>A.T.Z. Properties</td>
    <td>Approved</td>
    <td># 12/1, 1st Floor, Infantry Road Cross, Bengaluru-560001.</td>
    <td>14-11-2018</td>

</tbody>
</table>
`;

test('parseInvestigationList extracts rows despite unclosed <tr> tags', () => {
  const records = parseInvestigationList(INVESTIGATION_FIXTURE);
  assert.equal(records.length, 3);
  assert.deepEqual(records[0], {
    projectName: 'Sobha City - Casa serenita',
    promoterName: 'RADHAKRISHNAN MEENAKSHISUNDARAM',
    status: 'no_reply',
    rawStatus: 'No Reply from Promoter',
    corporateAddress: 'SOBHA, Sarjapur-Marathahalli Outer Ring Road (ORR) Devarabisanahalli, Bellandur Post, Bangalore Bangalore KA 560103 IN',
    publishedDate: '22-10-2021',
  });
});

test('parseInvestigationList normalizes known status strings and preserves the raw text', () => {
  const records = parseInvestigationList(INVESTIGATION_FIXTURE);
  assert.equal(records[1].status, 'not_satisfactory');
  assert.equal(records[2].status, 'approved');
  assert.equal(records[2].rawStatus, 'Approved');
});

test('parseInvestigationList falls back to "unknown" for an unrecognized status rather than guessing', () => {
  const html = INVESTIGATION_FIXTURE.replace('No Reply from Promoter', 'Some New Status RERA Invents Later');
  const records = parseInvestigationList(html);
  assert.equal(records[0].status, 'unknown');
  assert.equal(records[0].rawStatus, 'Some New Status RERA Invents Later');
});

function withTempDb(fn: (dbPath: string) => void | Promise<void>) {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rera-resolver-investigation-test-'));
    const dbPath = join(dir, 'index.db');
    try {
      await fn(dbPath);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

const INVESTIGATION_RECORDS: InvestigationRecord[] = [
  {
    projectName: 'Sobha City - Casa serenita',
    promoterName: 'RADHAKRISHNAN MEENAKSHISUNDARAM',
    status: 'no_reply',
    rawStatus: 'No Reply from Promoter',
    corporateAddress: 'Bangalore',
    publishedDate: '22-10-2021',
  },
  {
    projectName: 'Marvel Orial',
    promoterName: 'Marvel Omega Builder',
    status: 'not_satisfactory',
    rawStatus: 'Not Satisfactory',
    corporateAddress: 'Bangalore',
    publishedDate: '04-10-2021',
  },
];

test(
  'checkUnderInvestigation returns ranked matches with the dataAsOf staleness signal and a warning',
  withTempDb(async (dbPath) => {
    writeSnapshot(
      { fetchedAt: new Date().toISOString(), ongoingCount: 0, completedCount: 0, records: [] },
      { fetchedAt: new Date().toISOString(), records: INVESTIGATION_RECORDS },
      dbPath,
    );
    const result = await checkUnderInvestigation('Sobha City Casa Serenita', undefined, { dbPath });
    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0].projectName, 'Sobha City - Casa serenita');
    assert.equal(result.dataAsOf, '2021-10-22'); // latest across the WHOLE dataset, not just this match
    assert.ok(result.warning.length > 0);
    assert.ok(result.warning.includes('2021'));
  }),
);

test(
  'checkUnderInvestigation returns empty matches (not an error) when nothing is close',
  withTempDb(async (dbPath) => {
    writeSnapshot(
      { fetchedAt: new Date().toISOString(), ongoingCount: 0, completedCount: 0, records: [] },
      { fetchedAt: new Date().toISOString(), records: INVESTIGATION_RECORDS },
      dbPath,
    );
    const result = await checkUnderInvestigation('Totally Unrelated Project Name', undefined, { dbPath });
    assert.deepEqual(result.matches, []);
  }),
);

test(
  'checkUnderInvestigation against an empty/missing snapshot still returns a well-formed result with a warning',
  withTempDb(async (dbPath) => {
    const result = await checkUnderInvestigation('Anything', undefined, { dbPath });
    assert.deepEqual(result.matches, []);
    assert.equal(result.dataAsOf, null);
    assert.ok(result.warning.length > 0);
  }),
);
