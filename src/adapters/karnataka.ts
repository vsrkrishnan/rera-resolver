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
  datasets: ['ongoing', 'completed'],
  hasInvestigationList: true,
  // Formerly the MIN_PLAUSIBLE_* constants inline in syncIndex.ts — calibrated
  // to Karnataka's real order of magnitude (ongoing ~9.7k, completed ~3.4k,
  // investigation ~1,050).
  sanityFloors: { perDataset: { ongoing: 3_000, completed: 1_000 }, investigation: 500 },

  fetchList(dataset, log) {
    return dataset === 'ongoing' ? fetchOngoingHtml(log) : fetchCompletedHtml(log);
  },
  parseList(raw, dataset) {
    return dataset === 'ongoing' ? parseOngoing(raw) : parseCompleted(raw);
  },

  fetchInvestigationList(log) {
    return fetchUnregisteredProjectsHtml(log);
  },
  parseInvestigationList(raw) {
    return parseInvestigationList(raw);
  },

  // Completed rows carry the portal row id straight from the list dump; ongoing
  // rows have no id in the dump and need the extra projectViewDetails lookup.
  async resolveDetailRef(record, log) {
    if (record.dataset === 'completed' && record.completedRowId) return record.completedRowId;
    if (record.dataset === 'ongoing') return await fetchOngoingProjectId(record.regNumber, log);
    return null;
  },
  fetchDetail(ref, log) {
    return fetchProjectDetailsHtml(ref, log);
  },
  parseDetail(raw) {
    return parseProjectDetails(raw);
  },
  parsePromoter(raw) {
    return parsePromoterProfile(raw);
  },
};
