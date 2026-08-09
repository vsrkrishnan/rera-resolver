import type { Dataset, IndexRecord, InvestigationRecord, PromoterProfile, StateCode } from '../types.js';
import type { ParsedProjectDetails } from '../parseProjectDetails.js';
import type { FetchLog } from '../registryFetch.js';

// The parsed result of a project's live detail lookup. `promoter` is omitted
// when the portal exposes no promoter profile for that project. The adapter
// owns ALL detail mechanics behind fetchDetail() — how many pages, how they're
// keyed, the parse — so the engine (fetchProject) never learns a state's
// portal shape. This is why Karnataka (one detail page yielding both) and
// Tamil Nadu (separate project-detail and promoter-detail pages, each keyed by
// its own id from the list row) both satisfy the same interface.
export interface FetchedDetail {
  detail: ParsedProjectDetails;
  promoter?: PromoterProfile;
}

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

  // Live per-project detail (drives fetchProject / fetchPromoter). Given an
  // index record, fetch and parse its full detail, or return null when no
  // detail is obtainable (portal error, or — legitimately — a record whose
  // portal exposes no detail page). The adapter encapsulates the entire
  // mechanism: Karnataka resolves a row id (a second call for ongoing rows)
  // then parses one page into both detail and promoter; Tamil Nadu fetches two
  // separately-keyed pages. Thread `log` through every HTTP call it makes.
  fetchDetail(record: IndexRecord, log?: FetchLog): Promise<FetchedDetail | null>;
}
