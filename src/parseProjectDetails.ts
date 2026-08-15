import type { PromoterProfile } from './types.js';

// Extracts fields from a projectDetails response — verified against real
// fetched detail pages during Phase 1.0 (completed) and a later live
// investigation (ongoing + a second completed sample) that discovered the
// portal actually renders TWO different templates depending on how old the
// project's registration is: a newer template (seen on ongoing projects)
// with richer promoter/cost/geo fields, and an older "legacy" template (seen
// on completed projects registered years ago) with a thinner, differently-
// labeled field set. Label/value pairs render as plain adjacent text nodes
// once tags are stripped, e.g. "Project Status" | ":" | "New Project Launch".
// Only fields confirmed present are extracted here (spec §5.3: omit, don't
// fake, anything not confirmed obtainable) — a field absent on a given
// project's page (because that project's template doesn't have it) is
// legitimately `undefined`, not a bug.
export interface ParsedProjectDetails {
  projectStatus?: string;
  projectStartDate?: string;
  projectEndDate?: string;
  complaintsOnPromoter?: number;
  complaintsOnProject?: number;
  projectType?: string;
  projectDescription?: string;
  usage?: string;
  siteAreaSqm?: string;
  extentDevelopedPct?: string;
  projectAddress?: string;
  pinCode?: string;
  latitude?: string;
  longitude?: string;
  approvingAuthority?: string;
  approvedPlanNumber?: string;
  planApprovalDate?: string;
  totalProjectCostInr?: string;
  totalConstructionCostInr?: string;
  bankName?: string;
  bankBranch?: string;
  ifscCode?: string;
  numberOfPlotsOrUnits?: string;
}

function textSegments(html: string): string[] {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, '\n');
  return stripped
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

// Returns the index of the VALUE segment for `label`, or undefined. Requires
// a literal ':' segment immediately after the label — discovered live: some
// sections (e.g. a table's column headers) repeat a real field's label text
// with NO following ':', and naively taking "whatever comes next" grabs that
// table header instead of the real value further down. Skipping past any
// non-colon occurrence and continuing the search eliminates that false match
// while still finding the genuine label/colon/value triple.
function valueIndexAfterLabel(segs: string[], label: string): number | undefined {
  let idx = segs.indexOf(label);
  while (idx !== -1) {
    if (segs[idx + 1] === ':') return idx + 2;
    idx = segs.indexOf(label, idx + 1);
  }
  return undefined;
}

function valueAfterLabel(segs: string[], label: string): string | undefined {
  const i = valueIndexAfterLabel(segs, label);
  return i === undefined ? undefined : segs[i];
}

// Some address fields render as multiple text nodes (line breaks in the
// source markup). Confirmed live: continuation lines consistently start with
// a leading comma. Joining them avoids silently truncating a real address at
// its first line.
function multilineValueAfterLabel(segs: string[], label: string): string | undefined {
  const i = valueIndexAfterLabel(segs, label);
  if (i === undefined) return undefined;
  const parts = [segs[i]];
  let j = i + 1;
  while (segs[j] !== undefined && segs[j].startsWith(',')) {
    parts.push(segs[j]);
    j += 1;
  }
  return parts.join(' ');
}

// Both templates bound the whole promoter block (firm info, authorized
// signatory, CEO/MD, directors — everything this parser reads) between a
// 'Promoter' + 'Details' two-segment header and the next 'Project' +
// 'Details' header that starts the actual project-details tab. (An earlier
// version of this function stopped at 'Authorized Signatory' instead,
// intending to keep the project's own 'Taluk' out of the promoter's fields —
// live testing showed that ALSO cut off the signatory/CEO/DIN fields, which
// live just after that marker, not before it. The 'Project'+'Details' pair
// is the genuine next section in both templates and doesn't have that
// problem: verified live, no 'Taluk' appears anywhere in either template's
// promoter block before it.)
function indexOfPair(segs: string[], a: string, b: string, from = 0): number {
  for (let i = from; i < segs.length - 1; i++) {
    if (segs[i] === a && segs[i + 1] === b) return i;
  }
  return -1;
}

function promoterSection(segs: string[]): string[] {
  const start = indexOfPair(segs, 'Promoter', 'Details');
  if (start === -1) return [];
  const contentStart = start + 2;
  const end = indexOfPair(segs, 'Project', 'Details', contentStart);
  return end === -1 ? segs.slice(contentStart) : segs.slice(contentStart, end);
}

// Fields that describe the PROJECT itself (address, pincode, lat/long,
// approving authority, cost, bank) live from the 'Project Address' label
// onward in both templates. Scoping to this slice avoids an unscoped search
// wrongly matching an earlier, unrelated occurrence of a generic label like
// 'Pin Code' inside a director/signatory's own address block, which — in the
// legacy template — appears BEFORE the project's own address section.
function projectDetailSection(segs: string[]): string[] {
  const idx = segs.indexOf('Project Address');
  return idx === -1 ? [] : segs.slice(idx);
}

export function parseProjectDetails(html: string): ParsedProjectDetails {
  const segs = textSegments(html);
  const joined = segs.join(' ');
  const projectSection = projectDetailSection(segs);

  const promoterComplaints = /Complaints On this Promoter\s*\((\d+)\)/.exec(joined);
  const projectComplaints = /Complaints On this Project\s*\((\d+)\)/.exec(joined);

  return {
    projectStatus: valueAfterLabel(segs, 'Project Status'),
    projectStartDate: valueAfterLabel(segs, 'Project Start Date'),
    // Legacy/completed pages label this 'Project End Date'; the newer
    // template (seen on ongoing projects, which have no end date yet) only
    // has 'Proposed Completion Date'.
    projectEndDate: valueAfterLabel(segs, 'Project End Date') ?? valueAfterLabel(segs, 'Proposed Completion Date'),
    complaintsOnPromoter: promoterComplaints ? Number(promoterComplaints[1]) : undefined,
    complaintsOnProject: projectComplaints ? Number(projectComplaints[1]) : undefined,
    projectType: valueAfterLabel(segs, 'Project Type'),
    projectDescription: valueAfterLabel(segs, 'Project Description'),
    extentDevelopedPct: valueAfterLabel(segs, 'Extent of development carried till date'),
    projectAddress: multilineValueAfterLabel(segs, 'Project Address'),
    pinCode: valueAfterLabel(projectSection, 'Pin Code'),
    latitude: valueAfterLabel(projectSection, 'Latitude'),
    longitude: valueAfterLabel(projectSection, 'Longitude'),
    approvingAuthority: valueAfterLabel(projectSection, 'Approving Authority'),
    approvedPlanNumber: valueAfterLabel(projectSection, 'Approved Plan Number'),
    planApprovalDate: valueAfterLabel(projectSection, 'Plan Approval Date'),
    // Cost fields are searched unscoped, not within projectSection: the
    // legacy template places them BEFORE 'Project Address' (the newer
    // template places them after), and the labels themselves are specific
    // enough that an unscoped search doesn't risk a false match elsewhere.
    totalProjectCostInr:
      valueAfterLabel(segs, 'Total Project Cost (INR) (C1+C2)') ?? valueAfterLabel(segs, 'Total Project Cost (INR)'),
    totalConstructionCostInr:
      valueAfterLabel(segs, 'Total Construction Cost') ?? valueAfterLabel(segs, 'Estimated Cost of Construction (INR)'),
    bankName: valueAfterLabel(projectSection, 'Bank Name'),
    bankBranch: valueAfterLabel(projectSection, 'Branch'),
    ifscCode: valueAfterLabel(projectSection, 'IFSC Code'),
    numberOfPlotsOrUnits: valueAfterLabel(projectSection, 'Number of Plots'),
  };
}

export function parsePromoterProfile(html: string): PromoterProfile {
  const segs = promoterSection(textSegments(html));

  return {
    typeOfFirm: valueAfterLabel(segs, 'Type of Firm') ?? valueAfterLabel(segs, 'Promoter Type'),
    registrationNumber: valueAfterLabel(segs, 'Registration Number') ?? valueAfterLabel(segs, 'Company Registration No.'),
    pan: valueAfterLabel(segs, 'PAN') ?? valueAfterLabel(segs, 'PAN Number'),
    // 'GSTIN' only appears on the newer template — genuinely absent (not a
    // parse failure) on projects registered before GST existed in the
    // portal's data model.
    gstin: valueAfterLabel(segs, 'GSTIN'),
    mainObjectives: valueAfterLabel(segs, 'Main Objectives'),
    address: multilineValueAfterLabel(segs, 'Promoter Address') ?? multilineValueAfterLabel(segs, 'Address'),
    district: valueAfterLabel(segs, 'District'),
    taluk: valueAfterLabel(segs, 'Taluk'),
    pinCode: valueAfterLabel(segs, 'PIN Code'),
    authorizedSignatory: valueAfterLabel(segs, 'Name of Authorized Signatory'),
    ceoOrMd: valueAfterLabel(segs, 'Name of CEO/MD'),
    designation: valueAfterLabel(segs, 'Designation'),
    din: valueAfterLabel(segs, 'Director Identification (DIN) Number'),
    numberOfDirectors: valueAfterLabel(segs, 'Number of Directors'),
  };
}
