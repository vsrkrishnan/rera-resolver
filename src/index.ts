export type {
  Dataset,
  StateCode,
  IndexRecord,
  IndexSnapshot,
  ResolveHints,
  MatchTier,
  Candidate,
  ResolveStatus,
  ResolveResult,
  FetchState,
  ProjectRecord,
  PromoterProfile,
  PromoterFetchState,
  PromoterRecord,
  SyncResult,
  OperationCostRecord,
  InvestigationStatus,
  InvestigationRecord,
  InvestigationMatch,
  InvestigationCheckResult,
  LlmShortlistEntry,
  LlmMatchRequest,
  LlmMatch,
  LlmMatchResponse,
  LlmClient,
} from './types.js';

export { resolve, projectsByPromoter } from './resolve.js';
export { fetchProject as fetch, UnknownRegNumberError } from './fetchProject.js';
export { fetchPromoter } from './fetchPromoter.js';
export { checkUnderInvestigation } from './checkUnderInvestigation.js';
export { syncIndex } from './syncIndex.js';
export { ensureIndex } from './ensureIndex.js';
export type { EnsureIndexOptions, EnsureIndexStatus, EnsureIndexResult } from './ensureIndex.js';
export {
  DEFAULT_STATE,
  MATCH_THRESHOLDS,
  TOKEN_MATCH,
  PROMOTER_HINT,
  MAX_CANDIDATES,
  MAX_WEAK_CANDIDATES,
  MAX_LLM_SHORTLIST,
  LLM_MATCH_SCORE,
  INDEX_MAX_AGE_DAYS,
} from './config.js';
export { readSnapshot, readInvestigationSnapshot, DEFAULT_DB_PATH, resolveDbPathForState } from './storage.js';
// Multi-state adapter surface: the supported states and how to look one up.
export { SUPPORTED_STATES, getAdapter } from './adapters/registry.js';
export type { StateAdapter, FetchedDetail } from './adapters/types.js';
