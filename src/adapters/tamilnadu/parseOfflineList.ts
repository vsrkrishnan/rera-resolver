import type { IndexRecord } from '../../types.js';

// Parses Tamil Nadu's OFFLINE (paper-filed) archive tables — the per-year
// /building/offline/<year> and /layout/offline/<year> pages, concatenated by
// the adapter. Structurally different from the online tables (parseList.ts),
// confirmed against all 19 year-pages (2017–2026), 2026-08-11:
//
//   [0] S.No
//   [1] Project Registration No.  — plain text "TN/29/Building/0008/2023 dated ..."
//   [2] Name and Address of the Promoter
//   [3] Project Details and Address — sometimes "Project Name: "X" - <desc>",
//                                     often (esp. 2017–18) just a description
//   [4] Approval Details   [5] Completion Date
//   [6] Other Details — links to scanned PDFs (Approval/Carpet; the structured
//                       Promoter/Project docs are commented out server-side)
//   [7] Current Status
//
// Three realities drive this parser (not the online one):
//  1. Reg numbers are `TN/…/<year>` (NOT `TNRERA/…`), so we anchor each row on
//     the cell matching that pattern rather than trusting a fixed column index
//     — building-2018 has malformed rows with shifted/extra <td>s.
//  2. Names are a spectrum: a clean `Project Name:` in later years, nothing but
//     a construction description in 2017–18. We fall back through quoted → full
//     description so a record is always searchable; nothing is faked.
//  3. There are no structured detail pages — only scanned PDFs. Their live URLs
//     are harvested into detailRefs for reference; fetchDetail returns null for
//     these rows (honest detail_unavailable). Detail-mode is keyed off the
//     `TN/…` reg prefix by the adapter, so no marker is stored here.

const TBODY_PATTERN = /<tbody[^>]*>([\s\S]*?)<\/tbody>/g;
const ROW_PATTERN = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
const CELL_PATTERN = /<td[^>]*>([\s\S]*?)<\/td>/g;

// The registration number: `TN/<district>/<Building|Layout>/<serial>/<year>`.
// `.*?` (non-greedy) + a `20\d\d` year anchor stops at the *registration* year
// and not at a 4-digit serial like "0001" or the trailing "dated dd/mm/yyyy".
// Tolerates the "…/Offline/…" serial variant seen in 2025.
const REG_PATTERN = /TN\s*\/.*?\/\s*20\d{2}(?=\s|<|$)/i;

// Live scanned-PDF documents, by kind — matched against each harvested URL by
// the portal's path segment. (The structured Promoter/Project docs are disabled
// server-side, so they never appear among the live links.)
const PDF_KINDS: Record<string, RegExp> = {
  approval: /Approval_Details/i,
  carpet: /Carpet_Area/i,
  formA: /Form_A/i,
  status: /Current_Status_Project/i,
};

function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Offline rows carry GPS as manually-typed DMS in the project cell
// ("Location of Site: Latitude-10º59'54.8"N; Longitude-79º27'44.0"E") — symbols
// (º/°/⁰, '/’/′, "/”/″) and precision (deg-min-sec vs deg-min vs decimal) vary
// row to row. Convert to decimal tolerantly; anything we can't confidently read
// stays undefined (never guess a coordinate).
const DMS_CHARS = "0-9.\\sº°⁰'’′\"”″";

function dmsToDecimal(raw: string): string | undefined {
  const hemi = /[NSEW]/i.exec(raw)?.[0]?.toUpperCase();
  const nums = (raw.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
  if (!hemi || nums.length === 0) return undefined;
  const [deg = 0, min = 0, sec = 0] = nums;
  let dec = deg + min / 60 + sec / 3600;
  if (hemi === 'S' || hemi === 'W') dec = -dec;
  if (!Number.isFinite(dec) || Math.abs(dec) > 180) return undefined;
  return dec.toFixed(6);
}

function parseOfflineGps(text: string): { lat?: string; long?: string } {
  const lat = new RegExp(`Lat[a-z]*\\s*[-:]?\\s*([${DMS_CHARS}]*[NS])`, 'i').exec(text);
  const long = new RegExp(`Long[a-z]*\\s*[-:]?\\s*([${DMS_CHARS}]*[EW])`, 'i').exec(text);
  return { lat: lat ? dmsToDecimal(lat[1]) : undefined, long: long ? dmsToDecimal(long[1]) : undefined };
}

// Longest a description-fallback name is allowed to be: enough to carry the
// distinguishing tokens, short enough not to be an unwieldy paragraph.
const NAME_MAX = 200;

// registeredName, best-available: the labelled "Project Name:" value, else the
// first quoted token, else the raw description (so the row is still searchable
// even when the filing recorded no distinct name — common in 2017–18).
function extractOfflineName(projectHtml: string): string {
  const text = stripTags(projectHtml);
  const labelled = /Project\s*Name\s*:\s*["'“”]?([^"'“”<]+?)["'“”]?\s*(?:-\s|–\s|$)/i.exec(text);
  if (labelled && labelled[1].trim().length >= 2) return labelled[1].trim();

  const quoted = /["'“”]([^"'“”]{2,80})["'“”]/.exec(text);
  if (quoted) return quoted[1].trim();

  return text.slice(0, NAME_MAX).trim();
}

export function parseTnOfflineList(html: string): IndexRecord[] {
  const records: IndexRecord[] = [];
  let tbodyMatch: RegExpExecArray | null;
  const tbodyPattern = new RegExp(TBODY_PATTERN);
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
    if (cells.length < 3) continue;

    // Anchor on the reg-number cell rather than a fixed index — malformed rows
    // (building-2018) shift columns, but the reg cell is always identifiable.
    const stripped = cells.map(stripTags);
    const regIdx = stripped.findIndex((c) => REG_PATTERN.test(c));
    if (regIdx < 0 || regIdx + 2 >= cells.length) continue;

    const regNumber = (REG_PATTERN.exec(stripped[regIdx]) ?? [''])[0].replace(/\s+/g, '');
    const promoterName = stripped[regIdx + 1];
    const registeredName = extractOfflineName(cells[regIdx + 2]);
    if (!regNumber || !promoterName || !registeredName) continue;

    // Harvest live scanned-PDF links for reference. Strip HTML comments first:
    // the portal comments out the (disabled) Promoter/Project docs, and we must
    // not surface those dead links.
    const liveRow = row.replace(/<!--[\s\S]*?-->/g, '');
    const pdfUrls = liveRow.match(/(?:https?:\/\/[^"'\s)]+|\/[^"'\s)]+)\.pdf/gi) ?? [];
    const detailRefs: Record<string, string> = {};
    for (const raw of pdfUrls) {
      const url = raw.startsWith('http') ? raw : `https://rera.tn.gov.in${raw}`;
      for (const [kind, re] of Object.entries(PDF_KINDS)) {
        if (!detailRefs[kind] && re.test(url)) detailRefs[kind] = url;
      }
    }

    // Table-borne detail (no OCR): GPS, completion date, current status.
    // Stored as data values in detailRefs alongside the PDF URLs — the adapter
    // reads them back to build an offline project's detail, and the fetchProject
    // documents filter only surfaces the `.pdf` entries. The "Location of Site"
    // GPS lands in different columns year to year, so scan the whole row for it;
    // date/status are positional relative to the reg cell.
    const { lat, long } = parseOfflineGps(stripped.join('  '));
    if (lat) detailRefs.lat = lat;
    if (long) detailRefs.long = long;
    const endDate = stripped[regIdx + 4] ?? '';
    if (/\d{1,2}[./-]\d{1,2}[./-]\d{4}/.test(endDate)) detailRefs.endDate = endDate;
    const status = regIdx + 6 < stripped.length ? stripped[regIdx + 6] : (stripped[stripped.length - 1] ?? '');
    if (status && status !== '-' && !REG_PATTERN.test(status)) detailRefs.status = status;

    records.push({
      regNumber,
      registeredName,
      promoterName,
      // Offline projects are still "registered" projects — the online/offline
      // distinction is a crawl-source concern, not a record kind (see Dataset).
      dataset: 'registered',
      detailRefs: Object.keys(detailRefs).length > 0 ? detailRefs : undefined,
    });
  }
}
