import type { PromoterProfile } from '../../types.js';
import type { ParsedProjectDetails } from '../../parseProjectDetails.js';

// Tamil Nadu's project-detail (public-view2) and promoter-detail (public-view1)
// are two separate pages. Both render label/value pairs as adjacent text nodes,
// but — unlike Karnataka's separate ":" segment — TN's colon lives inside the
// label ("Project Name :"), and the value is sometimes in the same segment
// ("District : Chennai") and sometimes the next one ("Project Name :" then
// "Thiruvottiyur Scheme"). valueForLabel handles both. Only fields the portal
// actually exposes are extracted; TN's detail pages don't publish project cost,
// bank, complaint counts, or a clean status field, so those stay undefined
// (omit, never fake). Verified live 2026-08-09 against one Building project.
function segments(html: string): string[] {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/g, ' ')
    .replace(/<[^>]+>/g, '\n')
    .split('\n')
    .map((s) => s.replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function valueForLabel(segs: string[], label: string): string | undefined {
  const re = new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*(.*)$`, 'i');
  for (let i = 0; i < segs.length; i++) {
    const m = re.exec(segs[i]);
    if (!m) continue;
    if (m[1]) return m[1].trim(); // inline "Label : value"
    if (segs[i + 1] !== undefined) return segs[i + 1].trim(); // value in the next segment
  }
  return undefined;
}

export function parseTnProjectDetail(html: string): ParsedProjectDetails {
  const segs = segments(html);
  return {
    projectType: valueForLabel(segs, 'Type of Building') ?? valueForLabel(segs, 'Type of Layout'),
    // TN publishes a completion date but not a separate start date or status.
    projectEndDate: valueForLabel(segs, 'Project Completion Date'),
    projectAddress: valueForLabel(segs, 'Address'),
    pinCode: valueForLabel(segs, 'Pincode'),
    latitude: valueForLabel(segs, 'Latitude'),
    longitude: valueForLabel(segs, 'Longitude'),
    approvedPlanNumber: valueForLabel(segs, 'Planning Permission Approval / Renewal Letter No'),
    planApprovalDate: valueForLabel(segs, 'Planning Permission Approval / Renewal Date'),
  };
}

export function parseTnPromoter(html: string): PromoterProfile {
  const segs = segments(html);
  return {
    typeOfFirm: valueForLabel(segs, 'Type of Promoter'),
    // TN labels the company/registration id "Company Registration No"; PAN is
    // published masked (e.g. "XXXXXX230D") — stored verbatim, not "cleaned".
    registrationNumber: valueForLabel(segs, 'Company Registration No'),
    pan: valueForLabel(segs, 'PAN Card No'),
    address: valueForLabel(segs, 'Address'),
    pinCode: valueForLabel(segs, 'Pincode'),
  };
}
