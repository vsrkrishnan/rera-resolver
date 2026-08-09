import type { Dataset, IndexRecord, InvestigationRecord, PromoterProfile, StateCode } from '../types.js';
import type { ParsedProjectDetails } from '../parseProjectDetails.js';
import type { FetchLog } from '../registryFetch.js';

// A DetailRef is the opaque per-state token needed to fetch one project's
// detail page. Karnataka uses the portal's internal row id (a string); other
// states may key detail by regNumber directly. Kept as a string so the
// orchestration layer never needs to know a state's detail-lookup mechanics.
export type DetailRef = string;

// Everything portal-specific for one state's RERA registry. The engine
// (syncIndex, fetchProject, fetchPromoter, resolve, storage, matcher) is
// state-agnostic and drives a StateAdapter through this interface — so adding
// a state means writing a new adapter, not touching the engine.
export interface StateAdapter {
  code: StateCode;
  name: string;

  // Which bulk list datasets this portal exposes. Karnataka: ongoing +
  // completed. All listed datasets are treated as mandatory for a sync.
  datasets: Dataset[];
  hasInvestigationList: boolean;

  // Minimum plausible parsed counts — a sync that parses fewer than these
  // treats it as a parser break (portal HTML changed) and keeps the prior
  // snapshot rather than swapping in a near-empty index.
  sanityFloors: { perDataset: Partial<Record<Dataset, number>>; investigation?: number };

  // Bulk list crawl (drives syncIndex).
  fetchList(dataset: Dataset, log?: FetchLog): Promise<string | null>;
  parseList(raw: string, dataset: Dataset): IndexRecord[];

  // Optional "under investigation" enforcement list.
  fetchInvestigationList?(log?: FetchLog): Promise<string | null>;
  parseInvestigationList?(raw: string): InvestigationRecord[];

  // Live per-project detail (drives fetchProject / fetchPromoter). Split into
  // "find the detail token for this record" + "fetch the detail page for a
  // token" so a state with a simple by-regNumber detail URL doesn't inherit
  // Karnataka's two-step ongoing-project id lookup.
  resolveDetailRef(record: IndexRecord, log?: FetchLog): Promise<DetailRef | null>;
  fetchDetail(ref: DetailRef, log?: FetchLog): Promise<string | null>;
  parseDetail(raw: string): ParsedProjectDetails;
  parsePromoter(raw: string): PromoterProfile;
}
