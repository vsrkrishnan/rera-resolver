import type { IndexRecord, InvestigationRecord, InvestigationStatus } from './types.js';

// Parses the inline `applicationNameList2/3/4.push(...)` JS arrays that
// viewAllProjects embeds to drive its client-side autocomplete widget. Each
// project emits parallel .push() calls in a fixed order: acknowledgement no.
// (applicationNameList), registration no. (applicationNameList2), project
// name (applicationNameList3), promoter name (applicationNameList4).
// Verified live against the actual portal (Phase 1.0): no locality/status/
// date fields exist anywhere in this page for ongoing rows — this dump is
// JS seed data only, not an HTML table, and has none of the completed
// dataset's extra columns.
const ONGOING_PATTERN =
  /applicationNameList2\s*\.push\(\s*'([^']*)'\s*\)\s*;\s*applicationNameList3\s*\.push\(\s*'([^']*)'\s*\)\s*;\s*applicationNameList4\s*\.push\(\s*'([^']*)'\s*\)\s*;/g;

export function parseOngoing(html: string): IndexRecord[] {
  const records: IndexRecord[] = [];
  let m: RegExpExecArray | null;
  const pattern = new RegExp(ONGOING_PATTERN);
  while ((m = pattern.exec(html))) {
    const [, regNumber, registeredName, promoterName] = m;
    const trimmedRegNumber = regNumber.trim();
    // Confirmed live: ~940 ongoing rows have an EMPTY registration number —
    // real portal data, not a parse error (these are applications that were
    // submitted but never assigned a registration number, e.g. still
    // in-process or rejected). regNumber is this library's dedup/identity
    // key end to end, so a blank one can't be deduped or resolved to
    // anything meaningful, and surfacing it as a "match" would misrepresent
    // an unregistered application as a registered project. Skip these rather
    // than let them silently collide with each other under regNumber: "".
    if (!trimmedRegNumber) continue;
    records.push({
      regNumber: trimmedRegNumber,
      registeredName: registeredName.trim(),
      promoterName: promoterName.trim(),
      dataset: 'ongoing',
    });
  }
  return records;
}

// Parses viewAllCompletedProjects's <tbody> rows. Confirmed live (Phase 1.0)
// this page renders real data server-side (DataTables plugin is UI chrome
// only). Column order per <thead>: S.No, REGISTRATION NO, PROMOTER, PROJECT,
// VIEW PROJECT DETAILS, TYPE, DISTRICT, TALUK, PROPOSED COMPLETION DATE,
// Applied for Completion. The 5th column ("VIEW PROJECT DETAILS") holds a
// button with an internal row id (`<a id="...">`) used by the projectDetails
// endpoint — not the registration number, and not present anywhere in the
// ongoing dump.
const CELL_PATTERN = /<td[^>]*>([\s\S]*?)<\/td>/g;
const ROW_PATTERN = /<tr>([\s\S]*?)<\/tr>/g;
const ROW_ID_PATTERN = /<a\s+id="(\d+)"/;

function stripTags(cellHtml: string): string {
  return cellHtml.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function parseCompleted(html: string): IndexRecord[] {
  const tbodyStart = html.indexOf('<tbody');
  const tbodyEnd = html.indexOf('</tbody>');
  if (tbodyStart === -1 || tbodyEnd === -1) return [];
  const tbody = html.substring(tbodyStart, tbodyEnd);

  const records: IndexRecord[] = [];
  const rowPattern = new RegExp(ROW_PATTERN);
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowPattern.exec(tbody))) {
    const row = rowMatch[1];
    const cells: string[] = [];
    const cellPattern = new RegExp(CELL_PATTERN);
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellPattern.exec(row))) {
      cells.push(cellMatch[1]);
    }
    // cells: [0] S.No, [1] reg no, [2] promoter, [3] project, [4] view-details
    // button, [5] type, [6] district, [7] taluk, [8] proposed completion,
    // [9] applied-for-completion.
    if (cells.length < 4) continue;
    const regNumber = stripTags(cells[1]);
    const promoterName = stripTags(cells[2]);
    const registeredName = stripTags(cells[3]);
    if (!regNumber || !registeredName) continue;

    const idMatch = cells[4] ? ROW_ID_PATTERN.exec(cells[4]) : null;

    records.push({
      regNumber,
      registeredName,
      promoterName,
      dataset: 'completed',
      completedRowId: idMatch ? idMatch[1] : undefined,
      projectType: cells[5] ? stripTags(cells[5]) || undefined : undefined,
      district: cells[6] ? stripTags(cells[6]) || undefined : undefined,
      taluk: cells[7] ? stripTags(cells[7]) || undefined : undefined,
      proposedCompletionDate: cells[8] ? stripTags(cells[8]) || undefined : undefined,
      appliedForCompletionDate: cells[9] ? stripTags(cells[9]) || undefined : undefined,
    });
  }
  return records;
}

const RAW_STATUS_MAP: Record<string, InvestigationStatus> = {
  'no reply': 'no_reply',
  'no reply from promoter': 'no_reply', // portal uses both phrasings for the same meaning
  'reply received but not satisfactory': 'reply_not_satisfactory',
  'not satisfactory': 'not_satisfactory',
  approved: 'approved',
};

function normalizeStatus(rawStatus: string): InvestigationStatus {
  return RAW_STATUS_MAP[rawStatus.trim().toLowerCase()] ?? 'unknown';
}

// Parses unregProjectList's ("Projects Under Investigation") <tbody> rows.
// Investigated 2026-07-18: unlike the other two datasets, this page's rows
// are malformed — each <tr> is opened but never closed with a matching
// </tr> (verified: 1,050 <tr> openings, zero corresponding closes in the
// raw HTML). A </tr>-anchored regex like parseCompleted's silently matches
// nothing here rather than erroring, so this splits on <tr> openings
// instead of matching balanced tags. Column order per <thead>: S.NO,
// PROJECT NAME, PROMOTER NAME, STATUS, CORPORATE ADDRESS, PUBLISHED DATE.
export function parseInvestigationList(html: string): InvestigationRecord[] {
  const tbodyStart = html.indexOf('<tbody');
  const tbodyEnd = html.indexOf('</tbody>');
  if (tbodyStart === -1 || tbodyEnd === -1) return [];
  const tbody = html.substring(tbodyStart, tbodyEnd);

  const records: InvestigationRecord[] = [];
  const rowChunks = tbody.split('<tr>').slice(1); // first chunk is whitespace before the first row
  for (const chunk of rowChunks) {
    const cells: string[] = [];
    const cellPattern = new RegExp(CELL_PATTERN);
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellPattern.exec(chunk))) {
      cells.push(stripTags(cellMatch[1]));
    }
    // cells: [0] S.NO, [1] project name, [2] promoter name, [3] status,
    // [4] corporate address, [5] published date.
    if (cells.length < 6) continue;
    const projectName = cells[1];
    if (!projectName) continue;

    records.push({
      projectName,
      promoterName: cells[2],
      status: normalizeStatus(cells[3]),
      rawStatus: cells[3],
      corporateAddress: cells[4],
      publishedDate: cells[5],
    });
  }
  return records;
}

// Dedup rule (spec §4.3): a project may appear in both dumps. Deduplicate by
// regNumber, preferring the 'completed' record deterministically — it carries
// strictly more fields (extra columns + completedRowId) than an ongoing row
// ever can.
export function dedupeRecords(records: IndexRecord[]): IndexRecord[] {
  const byRegNumber = new Map<string, IndexRecord>();
  for (const record of records) {
    const existing = byRegNumber.get(record.regNumber);
    if (!existing || (existing.dataset === 'ongoing' && record.dataset === 'completed')) {
      byRegNumber.set(record.regNumber, record);
    }
  }
  return Array.from(byRegNumber.values());
}
