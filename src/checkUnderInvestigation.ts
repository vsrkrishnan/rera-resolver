import type { InvestigationCheckResult, InvestigationMatch, ResolveHints } from './types.js';
import { readInvestigationSnapshot, DEFAULT_DB_PATH } from './storage.js';
import { normalizeForCompare, tokenize, tokenSetScore } from './textSimilarity.js';
import { MATCH_THRESHOLDS, MAX_CANDIDATES } from './config.js';

export interface CheckUnderInvestigationOptions {
  dbPath?: string;
}

const STALENESS_WARNING =
  'This list is RERA\'s own "Projects Under Investigation" enforcement/notice-response tracker, not a comprehensive list of every unregistered project — absence from it does NOT mean a project is legitimate. It has also gone stale for years at a stretch historically (no publish dates newer than 2021-10-22 as of a 2026-07-18 check), so a match only confirms RERA flagged this at some point up to dataAsOf, never "as of today."';

// Deliberately separate from resolve() (spec §7.3's boundary: this library
// cannot classify an unresolved project as exempt vs. unregistered — see
// project notes from 2026-07-18's investigation). This function narrows
// that gap slightly but does not close it: a hit here is real, sourced
// evidence that RERA formally investigated a name-matching project at some
// point, not proof a project is currently a scam, and absence is not proof
// of legitimacy either. Never merged into resolve()'s candidates/confidence
// scoring — kept as its own explicit call so a consumer can't stumble into
// treating "not found in the registered index" plus "found here" as more
// definitive than it actually is.
export async function checkUnderInvestigation(
  name: string,
  hints?: ResolveHints,
  options: CheckUnderInvestigationOptions = {},
): Promise<InvestigationCheckResult> {
  const dbPath = options.dbPath ?? DEFAULT_DB_PATH;
  const snapshot = readInvestigationSnapshot(dbPath);
  const query = { name, hints };

  if (!snapshot || snapshot.records.length === 0) {
    return { matches: [], dataAsOf: null, warning: STALENESS_WARNING, query };
  }

  const dataAsOf = latestPublishedDateIso(snapshot.records.map((r) => r.publishedDate));

  const normalizedQuery = normalizeForCompare(name);
  const queryTokens = tokenize(name);

  const scored: InvestigationMatch[] = snapshot.records.map((record) => {
    const normalizedCandidate = normalizeForCompare(record.projectName);
    if (normalizedQuery && normalizedQuery === normalizedCandidate) {
      return { ...record, matchScore: 1.0, evidence: 'exact normalized match' };
    }
    const candidateTokens = tokenize(record.projectName);
    const match = tokenSetScore(queryTokens, candidateTokens);
    return {
      ...record,
      matchScore: match.score,
      evidence: `token overlap ${match.matchedPairs.length}/${queryTokens.length || 1}`,
    };
  });

  const matches = scored
    .filter((m) => m.matchScore >= MATCH_THRESHOLDS.floor)
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, MAX_CANDIDATES);

  return { matches, dataAsOf, warning: STALENESS_WARNING, query };
}

// publishedDate is stored verbatim as DD-MM-YYYY (as RERA publishes it) —
// converted to ISO only for this one summary field, so consumers get a
// sortable/comparable "how stale is this list" signal without this library
// silently reformatting the per-record dates it displays.
function latestPublishedDateIso(dates: string[]): string | null {
  let latest: Date | null = null;
  for (const d of dates) {
    const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(d.trim());
    if (!match) continue;
    const [, dd, mm, yyyy] = match;
    const parsed = new Date(`${yyyy}-${mm}-${dd}T00:00:00Z`);
    if (!Number.isNaN(parsed.getTime()) && (!latest || parsed > latest)) latest = parsed;
  }
  return latest ? latest.toISOString().substring(0, 10) : null;
}
