import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOngoing, parseCompleted, dedupeRecords } from '../../parse.js';

// Fixture mirrors the real viewAllProjects markup verified live during
// Phase 1.0 (including the line-break between the array name and `.push(`
// that the actual portal HTML has).
const ONGOING_FIXTURE = `
<script>
var applicationNameList = new Array();
var applicationNameList2 = new Array();
var applicationNameList3 = new Array();
var applicationNameList4 = new Array();
var localObj = { appNo : 'ACK/KA/RERA/1251/308/PR/130726/010413' };
applicationNameList
    .push('ACK/KA/RERA/1251/308/PR/130726/010413');
applicationNameList2
    .push('PRM/KA/RERA/1251/308/PR/170726/008819');
applicationNameList3
    .push('THE ROOTS BY ELEGANCE INFRA');
applicationNameList4
    .push('PIONIER DEVELOPMENTS PRIVATE LIMITED');
</script>
`;

// Regression test: a live sync against the real portal found ~940 ongoing
// rows with an EMPTY registration number (real data — applications submitted
// but never assigned a regNumber, not a parse error). These used to all
// collide under regNumber: "" in dedupeRecords, silently discarding ~940
// distinct real projects down to one. Confirmed fixed by excluding
// blank-regNumber rows during parsing rather than trying to dedupe them.
const ONGOING_FIXTURE_WITH_BLANK_REGNUMBER = `
<script>
applicationNameList2
    .push('');
applicationNameList3
    .push('Some Unregistered Layout');
applicationNameList4
    .push('Some Promoter');
applicationNameList2
    .push('PRM/KA/RERA/1251/308/PR/170726/008819');
applicationNameList3
    .push('THE ROOTS BY ELEGANCE INFRA');
applicationNameList4
    .push('PIONIER DEVELOPMENTS PRIVATE LIMITED');
</script>
`;

test('parseOngoing excludes rows with a blank registration number instead of merging them', () => {
  const records = parseOngoing(ONGOING_FIXTURE_WITH_BLANK_REGNUMBER);
  assert.equal(records.length, 1);
  assert.equal(records[0].regNumber, 'PRM/KA/RERA/1251/308/PR/170726/008819');
});

test('parseOngoing extracts regNumber/registeredName/promoterName from JS seed arrays', () => {
  const records = parseOngoing(ONGOING_FIXTURE);
  assert.equal(records.length, 1);
  assert.deepEqual(records[0], {
    regNumber: 'PRM/KA/RERA/1251/308/PR/170726/008819',
    registeredName: 'THE ROOTS BY ELEGANCE INFRA',
    promoterName: 'PIONIER DEVELOPMENTS PRIVATE LIMITED',
    dataset: 'ongoing',
  });
});

// Fixture mirrors the real viewAllCompletedProjects <tbody> row structure
// verified live during Phase 1.0, including the nested "VIEW PROJECT
// DETAILS" button markup in the 5th cell and the 5 extra columns after it.
const COMPLETED_FIXTURE = `
<table>
<thead><tr>
  <th>S.No</th><th>REGISTRATION NO</th><th>PROMOTER</th><th>PROJECT</th>
  <th>VIEW PROJECT DETAILS</th><th>TYPE</th><th>DISTRICT</th><th>TALUK</th>
  <th>PROPOSED COMPLETION DATE</th><th>Applied for Completion</th>
</tr></thead>
<tbody>
<tr>
  <td>1</td>
  <td>PRM/KA/RERA/1251/446/PR/281223/006513</td>
  <td>SLN INFRA</td>
  <td>SLN NIDHI PALMS</td>
  <td><b>
    <a id="11429" class="btn btn-md" onclick="return showFileApplicationPreview(this);" title="View Project Details">
      <i class="fa fa-files-o"></i>
    </a></b>
  </td>
  <td>Plotted Development</td>
  <td>Bengaluru Urban</td>
  <td>Bengaluru East</td>
  <td>31/12/2030</td>
  <td>22/11/2024</td>
</tr>
</tbody>
</table>
`;

test('parseCompleted extracts core fields, extended columns, and the internal row id', () => {
  const records = parseCompleted(COMPLETED_FIXTURE);
  assert.equal(records.length, 1);
  assert.deepEqual(records[0], {
    regNumber: 'PRM/KA/RERA/1251/446/PR/281223/006513',
    registeredName: 'SLN NIDHI PALMS',
    promoterName: 'SLN INFRA',
    dataset: 'completed',
    completedRowId: '11429',
    projectType: 'Plotted Development',
    district: 'Bengaluru Urban',
    taluk: 'Bengaluru East',
    proposedCompletionDate: '31/12/2030',
    appliedForCompletionDate: '22/11/2024',
  });
});

test('dedupeRecords prefers the completed record when a regNumber appears in both dumps', () => {
  const ongoing = parseOngoing(ONGOING_FIXTURE)[0];
  const completed = { ...parseCompleted(COMPLETED_FIXTURE)[0], regNumber: ongoing.regNumber };
  const deduped = dedupeRecords([ongoing, completed]);
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].dataset, 'completed');
  assert.equal(deduped[0].completedRowId, '11429');
});

test('dedupeRecords keeps distinct regNumbers separate', () => {
  const a = parseOngoing(ONGOING_FIXTURE)[0];
  const b = parseCompleted(COMPLETED_FIXTURE)[0];
  const deduped = dedupeRecords([a, b]);
  assert.equal(deduped.length, 2);
});
