// Extracts fields from a projectDetails response — verified against 3 real
// fetched detail pages during Phase 1.0 investigation (label/value pairs
// render as plain adjacent text nodes once tags are stripped, e.g.
// "Project Status" | ":" | "New Project Launch"). Only fields confirmed
// present are extracted here (spec §5.3: omit, don't fake, anything not
// confirmed obtainable).
export interface ParsedProjectDetails {
  projectStatus?: string;
  projectStartDate?: string;
  projectEndDate?: string;
  complaintsOnPromoter?: number;
  complaintsOnProject?: number;
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

function valueAfterLabel(segs: string[], label: string): string | undefined {
  const idx = segs.indexOf(label);
  if (idx === -1) return undefined;
  let i = idx + 1;
  if (segs[i] === ':') i += 1;
  return segs[i];
}

export function parseProjectDetails(html: string): ParsedProjectDetails {
  const segs = textSegments(html);
  const joined = segs.join(' ');

  const promoterComplaints = /Complaints On this Promoter\s*\((\d+)\)/.exec(joined);
  const projectComplaints = /Complaints On this Project\s*\((\d+)\)/.exec(joined);

  return {
    projectStatus: valueAfterLabel(segs, 'Project Status'),
    projectStartDate: valueAfterLabel(segs, 'Project Start Date'),
    projectEndDate: valueAfterLabel(segs, 'Project End Date'),
    complaintsOnPromoter: promoterComplaints ? Number(promoterComplaints[1]) : undefined,
    complaintsOnProject: projectComplaints ? Number(projectComplaints[1]) : undefined,
  };
}
