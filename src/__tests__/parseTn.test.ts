import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTnList } from '../adapters/tamilnadu/parseList.js';
import { parseTnProjectDetail, parseTnPromoter } from '../adapters/tamilnadu/parseDetail.js';

// Fixtures mirror the real rera.tn.gov.in markup verified live 2026-08-09:
// the online registered-building/tn and registered-layout/tn tables (9 cells,
// regNumber in <strong>, "Project Name:" prefix, and the two public-view
// detail links — note the Project Details anchor's `href ='...'` with a space
// before the `=`, a real portal quirk the parser must tolerate). Building and
// Layout share one <tbody> here to prove the parser reads multiple bodies.
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
  assert.equal(layout.detailRefs?.project, 'https://rera.tn.gov.in/public-view2/layout/pfirm/project-uuid-2');
});

test('parseTnList skips rows with no registration number rather than emitting a blank-keyed record', () => {
  const noReg = `<table><tbody><tr><td>1</td><td>no strong here</td><td>Promoter</td><td>Project Name: X</td><td></td><td></td><td></td></tr></tbody></table>`;
  assert.equal(parseTnList(noReg).length, 0);
});

// Detail fixtures mirror the public-view2 (project) and public-view1 (promoter)
// pages: label/value pairs where the colon is inside the label and the value is
// either inline ("District : Chennai") or in the next node ("Project Name :").
const PROJECT_DETAIL_FIXTURE = `
<b>Project Name :</b> <span>Thiruvottiyur Scheme</span>
<b>Type of Building :</b> <span>Non-High Rise Building (NHRB)</span>
<b>Project Completion Date :</b> <span>21/12/2030</span>
<b>Address :</b> <span>T.S. No 83/1, Thiruvottiyur</span>
<b>District : Chennai</b>
<b>Pincode : 600019</b>
<b>Planning Permission Approval / Renewal Letter No :</b> <span>PC/NHRB/N/6076/2024</span>
<b>Planning Permission Approval / Renewal Date :</b> <span>12/12/2025</span>
<b>Latitude :</b> <span>13.163286</span>
<b>Longitude :</b> <span>80.301217</span>
`;

test('parseTnProjectDetail extracts the fields TN exposes and omits (never fakes) the ones it does not (cost, bank, status)', () => {
  const d = parseTnProjectDetail(PROJECT_DETAIL_FIXTURE);
  assert.equal(d.projectType, 'Non-High Rise Building (NHRB)');
  assert.equal(d.projectEndDate, '21/12/2030');
  assert.equal(d.pinCode, '600019'); // inline "Pincode : 600019"
  assert.equal(d.latitude, '13.163286');
  assert.equal(d.longitude, '80.301217');
  assert.equal(d.approvedPlanNumber, 'PC/NHRB/N/6076/2024');
  assert.equal(d.planApprovalDate, '12/12/2025');
  // TN detail pages publish none of these — must be undefined, not faked.
  assert.equal(d.totalProjectCostInr, undefined);
  assert.equal(d.bankName, undefined);
  assert.equal(d.projectStatus, undefined);
  assert.equal(d.complaintsOnProject, undefined);
});

const PROMOTER_DETAIL_FIXTURE = `
<b>Type of Promoter :</b> <span>firm</span>
<b>Firm Name :</b> <span>TNUHDB</span>
<b>PAN Card No :</b> <span>XXXXXX230D</span>
<b>Company Registration No :</b> <span>ADWPG4230D</span>
<b>Address :</b> <span>Street: TNUHDB Division 1, Chennai</span>
<b>Pincode : 600019</b>
`;

test('parseTnPromoter extracts type/registration/PAN(masked)/address, omitting GSTIN and directors TN does not expose', () => {
  const p = parseTnPromoter(PROMOTER_DETAIL_FIXTURE);
  assert.equal(p.typeOfFirm, 'firm');
  assert.equal(p.registrationNumber, 'ADWPG4230D');
  assert.equal(p.pan, 'XXXXXX230D'); // stored verbatim (portal masks it), not "cleaned"
  assert.equal(p.pinCode, '600019');
  assert.equal(p.gstin, undefined);
  assert.equal(p.din, undefined);
  assert.equal(p.numberOfDirectors, undefined);
});
