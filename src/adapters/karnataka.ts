// Karnataka is the reference StateAdapter implementation. It assembles the
// Karnataka-specific primitives that already exist and are unit-tested in
// place — the portal fetch layer (registryFetch.ts), the bulk-list parsers
// (parse.ts), and the detail-page parsers (parseProjectDetails.ts) — behind
// the state-agnostic StateAdapter interface. No parsing/fetch logic lives
// here; this is pure wiring, so Karnataka's existing behavior and tests are
// untouched.
import {
  fetchOngoingHtml,
  fetchCompletedHtml,
  fetchUnregisteredProjectsHtml,
  fetchOngoingProjectId,
  fetchProjectDetailsHtml,
} from '../registryFetch.js';
import { parseOngoing, parseCompleted, parseInvestigationList } from '../parse.js';
import { parseProjectDetails, parsePromoterProfile } from '../parseProjectDetails.js';
import type { StateAdapter } from './types.js';

export const karnatakaAdapter: StateAdapter = {
  code: 'KA',
  name: 'Karnataka',
  // Two crawl sources; each parser stamps its records' `dataset` label
  // ('ongoing' / 'completed'). Floors are the former MIN_PLAUSIBLE_* constants,
  // calibrated to Karnataka's real order of magnitude (ongoing ~9.7k,
  // completed ~3.4k) — parser-break protection, not a tuning knob.
  sources: [
    { id: 'ongoing', sanityFloor: 3_000, fetch: (log) => fetchOngoingHtml(log), parse: (raw) => parseOngoing(raw) },
    { id: 'completed', sanityFloor: 1_000, fetch: (log) => fetchCompletedHtml(log), parse: (raw) => parseCompleted(raw) },
  ],

  hasInvestigationList: true,
  investigationFloor: 500, // investigation list ~1,050

  fetchInvestigationList(log) {
    return fetchUnregisteredProjectsHtml(log);
  },
  parseInvestigationList(raw) {
    return parseInvestigationList(raw);
  },

  // One detail page yields both the project detail and the promoter profile.
  // Completed rows carry the portal row id straight from the list dump; ongoing
  // rows have no id in the dump and need the extra projectViewDetails lookup.
  async fetchDetail(record, log) {
    const rowId =
      record.dataset === 'completed' && record.completedRowId
        ? record.completedRowId
        : record.dataset === 'ongoing'
          ? await fetchOngoingProjectId(record.regNumber, log)
          : null;
    if (!rowId) return null;

    const html = await fetchProjectDetailsHtml(rowId, log);
    if (!html) return null;

    return { detail: parseProjectDetails(html), promoter: parsePromoterProfile(html) };
  },
};
