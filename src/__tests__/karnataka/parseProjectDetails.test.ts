import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseProjectDetails, parsePromoterProfile } from '../../parseProjectDetails.js';

// Fixture reproduces the label/colon/value text-node sequence confirmed live
// against 3 real projectDetails responses during Phase 1.0 (exact tag names
// vary/are irrelevant — the parser only reads the flattened text-node
// sequence, which is what's verified).
const FIXTURE = `
<html><body>
<div class="tab-pane" id="menu2">
  <label>Project Type</label><span>:</span><span>Plotted Development</span>
  <label>Project Status</label><span>:</span><span>New Project Launch</span>
  <label>Project Start Date</label><span>:</span><span>01-05-2024</span>
  <label>Project End Date</label><span>:</span><span>31-12-2030</span>
</div>
<div class="tab-pane" id="menu-complaints">
  <h1>Complaints On this Promoter (0)</h1>
  <h1>Complaints On this Project (2)</h1>
</div>
</body></html>
`;

const EMPTY_PARSED = {
  projectStatus: undefined,
  projectStartDate: undefined,
  projectEndDate: undefined,
  complaintsOnPromoter: undefined,
  complaintsOnProject: undefined,
  projectType: undefined,
  projectDescription: undefined,
  extentDevelopedPct: undefined,
  projectAddress: undefined,
  pinCode: undefined,
  latitude: undefined,
  longitude: undefined,
  approvingAuthority: undefined,
  approvedPlanNumber: undefined,
  planApprovalDate: undefined,
  totalProjectCostInr: undefined,
  totalConstructionCostInr: undefined,
  bankName: undefined,
  bankBranch: undefined,
  ifscCode: undefined,
  numberOfPlotsOrUnits: undefined,
};

test('parseProjectDetails extracts status, dates, and complaint counts', () => {
  const parsed = parseProjectDetails(FIXTURE);
  assert.deepEqual(parsed, {
    ...EMPTY_PARSED,
    projectType: 'Plotted Development',
    projectStatus: 'New Project Launch',
    projectStartDate: '01-05-2024',
    projectEndDate: '31-12-2030',
    complaintsOnPromoter: 0,
    complaintsOnProject: 2,
  });
});

test('parseProjectDetails omits fields it cannot find rather than faking them', () => {
  const parsed = parseProjectDetails('<html><body>nothing relevant here</body></html>');
  assert.deepEqual(parsed, EMPTY_PARSED);
});

// Reproduces the NEWER template (confirmed live on an ongoing project,
// 2026-07-19 investigation): richer promoter/geo/cost/bank fields, and the
// specific hazard that motivated requiring a literal ':' after a label
// match — a table's "Start Date" / "Proposed Completion Date" column
// headers repeat real field label text with no colon following, which (pre-
// fix) got matched as if it were the real value.
const NEW_TEMPLATE_FIXTURE = `
<html><body>
<span>Project Name :</span><span>THE ROOTS BY ELEGANCE INFRA</span>
<span>Registration Number :</span><span>PRM/KA/RERA/TEST/000001</span>

<span>Promoter</span><span>Details</span>
<span>Type of Firm</span><span>:</span><span>Company</span>
<span>Promoter Name</span><span>:</span><span>TEST DEVELOPERS PRIVATE LIMITED</span>
<span>Main Objectives</span><span>:</span><span>DEVELOPMENT OF RESIDENTIAL LAYOUT</span>
<span>Registration Number</span><span>:</span><span>U70100KA2022PTC999999</span>
<span>PAN</span><span>:</span><span>AANCP0678D</span>
<span>GSTIN</span><span>:</span><span>AANCP0678D</span>
<span>Promoter Address</span><span>:</span><span>#1, MAIN ROAD, KORAMANGALA</span><span>,Bengaluru South</span><span>,Bengaluru Urban-560034</span>
<span>District</span><span>:</span><span>Bengaluru Urban</span>
<span>Taluk</span><span>:</span><span>Bengaluru South</span>
<span>PIN Code</span><span>:</span><span>560034</span>
<span>Name of Authorized Signatory</span><span>:</span><span>JANE DOE</span>
<span>Name of CEO/MD</span><span>:</span><span>JANE DOE</span>
<span>Designation</span><span>:</span><span>DIRECTOR</span>
<span>Director Identification (DIN) Number</span><span>:</span><span>07687753</span>
<span>Number of Directors</span><span>:</span><span>2</span>

<span>Project</span><span>Details</span>
<table>
  <tr><td>Registration/Extensions</td><td>Start Date</td><td>Proposed Completion Date</td><td>Certificate/Order</td></tr>
  <tr><td>At the time of Registration</td><td>01-06-2026</td><td>31-07-2027</td></tr>
</table>
<span>Project Name</span><span>:</span><span>THE ROOTS BY ELEGANCE INFRA</span>
<span>Project Description</span><span>:</span><span>DEVELOPMENT OF RESIDENTIAL PROJECT</span>
<span>Project Type</span><span>:</span><span>Plotted Development</span>
<span>Project Status</span><span>:</span><span>Ongoing</span>
<span>Extent of development carried till date</span><span>:</span><span>0 %</span>
<span>Project Start Date</span><span>:</span><span>01-06-2026</span>
<span>Proposed Completion Date</span><span>:</span><span>31-07-2027</span>
<span>Project Address</span>
<span>Project Address</span><span>:</span><span>SURVEY NO. 98, SARJAPURA HOBLI,</span><span>, Anekal, Bengaluru Urban - 560099</span>
<span>Pin Code</span><span>:</span><span>560099</span>
<span>Latitude</span><span>:</span><span>12.856716251534834</span>
<span>Longitude</span><span>:</span><span>77.6925632785782</span>
<span>Approving Authority</span><span>:</span><span>BDA - Bangalore Development Authority</span>
<span>Approved Plan Number</span><span>:</span><span>BDA/TPM/PRL-337/25-26/604</span>
<span>Plan Approval Date</span><span>:</span><span>20-05-2026</span>
<span>Total Project Cost (INR) (C1+C2)</span><span>:</span><span>368684262</span>
<span>Total Construction Cost</span><span>:</span><span>76811847</span>
<span>Bank Name</span><span>:</span><span>STATE BANK OF INDIA</span>
<span>Branch</span><span>:</span><span>sector 1, HSR LAYOUT</span>
<span>IFSC Code</span><span>:</span><span>SBIN0070802</span>
<span>Number of Plots</span><span>:</span><span>46</span>

<div class="complaints">
  <h1>Complaints On this Promoter (5)</h1>
  <h1>Complaints On this Project (0)</h1>
</div>
</body></html>
`;

test('parseProjectDetails (new template): finds the real "Proposed Completion Date" value, not the bare table header with no colon', () => {
  const parsed = parseProjectDetails(NEW_TEMPLATE_FIXTURE);
  assert.equal(parsed.projectEndDate, '31-07-2027');
});

test('parseProjectDetails (new template): extracts every Core project field', () => {
  const parsed = parseProjectDetails(NEW_TEMPLATE_FIXTURE);
  assert.equal(parsed.projectType, 'Plotted Development');
  assert.equal(parsed.projectDescription, 'DEVELOPMENT OF RESIDENTIAL PROJECT');
  assert.equal(parsed.extentDevelopedPct, '0 %');
  assert.equal(parsed.pinCode, '560099');
  assert.equal(parsed.latitude, '12.856716251534834');
  assert.equal(parsed.longitude, '77.6925632785782');
  assert.equal(parsed.approvingAuthority, 'BDA - Bangalore Development Authority');
  assert.equal(parsed.approvedPlanNumber, 'BDA/TPM/PRL-337/25-26/604');
  assert.equal(parsed.planApprovalDate, '20-05-2026');
  assert.equal(parsed.totalProjectCostInr, '368684262');
  assert.equal(parsed.totalConstructionCostInr, '76811847');
  assert.equal(parsed.bankName, 'STATE BANK OF INDIA');
  assert.equal(parsed.bankBranch, 'sector 1, HSR LAYOUT');
  assert.equal(parsed.ifscCode, 'SBIN0070802');
  assert.equal(parsed.numberOfPlotsOrUnits, '46');
});

test('parseProjectDetails (new template): joins a multi-line address instead of truncating at the first line', () => {
  const parsed = parseProjectDetails(NEW_TEMPLATE_FIXTURE);
  assert.equal(parsed.projectAddress, 'SURVEY NO. 98, SARJAPURA HOBLI, , Anekal, Bengaluru Urban - 560099');
});

test('parsePromoterProfile (new template): extracts the full promoter profile including fields after the Authorized Signatory marker', () => {
  const profile = parsePromoterProfile(NEW_TEMPLATE_FIXTURE);
  assert.deepEqual(profile, {
    typeOfFirm: 'Company',
    registrationNumber: 'U70100KA2022PTC999999',
    pan: 'AANCP0678D',
    gstin: 'AANCP0678D',
    mainObjectives: 'DEVELOPMENT OF RESIDENTIAL LAYOUT',
    address: '#1, MAIN ROAD, KORAMANGALA ,Bengaluru South ,Bengaluru Urban-560034',
    district: 'Bengaluru Urban',
    taluk: 'Bengaluru South',
    pinCode: '560034',
    authorizedSignatory: 'JANE DOE',
    ceoOrMd: 'JANE DOE',
    designation: 'DIRECTOR',
    din: '07687753',
    numberOfDirectors: '2',
  });
});

// Reproduces the OLDER "legacy" template (confirmed live on a completed
// project registered in 2017): different labels for several fields
// (Promoter Type/PAN Number/Company Registration No./Address instead of
// Type of Firm/PAN/Registration Number/Promoter Address), no GSTIN, and cost
// fields positioned BEFORE 'Project Address' instead of after. Also
// reproduces the collision hazard that motivated scoping project-level
// fields to start at 'Project Address': a director's own 'Pin Code' (a
// sentinel value that must never leak into any assertion below) appears
// earlier in the document, inside the promoter section.
const LEGACY_TEMPLATE_FIXTURE = `
<html><body>
<span>Project Name :</span><span>Godrej United</span>
<span>Registration Number :</span><span>PRM/KA/RERA/TEST/000002</span>

<span>Promoter</span><span>Details</span>
<span>Promoter Type</span><span>:</span><span>Company</span>
<span>Name</span><span>:</span><span>United Oxygen Company Private Limited</span>
<span>PAN Number</span><span>:</span><span>AAACU1898F</span>
<span>Address</span><span>:</span><span>Godrej United, Khatha No. 30, Whitefield Road,</span><span>,Near Phoenix Market City, Bangalore</span>
<span>District</span><span>:</span><span>Bengaluru Urban</span>
<span>PIN Code</span><span>:</span><span>560048</span>
<span>Company Registration No.</span><span>:</span><span>U24114KA1973PTC009076</span>
<span>Authorized Signatory</span><span>Detail</span>
<span>Name</span><span>:</span><span>Uday Bhaskar</span>
<span>Address</span><span>:</span><span>No. 80, Hulkul Ascent, Bangalore</span>
<span>Project Member</span><span>Details</span>
<span>Name</span><span>:</span><span>Mohan L. Poorswani</span>
<span>Type</span><span>:</span><span>Director</span>
<span>Address</span><span>:</span><span>Godrej United, Bangalore</span>
<span>Pin Code</span><span>:</span><span>999999</span>

<span>Project</span><span>Details</span>
<span>Project Name</span><span>:</span><span>Godrej United</span>
<span>Project Description</span><span>:</span><span>Whitefield Main Road, Bangalore</span>
<span>Project Type</span><span>:</span><span>Residential/Group Housing</span>
<span>Project Status</span><span>:</span><span>Completed</span>
<span>Project Start Date</span><span>:</span><span>15-06-2017</span>
<span>Proposed Project Completion Date</span><span>:</span><span>28-02-2022</span>
<span>Estimated Cost of Construction (INR)</span><span>:</span><span>4150000000</span>
<span>Total Project Cost (INR)</span><span>:</span><span>5200000000</span>
<span>Project Address</span><span>:</span><span>Khatha No. 30, Whitefield Main Road,</span><span>, K.R. Puram Hobli, Bangalore.</span>
<span>Pin Code</span><span>:</span><span>560099</span>
<span>District</span><span>:</span><span>Bengaluru Urban</span>
<span>Taluk</span><span>:</span><span>Bengaluru East</span>
<span>Approving Authority</span><span>:</span><span>BBMP - Bruhat Bengaluru Mahanagara Palike</span>
<span>Bank Name</span><span>:</span><span>Bank of Maharashtra</span>
<span>Branch</span><span>:</span><span>Brigade Road Branch</span>
<span>Project End Date</span><span>:</span><span>28-02-2022</span>

<div class="complaints">
  <h1>Complaints On this Promoter (3)</h1>
  <h1>Complaints On this Project (3)</h1>
</div>
</body></html>
`;

test('parseProjectDetails (legacy template): prefers the real "Project End Date" over the earlier "Proposed Project Completion Date" noise', () => {
  const parsed = parseProjectDetails(LEGACY_TEMPLATE_FIXTURE);
  assert.equal(parsed.projectEndDate, '28-02-2022');
});

test('parseProjectDetails (legacy template): reads cost fields under their older labels, positioned before Project Address', () => {
  const parsed = parseProjectDetails(LEGACY_TEMPLATE_FIXTURE);
  assert.equal(parsed.totalProjectCostInr, '5200000000');
  assert.equal(parsed.totalConstructionCostInr, '4150000000');
});

test("parseProjectDetails (legacy template): the project's own Pin Code (after Project Address) is used, not an earlier director's Pin Code", () => {
  const parsed = parseProjectDetails(LEGACY_TEMPLATE_FIXTURE);
  assert.equal(parsed.pinCode, '560099');
  assert.notEqual(parsed.pinCode, '999999');
});

test('parsePromoterProfile (legacy template): falls back to the older field labels', () => {
  const profile = parsePromoterProfile(LEGACY_TEMPLATE_FIXTURE);
  assert.equal(profile.typeOfFirm, 'Company');
  assert.equal(profile.pan, 'AAACU1898F');
  assert.equal(profile.registrationNumber, 'U24114KA1973PTC009076');
  assert.equal(profile.address, 'Godrej United, Khatha No. 30, Whitefield Road, ,Near Phoenix Market City, Bangalore');
  assert.equal(profile.district, 'Bengaluru Urban');
  assert.equal(profile.pinCode, '560048');
});

test('parsePromoterProfile (legacy template): omits GSTIN (genuinely absent on this template) rather than faking it', () => {
  const profile = parsePromoterProfile(LEGACY_TEMPLATE_FIXTURE);
  assert.equal(profile.gstin, undefined);
});

test("parsePromoterProfile (legacy template): does not leak the PROJECT's Taluk into the promoter profile, and does not leak the director's Pin Code either", () => {
  const profile = parsePromoterProfile(LEGACY_TEMPLATE_FIXTURE);
  assert.equal(profile.taluk, undefined);
  assert.notEqual(profile.pinCode, '999999');
});
