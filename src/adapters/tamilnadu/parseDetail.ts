import type { PromoterProfile } from '../../types.js';
import type { ParsedProjectDetails } from '../../parseProjectDetails.js';

// Tamil Nadu's project-detail (public-view2) and promoter-detail (public-view1)
// are two separate "Form A" pages. Each field renders as
//   <label>Field Name :</label> <p|div class="fw-semibold">value</p|div>
// so, once tags are flattened to segments, a field's value is the segment
// following its "Field :" label. Values the promoter left blank render as "-",
// which we treat as absent (omit, never fake). Verified live 2026-08-13 against
// building projects (Brigade Stellaris + Matrix Shelters) and an individual
// promoter; the pages expose far more than KA's — bank/RERA accounts, stage of
// construction, dwelling units, directors/partners, financial indicators.
function segments(html: string): string[] {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/g, ' ')
    .replace(/<[^>]+>/g, '\n')
    .split('\n')
    .map((s) => s.replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

// A blank field is published as "-"; a genuinely-absent value is omitted.
function cleanValue(v: string): string | undefined {
  const t = v.trim();
  return !t || t === '-' ? undefined : t;
}

// Matches a "<Label> ... :" segment where the label is a PREFIX (the portal's
// labels are often verbose, e.g. "Total No. of Dwelling Units including all
// Phases/Villas :"), then returns the inline value or the next segment. Skips
// blank ("-") matches and keeps looking, so a populated later occurrence wins
// over an earlier blank one.
function labelRegExp(label: string): RegExp {
  return new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^:]*:\\s*(.*)$`, 'i');
}

function valueForLabel(segs: string[], label: string): string | undefined {
  const re = labelRegExp(label);
  for (let i = 0; i < segs.length; i++) {
    const m = re.exec(segs[i]);
    if (!m) continue;
    const val = cleanValue(m[1] || segs[i + 1] || '');
    if (val !== undefined) return val;
  }
  return undefined;
}

// All non-blank values for a repeating label (e.g. each "Director / Partner
// Name :" block on a firm's promoter page).
function valuesForLabel(segs: string[], label: string): string[] {
  const re = labelRegExp(label);
  const out: string[] = [];
  for (let i = 0; i < segs.length; i++) {
    const m = re.exec(segs[i]);
    if (!m) continue;
    const val = cleanValue(m[1] || segs[i + 1] || '');
    if (val !== undefined) out.push(val);
  }
  return out;
}

export function parseTnProjectDetail(html: string): ParsedProjectDetails {
  const segs = segments(html);
  const v = (label: string) => valueForLabel(segs, label);
  return {
    projectType: v('Type of Building') ?? v('Type of Layout'),
    projectDescription: v('Project Details'),
    usage: v('Usage'),
    siteAreaSqm: v('Site Extent'),
    projectStatus: v('Stage of Construction'),
    // Buildings label this "Total No. of Dwelling Units …"; layouts "… Plots".
    numberOfPlotsOrUnits:
      v('Total No. of Dwelling Units') ?? v('Total No. of Plots') ?? v('No. of Plots') ?? v('No of Plots'),
    projectEndDate: v('Project Completion Date'),
    projectAddress: v('Address'),
    pinCode: v('Pincode'),
    latitude: v('Latitude'),
    longitude: v('Longitude'),
    approvingAuthority: v('Building License/Permit Issued By') ?? v('Planning Permission Issued By'),
    approvedPlanNumber: v('Planning Permission Approval / Renewal Letter No'),
    planApprovalDate: v('Planning Permission Approval / Renewal Date'),
    // TN publishes the promoter's RERA-designated bank account here — KA doesn't.
    bankName: v('Bank Name'),
    bankBranch: v('Branch Name'),
  };
}

// A 15-char GSTIN (e.g. 33ABTFM1317N1ZX) vs a 21-char CIN (U85110KA1995PLC019126)
// — TN files either under the one "Company Registration No" label.
const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z\d]{2}$/i;

export function parseTnPromoter(html: string): PromoterProfile {
  const segs = segments(html);
  const v = (label: string) => valueForLabel(segs, label);

  const companyReg = v('Company Registration No');
  const isGstin = companyReg ? GSTIN_RE.test(companyReg.replace(/\s/g, '')) : false;
  const directorNames = valuesForLabel(segs, 'Director / Partner Name');

  return {
    typeOfFirm: v('Type of Promoter'),
    // The single "Company Registration No" label carries a CIN or a GSTIN.
    registrationNumber: isGstin ? undefined : companyReg,
    gstin: isGstin ? companyReg : undefined,
    // PAN is published masked (e.g. "XXXXXX230D") — stored verbatim, not cleaned.
    pan: v('PAN Card No'),
    address: v('Address'),
    pinCode: v('Pincode'),
    email: v('Email ID'),
    mobile: v('Mobile No. 1'),
    website: v('Website Address'),
    // Individual promoters (no firm): Name / Father's Name / Occupation.
    occupation: v('Occupation'),
    fathersName: v("Father's Name"),
    // Companies list a Chairman/CEO; firms list partners/directors.
    ceoOrMd: v('Chairman / CEO Name'),
    directorNames: directorNames.length ? directorNames : undefined,
    numberOfDirectors: directorNames.length ? String(directorNames.length) : undefined,
  };
}
