// Tamil Nadu adapter (state TN). Pure wiring over the TN-specific fetch/parse
// modules in ./tamilnadu/, exactly as karnataka.ts assembles Karnataka's.
//
// How TN differs from Karnataka (all confirmed by portal probe, 2026-08-09):
//  - No ongoing/completed split: one 'registered' pool (Dataset), sourced from
//    two online tables (Building + Layout) that are concatenated and parsed
//    together. Scope for this adapter is the ONLINE tables only; the per-year
//    offline archives (2017-2025) have no detail pages and shift columns year
//    to year, so they're deliberately out of scope here.
//  - Detail pages are keyed by a random id present only in the list row
//    (harvested into IndexRecord.detailRefs at parse time), and project detail
//    and promoter detail are TWO separate pages. So fetchDetail makes up to two
//    calls and returns both — no id-lookup round trip (simpler than KA's
//    ongoing projects on that front).
//  - No "under investigation" enforcement list with Karnataka's shape.
import type { FetchLog } from '../registryFetch.js';
import { fetchBuildingListHtml, fetchLayoutListHtml, fetchDetailPageHtml } from './tamilnadu/fetch.js';
import { parseTnList } from './tamilnadu/parseList.js';
import { parseTnProjectDetail, parseTnPromoter } from './tamilnadu/parseDetail.js';
import type { StateAdapter } from './types.js';

export const tamilNaduAdapter: StateAdapter = {
  code: 'TN',
  name: 'Tamil Nadu',
  datasets: ['registered'],
  hasInvestigationList: false,
  // Observed online counts 2026-08-09: Building 276, Layout 3,137 (total
  // 3,413). Floor set to ~1/3 of the combined total — parser-break protection,
  // not a tuning knob. Never lower it to make a sync pass.
  sanityFloors: { perDataset: { registered: 1_000 } },

  // TN's single pool comes from two online tables; fetch both and hand them to
  // the parser together (parseTnList reads every <tbody>). If either fails, the
  // whole list is null so the sync keeps the prior snapshot rather than
  // swapping in a half-crawled index.
  async fetchList(_dataset, log?: FetchLog): Promise<string | null> {
    const [building, layout] = await Promise.all([fetchBuildingListHtml(log), fetchLayoutListHtml(log)]);
    if (building === null || layout === null) return null;
    return `${building}\n${layout}`;
  },
  parseList(raw) {
    return parseTnList(raw);
  },

  // Project detail (public-view2) and promoter detail (public-view1) are two
  // separately-keyed pages; their URLs were harvested into detailRefs. Fetch
  // the project page for the core detail and the promoter page for the profile.
  async fetchDetail(record, log) {
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
