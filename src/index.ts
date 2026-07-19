export type {
  Dataset,
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
  MATCH_THRESHOLDS,
  TOKEN_MATCH,
  PROMOTER_HINT,
  MAX_CANDIDATES,
  MAX_WEAK_CANDIDATES,
  MAX_LLM_SHORTLIST,
  LLM_MATCH_SCORE,
  INDEX_MAX_AGE_DAYS,
} from './config.js';
export { readSnapshot, readInvestigationSnapshot, DEFAULT_DB_PATH } from './storage.js';
