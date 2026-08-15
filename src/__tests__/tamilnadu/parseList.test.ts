import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTnList } from '../../adapters/tamilnadu/parseList.js';

// Fixtures mirror the real rera.tn.gov.in markup verified live 2026-08-09: the
// online registered-building/tn and registered-layout/tn tables (9 cells,
// regNumber in <strong>, "Project Name:" prefix, and the two public-view detail
// links — note the Project Details anchor's `href ='...'` with a space before
// the `=`, a real portal quirk the parser must tolerate). Building and Layout
// share the payload here to prove the parser reads multiple <tbody> tables.
const LIST_FIXTURE = `
<table id="example1"><tbody>
<tr>
  <td>1</td>
  <td><strong>TNRERA/29/BLG/0001/2026</strong><div class="text-muted small">dated 02-01-2026</div></td>
  <td>TNUHDB, TNUHDB Division 1, Thiruvottiyur, Chennai, Tamil Nadu-600019.</td>
  <td>Project Name: Thiruvottiyur Scheme<br>Registration of additional 4 Blocks with dwelling units...</td>
  <td>CMDA issued Planning permission No. C/27/2025</td>
  <td>21.12.2030</td>
  <td>
    <a href='https://rera.tn.gov.in/public-view1/building/pfirm/promoter-uuid-1' target='_blank'>Promoter Details</a><br>
    <a href ='https://rera.tn.gov.in/public-view2/building/pfirm/project-uuid-1' target='_blank'>Project Details</a><br>
    <span>Location of Site: Latitude-13.16;<br>Longitude-80.30;</span>
  </td>
  <td>Form-c</td><td></td>
</tr>
</tbody></table>
<table id="example1"><tbody>
<tr>
  <td>1</td>
  <td><strong>TNRERA/11/LO/0001/2026</strong><div class="text-muted small">dated 05-01-2026</div></td>
  <td>M/s.MATRIX SHELTERS, Door No.12/6, Chennai.</td>
  <td>Project Name: HILL VIEW HAVEN PHASE-2<br>Approved layout...</td>
  <td>DTCP approval</td>
  <td>31.12.2028</td>
  <td>
    <a href='https://rera.tn.gov.in/public-view1/layout/pfirm/promoter-uuid-2'>Promoter Details</a>
    <a href ='https://rera.tn.gov.in/public-view2/layout/pfirm/project-uuid-2'>Project Details</a>
  </td>
  <td></td><td></td>
</tr>
</tbody></table>
`;

test('parseTnList reads both Building and Layout tables, extracting regNumber, clean project name, and both detail-page refs', () => {
  const records = parseTnList(LIST_FIXTURE);
  assert.equal(records.length, 2);

  const building = records[0];
  assert.equal(building.regNumber, 'TNRERA/29/BLG/0001/2026');
  assert.equal(building.registeredName, 'Thiruvottiyur Scheme'); // only the name, not the block description
  assert.equal(building.dataset, 'registered');
  assert.equal(building.detailRefs?.project, 'https://rera.tn.gov.in/public-view2/building/pfirm/project-uuid-1');
  assert.equal(building.detailRefs?.promoter, 'https://rera.tn.gov.in/public-view1/building/pfirm/promoter-uuid-1');

  const layout = records[1];
  assert.equal(layout.regNumber, 'TNRERA/11/LO/0001/2026');
  assert.equal(layout.registeredName, 'HILL VIEW HAVEN PHASE-2');
  // The Project Details anchor uses `href ='...'` (space before `=`) — tolerated.
  assert.equal(layout.detailRefs?.project, 'https://rera.tn.gov.in/public-view2/layout/pfirm/project-uuid-2');
});

test('parseTnList keeps the promoter name+address verbatim from cell 2', () => {
  const [building] = parseTnList(LIST_FIXTURE);
  assert.equal(building.promoterName, 'TNUHDB, TNUHDB Division 1, Thiruvottiyur, Chennai, Tamil Nadu-600019.');
});

test('parseTnList takes only the "Project Name:" value, dropping the block description after the <br>', () => {
  const [building] = parseTnList(LIST_FIXTURE);
  assert.ok(!building.registeredName.includes('Registration of additional'));
});

test('parseTnList skips rows with no registration number rather than emitting a blank-keyed record', () => {
  const noReg = `<table><tbody><tr><td>1</td><td>no strong here</td><td>Promoter</td><td>Project Name: X</td><td></td><td></td><td></td></tr></tbody></table>`;
  assert.equal(parseTnList(noReg).length, 0);
});

test('parseTnList still emits a record when a row has no detail links (detailRefs simply omitted)', () => {
  const noLinks = `<table><tbody><tr>
    <td>1</td><td><strong>TNRERA/29/BLG/0500/2026</strong></td>
    <td>Some Promoter</td><td>Project Name: Orphan Project</td>
    <td>appr</td><td>2030</td><td>no links here</td><td></td><td></td>
  </tr></tbody></table>`;
  const [r] = parseTnList(noLinks);
  assert.equal(r.regNumber, 'TNRERA/29/BLG/0500/2026');
  assert.equal(r.registeredName, 'Orphan Project');
  assert.equal(r.detailRefs, undefined);
});
