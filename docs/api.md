# API reference

```ts
function resolve(
  name: string,
  hints?: { promoterName?: string },
  options?: {
    dbPath?: string;
    llmClient?: LlmClient;   // Tier 3, opt-in — omit for Tiers 0-2 only, zero LLM cost
    onCost?: (record: OperationCostRecord) => void; // fires once per call; llmCalls: 0 unless Tier 3 ran
  },
): Promise<ResolveResult>;

function projectsByPromoter(
  promoterName: string,
  options?: { dbPath?: string },
): Promise<Candidate[]>;

function fetch(
  regNumber: string,
  // onCost's httpCalls is 1 for a completed project, 2 for an ongoing one
  // (extra id-lookup call — see guide.md's "Fetch live project detail").
  options?: { dbPath?: string; onCost?: (record: OperationCostRecord) => void },
): Promise<ProjectRecord>;

function fetchPromoter(
  promoterName: string,
  options?: { dbPath?: string; onCost?: (record: OperationCostRecord) => void },
): Promise<PromoterRecord>;

function checkUnderInvestigation(
  name: string,
  hints?: { promoterName?: string },
  options?: { dbPath?: string },
): Promise<InvestigationCheckResult>;

function ensureIndex(options?: {
  dbPath?: string;
  maxAgeDays?: number;         // default: INDEX_MAX_AGE_DAYS (7)
  onLog?: (line: string) => void;
  onCost?: (record: OperationCostRecord) => void;
}): Promise<{ status: 'ready' | 'built' | 'refreshing' | 'unavailable'; fetchedAt?: string }>;

function syncIndex(options?: {
  dbPath?: string;
  onLog?: (line: string) => void;
  onCost?: (record: OperationCostRecord) => void;
}): Promise<SyncResult>;

// BYO-LLM contract for Tier 3. The library never bundles a vendor client or
// key — implement this against whatever LLM you already use.
interface LlmClient {
  matchShortlist(request: {
    query: string;
    hints?: { promoterName?: string };
    shortlist: { regNumber: string; registeredName: string; promoterName: string }[]; // grounding context, not a hard restriction
  }): Promise<{
    matches: { regNumber: string; reasoning: string }[]; // ranked, best first; may name a regNumber outside the shortlist
    inputTokens?: number;
    outputTokens?: number;
    costInr?: number;
  }>;
}
```

Full types (`Candidate`, `ResolveResult`, `ProjectRecord`, `PromoterProfile`, `PromoterRecord`,
`InvestigationCheckResult`, `LlmClient`, etc.) are exported from the package root — see
[`src/types.ts`](../src/types.ts) for the complete, documented shapes. Matcher thresholds
(`MATCH_THRESHOLDS`, `TOKEN_MATCH`, `LLM_MATCH_SCORE`, `MAX_LLM_SHORTLIST`, `INDEX_MAX_AGE_DAYS`)
are also exported.

Every `dbPath` defaults to a per-user cache directory; override it (or the postinstall/CLI
default) with the `RERA_RESOLVER_DB_PATH` env var.
