import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTnProjectDetail, parseTnPromoter } from '../../adapters/tamilnadu/parseDetail.js';

// Detail fixtures mirror the real public-view2 (project) / public-view1
// (promoter) "Form A" pages: each field is <label>Field :</label> followed by a
// <p|div class="fw-semibold"> value. A field the promoter left blank renders as
// "-", which the parser treats as absent. Verified live 2026-08-13 against
// Brigade Stellaris (company) + Matrix Shelters (firm) + an individual promoter.
const PROJECT_DETAIL_FIXTURE = `
<label class="text-muted">Project Name :</label><p class="fw-semibold">Brigade Stellaris</p>
<label class="text-muted">Type of Building :</label><p class="fw-semibold">High Rise Building (HRB)</p>
<label class="text-muted">Usage :</label><p class="fw-semibold">Mixed Development</p>
<label class="text-muted">Site Extent (Sq.m) :</label><p class="fw-semibold">21005</p>
<label class="text-muted">Total No. of Dwelling Units including all Phases/Villas :</label><p class="fw-semibold">284</p>
<label class="text-muted">Stage of Construction :</label><p class="fw-semibold">Not Yet Started</p>
<label class="text-muted">Project Completion Date :</label><p class="fw-semibold">31/12/2030</p>
<label class="text-muted">Pincode :</label><p class="fw-semibold">600042</p>
<label class="text-muted">Planning Permission Approval / Renewal Letter No :</label><p class="fw-semibold">OL-PP/HRB/0001/2026</p>
<label class="text-muted">Bank Name :</label><div class="fw-semibold"><span>Kotak Mahindra Bank</span></div>
<label class="text-muted">Branch Name :</label><p class="fw-semibold">Bandra Kurla</p>
<label class="text-muted">Total Project Cost :</label><p class="fw-semibold">-</p>
`;

test('parseTnProjectDetail extracts the full Form-A field set (status, units, bank, usage, extent), treating blank "-" as absent', () => {
  const d = parseTnProjectDetail(PROJECT_DETAIL_FIXTURE);
  assert.equal(d.projectType, 'High Rise Building (HRB)');
  assert.equal(d.usage, 'Mixed Development');
  assert.equal(d.siteAreaSqm, '21005');
  assert.equal(d.numberOfPlotsOrUnits, '284'); // verbose label matched by prefix
  assert.equal(d.projectStatus, 'Not Yet Started'); // TN *does* publish a status
  assert.equal(d.projectEndDate, '31/12/2030');
  assert.equal(d.pinCode, '600042');
  assert.equal(d.approvedPlanNumber, 'OL-PP/HRB/0001/2026');
  assert.equal(d.bankName, 'Kotak Mahindra Bank'); // value in a <div><span>
  assert.equal(d.bankBranch, 'Bandra Kurla');
  // A field the promoter left blank ("-") is omitted, never faked.
  assert.equal(d.totalProjectCostInr, undefined);
  assert.equal(d.complaintsOnProject, undefined);
});

test('parseTnProjectDetail handles a Layout project (Type of Layout, No of Plots)', () => {
  const layout = `
    <label>Type of Layout :</label><p class="fw-semibold">Residential Layout</p>
    <label>No of Plots :</label><p class="fw-semibold">169</p>
    <label>Project Completion Date :</label><p class="fw-semibold">31/12/2028</p>
  `;
  const d = parseTnProjectDetail(layout);
  assert.equal(d.projectType, 'Residential Layout'); // falls back to Type of Layout
  assert.equal(d.numberOfPlotsOrUnits, '169'); // falls back to a plots label
  assert.equal(d.projectEndDate, '31/12/2028');
});

test('parseTnProjectDetail omits (never fakes) fields the page does not carry', () => {
  const sparse = `<label>Project Name :</label><p class="fw-semibold">Some Project</p>`;
  const d = parseTnProjectDetail(sparse);
  assert.equal(d.projectType, undefined);
  assert.equal(d.projectStatus, undefined);
  assert.equal(d.bankName, undefined);
  assert.equal(d.latitude, undefined);
  assert.equal(d.numberOfPlotsOrUnits, undefined);
});

const PROMOTER_COMPANY_FIXTURE = `
<label>Type of Promoter :</label><p class="fw-semibold">company</p>
<label>Firm Name :</label><p class="fw-semibold">M/s. Brigade Enterprises Limited</p>
<label>Email ID :</label><p class="fw-semibold">thirumananr@brigadegroup.com</p>
<label>Website Address :</label><p class="fw-semibold">-</p>
<label>Mobile No. 1 :</label><p class="fw-semibold">8220633933</p>
<label>PAN Card No :</label><p class="fw-semibold">XXXXXX459F</p>
<label>Company Registration No :</label><p class="fw-semibold">U85110KA1995PLC019126</p>
<label>Address :</label><p class="fw-semibold">Plot No: 5/142, OMR, Chennai</p>
<label>Pincode :</label><p class="fw-semibold">600096</p>
<label>Chairman / CEO Name :</label><p class="fw-semibold">JAI SHANKAR</p>
`;

test('parseTnPromoter (company) extracts contact + CEO, files a CIN as registrationNumber (not GSTIN), drops blank website', () => {
  const p = parseTnPromoter(PROMOTER_COMPANY_FIXTURE);
  assert.equal(p.typeOfFirm, 'company');
  assert.equal(p.registrationNumber, 'U85110KA1995PLC019126'); // 21-char CIN
  assert.equal(p.gstin, undefined);
  assert.equal(p.pan, 'XXXXXX459F'); // stored verbatim (portal masks it)
  assert.equal(p.email, 'thirumananr@brigadegroup.com');
  assert.equal(p.mobile, '8220633933');
  assert.equal(p.website, undefined); // "-" => absent
  assert.equal(p.ceoOrMd, 'JAI SHANKAR');
  assert.equal(p.pinCode, '600096');
});

const PROMOTER_FIRM_FIXTURE = `
<label>Type of Promoter :</label><p class="fw-semibold">Company</p>
<label>Firm Name :</label><p class="fw-semibold">MATRIX SHELTERS</p>
<label>PAN Card No :</label><p class="fw-semibold">XXXXXX317N</p>
<label>Company Registration No :</label><p class="fw-semibold">33ABTFM1317N1ZX</p>
<label>Director / Partner Name :</label><p class="fw-semibold">T GOPALAKRISHNAN</p>
<label>Director / Partner Name :</label><p class="fw-semibold">V VEERAMANI</p>
`;

test('parseTnPromoter (firm) recognises a GSTIN vs a CIN and collects every partner/director', () => {
  const p = parseTnPromoter(PROMOTER_FIRM_FIXTURE);
  assert.equal(p.gstin, '33ABTFM1317N1ZX'); // 15-char GSTIN, filed under the same label
  assert.equal(p.registrationNumber, undefined);
  assert.deepEqual(p.directorNames, ['T GOPALAKRISHNAN', 'V VEERAMANI']);
  assert.equal(p.numberOfDirectors, '2');
});

const PROMOTER_INDIVIDUAL_FIXTURE = `
<label>Type of Promoter :</label><p class="fw-semibold">Individual</p>
<label>Name :</label><p class="fw-semibold">M PANDIYARAJAN</p>
<label>Father's Name :</label><p class="fw-semibold">DURAIPANDI</p>
<label>Occupation :</label><p class="fw-semibold">BUSINESS</p>
<label>PAN Card No :</label><p class="fw-semibold">XXXXXX479P</p>
`;

test("parseTnPromoter (individual) picks up occupation and father's name, with no CIN/directors", () => {
  const p = parseTnPromoter(PROMOTER_INDIVIDUAL_FIXTURE);
  assert.equal(p.typeOfFirm, 'Individual');
  assert.equal(p.occupation, 'BUSINESS');
  assert.equal(p.fathersName, 'DURAIPANDI');
  assert.equal(p.registrationNumber, undefined);
  assert.equal(p.directorNames, undefined);
});

test('parseTnPromoter keeps the masked PAN verbatim and never invents an unlisted GSTIN', () => {
  const p = parseTnPromoter(PROMOTER_COMPANY_FIXTURE);
  assert.match(p.pan ?? '', /^X{6}\w+$/); // still masked as the portal published it
  assert.equal(p.gstin, undefined); // no GST on this page — not fabricated
});
