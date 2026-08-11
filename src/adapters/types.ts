import type { IndexRecord, InvestigationRecord, PromoterProfile, StateCode } from '../types.js';
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

// One bulk-list sub-source a state's portal exposes — a single logical pool
// the sync crawls, parses, and floor-checks on its own. This is deliberately
// decoupled from the record-level `Dataset` label: `Dataset` answers "what KIND
// of record is this" (a small, stable, consumer-facing vocabulary —
// ongoing/completed/registered), whereas a CrawlSource answers "which sub-list
// did we crawl it FROM" (state-internal plumbing). A state can carve its crawl
// into arbitrary sources — Karnataka has two (ongoing, completed); Tamil Nadu
// has one online pool plus a per-year offline archive pool — without the shared
// `Dataset` union ever having to grow a new value for each state's local
// partitioning scheme. The engine iterates sources opaquely; it never branches
// on a source's `id`.
export interface CrawlSource {
  // Opaque, adapter-defined identifier (e.g. 'ongoing', 'completed', 'online',
  // 'offline'). Used only for logging and as this source's own key — NOT a
  // consumer-facing label. The parser is what stamps each record's `dataset`.
  id: string;

  // Minimum plausible parsed count for THIS source. A parse below it is treated
  // as a parser break (portal HTML changed) and fails the whole sync, keeping
  // the prior snapshot rather than swapping in a near-empty index. Per-source
  // so one pool's break can never be masked by another pool's volume — parser-
  // break protection, not a tuning knob. Never lower it to make a sync pass.
  sanityFloor: number;

  // Fetch this source's raw payload. May hit one URL or many internally (Tamil
  // Nadu's offline source fans out across ~19 year-pages) — that fan-out is the
  // adapter's business, not the engine's. Return null on any failure; a null
  // fails the whole sync.
  fetch(log?: FetchLog): Promise<string | null>;

  // Parse the raw payload into index records, stamping each with its semantic
  // `dataset` label.
  parse(raw: string): IndexRecord[];
}

// Everything portal-specific for one state's RERA registry. The engine
// (syncIndex, fetchProject, fetchPromoter, resolve, storage, matcher) is
// state-agnostic and drives a StateAdapter through this interface — so adding
// a state means writing a new adapter, not touching the engine.
export interface StateAdapter {
  code: StateCode;
  name: string;

  // The bulk-list pools this portal exposes, each self-describing its own
  // fetch, parse, and sanity floor. All sources are mandatory for a sync. See
  // CrawlSource for why this is decoupled from the `Dataset` record label.
  sources: CrawlSource[];

  hasInvestigationList: boolean;
  // Minimum plausible parsed count for the investigation list (parser-break
  // protection, same contract as CrawlSource.sanityFloor).
  investigationFloor?: number;

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
