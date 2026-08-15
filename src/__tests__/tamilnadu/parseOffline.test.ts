import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTnOfflineList } from '../../adapters/tamilnadu/parseOfflineList.js';

// Fixtures mirror the real /building/offline/<year> and /layout/offline/<year>
// tables verified against all 19 year-pages, 2026-08-11. Structure (8 cells):
//   [0] S.No [1] Reg No "TN/…/<year> dated …" [2] Promoter name+address
//   [3] Project details ("Project Name: …" in later years, a bare description in
//   2017–18) [4] Approval [5] Completion date [6] Other Details (scanned-PDF
//   links; Promoter/Project docs are HTML-commented server-side) [7] Status.
const OFFLINE_FIXTURE = `
<table><tbody>
<tr>
  <td>1</td>
  <td>TN/29/Building/0008/2023 dated 04/01/2023</td>
  <td>M/s. Purvankara Limited, No.130, Nungambakkam, Chennai, Tamil Nadu-600034.</td>
  <td>Project Name: "Purva Windermere Phase-4A" - Construction of Stilt + 14 Floors residential blocks</td>
  <td>Planning permission by CMDA</td>
  <td>31.12.2027</td>
  <td>
    <!--<a href="https://rera.tn.gov.in/cms/Other_Details/Building/Promoter_Details/2023/-2023.pdf" target="_blank">Promoter Details</a>-->
    <!--<a href="https://rera.tn.gov.in/cms/Other_Details/Building/Project_Details/2023/-2023.pdf" target="_blank">Project Details</a>-->
    <a href="https://rera.tn.gov.in/cms/Other_Details/Building/Approval_Details/2023/8-2023.pdf" target="_blank">Approval Details</a>
    <a href="https://rera.tn.gov.in/cms/Other_Details/Building/Carpet_Area/2023/8-2023.pdf" target="_blank">Carpet Area</a>
    Location of Site: Latitude-13º09’19.0”N; Longitude-80º24’18.9”E;
  </td>
  <td>Progress of Work as on June 2025</td>
</tr>
<tr>
  <td>2</td>
  <td>TN/07/Building/0001/2017 dated 03/01/2017</td>
  <td>Thiru. R.VASUDEVAN, M/s. K.K.D.R. ASSOCIATES, Salem, Tamil Nadu-636004.</td>
  <td>Construction of group development of residential buildings consisting 5 blocks Stilt + 4 floors</td>
  <td>Approved by Salem LPA</td>
  <td>31.05.2020</td>
  <td>
    <a href="https://rera.tn.gov.in/cms/Other_Details/Building/Approval_Details/2017/1-2017.pdf" target="_blank">Approval Details</a>
  </td>
  <td>Completed</td>
</tr>
</tbody></table>
`;

test('parseTnOfflineList extracts clean "Project Name:" names and reg numbers, dropping the "dated …" suffix', () => {
  const records = parseTnOfflineList(OFFLINE_FIXTURE);
  assert.equal(records.length, 2);

  const purva = records[0];
  assert.equal(purva.regNumber, 'TN/29/Building/0008/2023'); // "dated …" stripped
  assert.equal(purva.registeredName, 'Purva Windermere Phase-4A'); // quoted name only, not the description
  assert.equal(purva.dataset, 'registered'); // offline is still a registered project, not a new record kind
});

test('parseTnOfflineList falls back to the description when a filing recorded no project name (2017-era rows)', () => {
  const records = parseTnOfflineList(OFFLINE_FIXTURE);
  const older = records[1];
  assert.equal(older.regNumber, 'TN/07/Building/0001/2017');
  // No "Project Name:" and no quoted token — the whole description carries the
  // searchable tokens. Nothing invented.
  assert.match(older.registeredName, /^Construction of group development/);
});

test('parseTnOfflineList harvests only LIVE scanned-PDF links and never the commented-out (disabled) ones', () => {
  const purva = parseTnOfflineList(OFFLINE_FIXTURE)[0];
  assert.equal(purva.detailRefs?.approval, 'https://rera.tn.gov.in/cms/Other_Details/Building/Approval_Details/2023/8-2023.pdf');
  assert.equal(purva.detailRefs?.carpet, 'https://rera.tn.gov.in/cms/Other_Details/Building/Carpet_Area/2023/8-2023.pdf');
  // The Promoter/Project docs are commented out server-side — must not surface.
  assert.equal(purva.detailRefs?.promoter, undefined);
  assert.equal(purva.detailRefs?.project, undefined);
});

test('parseTnOfflineList harvests table-borne detail (completion date, current status, DMS GPS→decimal) with no OCR', () => {
  const purva = parseTnOfflineList(OFFLINE_FIXTURE)[0];
  assert.equal(purva.detailRefs?.endDate, '31.12.2027'); // Completion Date column
  assert.equal(purva.detailRefs?.status, 'Progress of Work as on June 2025'); // Current Status column
  // "Latitude-13º09'19.0"N" -> 13 + 9/60 + 19/3600 = 13.155278; longitude likewise.
  assert.equal(purva.detailRefs?.lat, '13.155278');
  assert.equal(purva.detailRefs?.long, '80.405250');
});

test('parseTnOfflineList anchors on the reg cell, tolerating malformed rows with shifted/extra <td>s (building-2018)', () => {
  // A leading spacer cell plus extra empties before the data — the reg number is
  // not at a fixed index, but is still identifiable.
  const malformed = `<table><tbody><tr>
    <td>99</td><td></td>
    <td>TN/16/Building/0265/2018 dated 10/10/2018</td>
    <td>M/s. Baashyaam Constructions, Chennai.</td>
    <td>Project Name: "The Plutus Residence" - Construction</td>
    <td>Approved</td><td>2021</td><td></td><td>Withdrawn</td>
  </tr></tbody></table>`;
  const records = parseTnOfflineList(malformed);
  assert.equal(records.length, 1);
  assert.equal(records[0].regNumber, 'TN/16/Building/0265/2018');
  assert.equal(records[0].registeredName, 'The Plutus Residence');
});

test('parseTnOfflineList skips spacer/header rows with no TN/…/<year> reg number', () => {
  const noReg = `<table><tbody><tr><td>S.No</td><td>Project Registration No.</td><td>Promoter</td></tr></tbody></table>`;
  assert.equal(parseTnOfflineList(noReg).length, 0);
});

// GPS is hand-typed, so symbols (º/°, '/’) and precision (deg-min-sec vs
// deg-min vs decimal) vary row to row — the DMS→decimal conversion tolerates it.
function offlineRowWithGps(gps: string): string {
  return `<table><tbody><tr>
    <td>1</td><td>TN/29/Building/0100/2022 dated 01/01/2022</td>
    <td>Some Promoter</td><td>Project Name: "GPS Test"</td>
    <td>appr</td><td>2030</td><td>Location of Site: ${gps}</td><td>Ongoing</td>
  </tr></tbody></table>`;
}

test('parseTnOfflineList converts deg-min-sec DMS GPS to decimal', () => {
  const r = parseTnOfflineList(offlineRowWithGps(`Latitude-13º09’19.0”N; Longitude-80º24’18.9”E;`))[0];
  assert.equal(r.detailRefs?.lat, '13.155278');
  assert.equal(r.detailRefs?.long, '80.405250');
});

test('parseTnOfflineList converts a minutes-only DMS variant (no seconds, plain ° symbol)', () => {
  const r = parseTnOfflineList(offlineRowWithGps(`Latitude-13°09'N; Longitude-80°24'E;`))[0];
  assert.equal(r.detailRefs?.lat, '13.150000'); // 13 + 9/60
  assert.equal(r.detailRefs?.long, '80.400000'); // 80 + 24/60
});

test('parseTnOfflineList reads an already-decimal coordinate too', () => {
  const r = parseTnOfflineList(offlineRowWithGps(`Latitude-13.163286N; Longitude-80.301217E;`))[0];
  assert.equal(r.detailRefs?.lat, '13.163286');
  assert.equal(r.detailRefs?.long, '80.301217');
});

test('parseTnOfflineList omits GPS entirely for a row that has none (never guesses)', () => {
  const r = parseTnOfflineList(offlineRowWithGps('address only, no coordinates'))[0];
  assert.equal(r.detailRefs?.lat, undefined);
  assert.equal(r.detailRefs?.long, undefined);
});
