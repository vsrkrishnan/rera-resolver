// Tamil Nadu adapter (state TN). Pure wiring over the TN-specific fetch/parse
// modules in ./tamilnadu/, exactly as karnataka.ts assembles Karnataka's.
//
// How TN differs from Karnataka (confirmed by portal probe 2026-08-09, offline
// archives added 2026-08-11):
//  - No ongoing/completed split: everything is a 'registered' project. But TN
//    exposes them through THREE crawl sources with different shapes — the online
//    e-registered tables (reg `TNRERA/…`), and the paper-filed offline archives
//    for buildings and for layouts (per-year pages, reg `TN/…`). Each is a
//    CrawlSource with its own fetch, parser, and sanity floor; the online/offline
//    split is a crawl-source concern, not a record kind.
//  - Online detail pages are keyed by a random id present only in the list row
//    (harvested into IndexRecord.detailRefs), and project detail and promoter
//    detail are TWO separate pages — so fetchDetail makes up to two calls and
//    returns both. Offline rows have NO structured detail pages (only scanned
//    PDFs, whose URLs are stored in detailRefs for reference), so fetchDetail
//    returns null for them — honest detail_unavailable.
//  - No "under investigation" enforcement list with Karnataka's shape.
import type { FetchLog } from '../registryFetch.js';
import {
  fetchBuildingListHtml,
  fetchLayoutListHtml,
  fetchDetailPageHtml,
  fetchOfflineBuildingHtml,
  fetchOfflineLayoutHtml,
} from './tamilnadu/fetch.js';
import { parseTnList } from './tamilnadu/parseList.js';
import { parseTnOfflineList } from './tamilnadu/parseOfflineList.js';
import { parseTnProjectDetail, parseTnPromoter } from './tamilnadu/parseDetail.js';
import type { ParsedProjectDetails } from '../parseProjectDetails.js';
import type { StateAdapter } from './types.js';

// TN's online pool comes from two online tables; fetch both and hand them to
// the parser together (parseTnList reads every <tbody>). If either fails, the
// whole source is null so the sync keeps the prior snapshot rather than
// swapping in a half-crawled index.
async function fetchOnlineList(log?: FetchLog): Promise<string | null> {
  const [building, layout] = await Promise.all([fetchBuildingListHtml(log), fetchLayoutListHtml(log)]);
  if (building === null || layout === null) return null;
  return `${building}\n${layout}`;
}

export const tamilNaduAdapter: StateAdapter = {
  code: 'TN',
  name: 'Tamil Nadu',
  sources: [
    // Online e-registered projects (reg `TNRERA/…/2026`). Observed 2026-08-09:
    // Building 276, Layout 3,137 (total 3,413). Floors are ~1/3 of the observed
    // parsed count — parser-break protection, not a tuning knob.
    { id: 'online', sanityFloor: 1_000, fetch: fetchOnlineList, parse: (raw) => parseTnList(raw) },
    // Offline (paper-filed) archives, per-year pages concatenated per category.
    // Observed parsed counts 2026-08-11: building ~2,822, layout ~11,414.
    { id: 'offline-building', sanityFloor: 1_200, fetch: fetchOfflineBuildingHtml, parse: (raw) => parseTnOfflineList(raw) },
    { id: 'offline-layout', sanityFloor: 4_000, fetch: fetchOfflineLayoutHtml, parse: (raw) => parseTnOfflineList(raw) },
  ],

  hasInvestigationList: false,

  // Detail routing keys off the reg-number prefix (the only reliable
  // online/offline signal on a record): online regs are `TNRERA/…`, offline are
  // `TN/…`.
  async fetchDetail(record, log) {
    // Offline projects have no structured detail page — but their list row
    // carried real data (GPS, completion date, current status), harvested into
    // detailRefs at parse time. Assemble it here, no network. The scanned PDFs
    // (approval/carpet) remain in detailRefs and surface as `documents` via
    // fetchProject. Nothing is fabricated — a field absent from the row is
    // simply omitted, and if the row carried nothing we return null.
    if (!record.regNumber.startsWith('TNRERA/')) {
      const refs = record.detailRefs ?? {};
      const detail: ParsedProjectDetails = {
        latitude: refs.lat,
        longitude: refs.long,
        projectStatus: refs.status,
        projectEndDate: refs.endDate,
      };
      return Object.values(detail).some((v) => v !== undefined) ? { detail } : null;
    }

    // Online: project detail (public-view2) and promoter detail (public-view1)
    // are two separately-keyed pages; their URLs were harvested into detailRefs.
    const projectUrl = record.detailRefs?.project;
    if (!projectUrl) return null;

    const projectHtml = await fetchDetailPageHtml(projectUrl, log);
    if (!projectHtml) return null;

    const detail = parseTnProjectDetail(projectHtml);

    const promoterUrl = record.detailRefs?.promoter;
    const promoterHtml = promoterUrl ? await fetchDetailPageHtml(promoterUrl, log) : null;
    const promoter = promoterHtml ? parseTnPromoter(promoterHtml) : undefined;

    return { detail, promoter };
  },
};
