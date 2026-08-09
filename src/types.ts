// Which bulk list a record came from. Karnataka splits its registry into
// 'ongoing' and 'completed' dumps. Some states don't split that way — Tamil
// Nadu, for instance, exposes one registered-projects pool with no
// ongoing/completed distinction (a free-text status field whose meaning
// differs by category, not a clean split) — so 'registered' is the neutral
// value for "a registered project, not classified ongoing vs completed". It
// carries no ongoing/completed claim; consumers must not infer completion
// state from it. dedupeRecords' ongoing<completed preference simply doesn't
// apply to it.
export type Dataset = 'ongoing' | 'completed' | 'registered';

// The Indian state whose RERA registry a record belongs to. Each state runs
// its own portal; a StateAdapter (see src/adapters) encapsulates one state's
// portal. Karnataka is the reference implementation.
export type StateCode = 'KA' | 'TN' | 'MH';

export interface IndexRecord {
  regNumber: string; // e.g. "PRM/KA/RERA/1251/446/PR/220422/004789"
  registeredName: string; // official project name as in the registry
  promoterName: string; // promoter/developer legal name as in the registry
  dataset: Dataset; // which dump this row came from (see dedup rule in storage.ts)
  // Which state's registry this row came from. Optional on freshly-parsed
  // records (a state's parser is inherently single-state, so it doesn't stamp
  // this); populated by readSnapshot from the DB's `state` meta key, so every
  // record on a real read path (resolve/fetch/promoter) carries it.
  state?: StateCode;
  // Confirmed present in the completed-projects dump (Phase 1.0 task 4); absent
  // for ongoing rows, which are JS-array seed data with no equivalent columns.
  projectType?: string;
  district?: string;
  taluk?: string;
  proposedCompletionDate?: string;
  appliedForCompletionDate?: string;
  // Internal portal row id, harvested from the completed dump's "VIEW PROJECT
  // DETAILS" button (`<a id="...">`). Only present for completed rows — the
  // ongoing dump exposes no equivalent id anywhere in its markup (Phase 1.0
  // task 1). Required to call the projectDetails endpoint in fetch().
  completedRowId?: string;
}

export interface IndexSnapshot {
  fetchedAt: string; // ISO-8601 timestamp of the sync that produced this
  ongoingCount: number; // row count from viewAllProjects
  completedCount: number; // row count from viewAllCompletedProjects
  records: IndexRecord[]; // deduplicated across the two datasets by regNumber
  state?: StateCode; // which state this snapshot belongs to (defaults to KA if absent)
}

export interface ResolveHints {
  promoterName?: string; // if the caller knows the developer, narrows matching
  state?: StateCode; // optional: which state's registry to search (defaults to KA)
  // locality hint is intentionally NOT part of this interface yet: Phase 1.0
  // did not confirm a locality field on ONGOING rows (only completed rows have
  // district/taluk). Add back once the matcher can use it for both datasets.
}

export type MatchTier = 'exact' | 'token' | 'llm_semantic';

export interface Candidate {
  regNumber: string;
  registeredName: string;
  promoterName: string;
  dataset: Dataset;
  state?: StateCode; // which state's registry this candidate came from (echoed from the matched record)
  matchScore: number; // 0.0-1.0, comparable across candidates in one result
  matchTier: MatchTier; // which tier produced this candidate
  evidence: string; // human-readable reason, e.g. "token overlap 4/5; word-order variant of input"
}

export type ResolveStatus = 'high_confidence' | 'ambiguous' | 'unresolved';

export interface ResolveResult {
  status: ResolveStatus;
  candidates: Candidate[]; // ALWAYS ranked desc by matchScore; may be empty (unresolved)
  // 'index_not_ready' means the local cache has never been built (no synced
  // data at all) — distinct from 'no_candidates', which means a real index
  // was searched and genuinely had no match. See ensureIndex().
  unresolvedReason?: 'no_candidates' | 'only_weak_candidates' | 'index_not_ready' | null;
  query: { name: string; hints?: ResolveHints };
}

export type FetchState = 'complete' | 'detail_unavailable';

// The portal renders promoter/company profile data as part of a PROJECT's
// own detail page — there is no standalone promoter-profile endpoint — so
// this shape is populated by parsing that same page (see
// parseProjectDetails.ts's parsePromoterProfile). Two live-confirmed
// template generations exist (a newer one, seen on ongoing projects, and an
// older "legacy" one on projects registered years ago) with different field
// coverage; any field a given project's page doesn't expose is correctly
// omitted here, not faked.
export interface PromoterProfile {
  typeOfFirm?: string;
  registrationNumber?: string; // CIN (company registration number)
  pan?: string;
  gstin?: string;
  mainObjectives?: string;
  address?: string;
  district?: string;
  taluk?: string;
  pinCode?: string;
  authorizedSignatory?: string;
  ceoOrMd?: string;
  designation?: string;
  din?: string;
  numberOfDirectors?: string;
}

export interface ProjectRecord {
  regNumber: string;
  registeredName: string;
  promoterName: string;
  dataset: Dataset;
  state?: StateCode; // which state's registry this project came from (echoed from the index record)
  // Populated only when the certificate/projectDetails call succeeds; omitted
  // (not set to null/empty) when unconfirmed, per the honesty contract (spec
  // §7.2 / §5.3's "omit, don't fake" rule).
  projectStatus?: string;
  projectStartDate?: string;
  projectEndDate?: string;
  complaintsOnPromoter?: number;
  complaintsOnProject?: number;
  projectType?: string;
  projectDescription?: string;
  extentDevelopedPct?: string;
  projectAddress?: string;
  pinCode?: string;
  latitude?: string;
  longitude?: string;
  approvingAuthority?: string;
  approvedPlanNumber?: string;
  planApprovalDate?: string;
  totalProjectCostInr?: string;
  totalConstructionCostInr?: string;
  bankName?: string;
  bankBranch?: string;
  ifscCode?: string;
  numberOfPlotsOrUnits?: string;
  promoter?: PromoterProfile;
  fetchState: FetchState;
  fetchedAt: string; // ISO-8601
}

export type PromoterFetchState = 'complete' | 'profile_unavailable';

// fetchPromoter()'s return: the promoter's project list always comes from
// the local index (cheap, always available); `profile` is only populated
// when a representative project's detail page could be fetched and parsed
// — omitted (not faked) otherwise, same "don't fake" discipline as
// ProjectRecord.
export interface PromoterRecord {
  promoterName: string;
  profile?: PromoterProfile;
  projects: Candidate[];
  fetchState: PromoterFetchState;
  fetchedAt: string; // ISO-8601
}

export interface SyncResult {
  fetchedAt: string;
  ongoingCount: number;
  completedCount: number;
  investigationCount: number;
  added: number; // vs previous snapshot
  removed: number; // vs previous snapshot
  ok: boolean;
}

// From rera.karnataka.gov.in/unregProjectList ("Projects Under
// Investigation") — RERA's own enforcement/notice-response tracking list,
// NOT a comprehensive "every unregistered project" registry. Investigated
// 2026-07-18: 1,050 rows, published dates 2018-01-05 to 2021-10-22 with
// nothing newer — the list is stale by several years as of any recent sync,
// despite an (inert, not live) in-page note claiming weekly updates. No
// regNumber exists for these rows by definition (they were never
// registered), so this is intentionally a separate record shape from
// IndexRecord, not merged into it.
export type InvestigationStatus = 'no_reply' | 'reply_not_satisfactory' | 'not_satisfactory' | 'approved' | 'unknown';

export interface InvestigationRecord {
  projectName: string;
  promoterName: string;
  status: InvestigationStatus;
  rawStatus: string; // verbatim text from the portal — normalization to InvestigationStatus is best-effort, not exhaustive
  corporateAddress: string;
  publishedDate: string; // verbatim DD-MM-YYYY as published by RERA
}

export interface InvestigationMatch extends InvestigationRecord {
  matchScore: number;
  evidence: string;
}

export interface InvestigationCheckResult {
  matches: InvestigationMatch[]; // ALWAYS ranked desc by matchScore; may be empty
  // Latest publishedDate seen anywhere in the whole dataset at last sync —
  // i.e. how stale this entire list is, not just this query's matches.
  // Consumers MUST surface this alongside any match; a hit here says
  // "RERA flagged this at some point up to dataAsOf," never "as of today."
  dataAsOf: string | null;
  warning: string;
  query: { name: string; hints?: ResolveHints };
}

// Tier 3 (LLM semantic bridge) BYO-LLM contract. The library never bundles
// a vendor client or key — a consumer injects an implementation of
// LlmClient via ResolveOptions.llmClient.
export interface LlmShortlistEntry {
  regNumber: string;
  registeredName: string;
  promoterName: string;
}

export interface LlmMatchRequest {
  query: string;
  hints?: ResolveHints;
  // Grounding context only, not a hard restriction — the LLM may name a
  // regNumber outside this list from its own world knowledge (the whole
  // point of this tier), but every returned regNumber is validated against
  // the full local index before it ever reaches the caller.
  shortlist: LlmShortlistEntry[];
}

export interface LlmMatch {
  regNumber: string;
  reasoning: string;
}

export interface LlmMatchResponse {
  matches: LlmMatch[]; // ranked, best first; may be empty
  inputTokens?: number;
  outputTokens?: number;
  costInr?: number;
}

export interface LlmClient {
  matchShortlist(request: LlmMatchRequest): Promise<LlmMatchResponse>;
}

export interface OperationCostRecord {
  operation: 'syncIndex' | 'resolve' | 'fetch' | 'projectsByPromoter' | 'fetchPromoter';
  httpCalls: number;
  llmCalls: number;
  llmInputTokens?: number;
  llmOutputTokens?: number;
  llmCostInr?: number;
  latencyMs: number;
  at: string; // ISO-8601
}
