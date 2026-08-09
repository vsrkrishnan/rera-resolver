import type { IndexRecord } from '../../types.js';

// Parses Tamil Nadu's online registered-project tables (Building and Layout —
// identical 9-column structure, verified live 2026-08-09 against
// /registered-building/tn and /registered-layout/tn). Server-rendered
// <table id="example1"> with a plain <tbody>; DataTables is client-side chrome
// only. Column order:
//   [0] S.No
//   [1] Project Registration No.  — regNumber in <strong>, plus a "dated ..." line
//   [2] Name and Address of the Promoter — name+address combined, no separator
//   [3] Project Details and Address — "Project Name: <name><br><description>"
//   [4] Approval Details
//   [5] Project Completion Date
//   [6] Other Details — the two detail-page links + lat/long
//   [7] Form-c   [8] (varies)
const ROW_PATTERN = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
const CELL_PATTERN = /<td[^>]*>([\s\S]*?)<\/td>/g;
const REG_NUMBER_PATTERN = /<strong>\s*([\s\S]*?)\s*<\/strong>/;
// The portal's detail links: public-view1 = promoter page, public-view2 =
// project page. Note the markup is inconsistent — the Project Details anchor
// renders as `href ='...'` (a space before `=`), so tolerate optional space.
const PROMOTER_LINK_PATTERN = /href\s*=\s*['"]([^'"]*public-view1[^'"]*)['"]/;
const PROJECT_LINK_PATTERN = /href\s*=\s*['"]([^'"]*public-view2[^'"]*)['"]/;

function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

// registeredName is just the "Project Name:" value, up to the first <br> that
// separates it from the (often long) block description.
function extractProjectName(cellHtml: string): string {
  const beforeBreak = cellHtml.split(/<br\s*\/?>/i)[0];
  const text = stripTags(beforeBreak);
  const m = /Project\s*Name\s*:\s*(.+)$/i.exec(text);
  return (m ? m[1] : text).trim();
}

// Parses every <tbody> in the input. The adapter concatenates the Building and
// Layout tables into one payload (TN's single 'registered' pool), so this must
// handle more than one table body rather than only the first.
export function parseTnList(html: string): IndexRecord[] {
  const records: IndexRecord[] = [];
  const tbodyPattern = /<tbody[^>]*>([\s\S]*?)<\/tbody>/g;
  let tbodyMatch: RegExpExecArray | null;
  while ((tbodyMatch = tbodyPattern.exec(html))) {
    parseTbody(tbodyMatch[1], records);
  }
  return records;
}

function parseTbody(tbody: string, records: IndexRecord[]): void {
  const rowPattern = new RegExp(ROW_PATTERN);
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowPattern.exec(tbody))) {
    const row = rowMatch[1];
    const cells: string[] = [];
    const cellPattern = new RegExp(CELL_PATTERN);
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellPattern.exec(row))) cells.push(cellMatch[1]);
    if (cells.length < 7) continue; // header/spacer rows

    const regNumberMatch = REG_NUMBER_PATTERN.exec(cells[1]);
    const regNumber = regNumberMatch ? stripTags(regNumberMatch[1]) : '';
    if (!regNumber) continue;

    const registeredName = extractProjectName(cells[3]);
    const promoterName = stripTags(cells[2]);
    if (!registeredName || !promoterName) continue;

    // Detail-page URLs harvested straight from the row (no id-lookup needed).
    // Stored as opaque refs for the adapter's fetchDetail to use later.
    const projectLink = PROJECT_LINK_PATTERN.exec(cells[6] ?? '');
    const promoterLink = PROMOTER_LINK_PATTERN.exec(cells[6] ?? '');
    const detailRefs: Record<string, string> = {};
    if (projectLink) detailRefs.project = projectLink[1];
    if (promoterLink) detailRefs.promoter = promoterLink[1];

    records.push({
      regNumber,
      registeredName,
      promoterName,
      // Tamil Nadu doesn't split ongoing/completed (see the Dataset type) — the
      // whole online table is one registered-projects pool.
      dataset: 'registered',
      detailRefs: Object.keys(detailRefs).length > 0 ? detailRefs : undefined,
    });
  }
}
