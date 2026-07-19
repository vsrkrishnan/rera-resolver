# Usage guide

Everything beyond the bare `resolve()` example in the [README](../README.md): resolving names,
fetching project and promoter detail, the enforcement-list cross-check, keeping the local index
fresh in a running app, the command-line interface, and the optional Tier 3 LLM bridge.

- [Resolving a name](#resolving-a-name)
- [Fetch live project detail](#fetch-live-project-detail)
- [Promoter profile](#promoter-profile)
- [Everything a promoter has registered](#everything-a-promoter-has-registered)
- [Cross-check RERA's enforcement list](#cross-check-reras-enforcement-list)
- [Keeping data fresh](#keeping-data-fresh)
- [Command-line usage](#command-line-usage)
- [Optional: Tier 3 LLM semantic bridge](#optional-tier-3-llm-semantic-bridge)

## Resolving a name

`resolve()` always returns a `status` plus a ranked `candidates` array. The three outcomes below
are the ones worth handling explicitly.

**High confidence** — one clear winner. Even here, `candidates` is a full ranked list, and the
match is never auto-confirmed for you:

```ts
import { resolve } from 'rera-resolver';

const result = await resolve('Godraj United'); // typo — real project is "Godrej United"
// {
//   status: 'high_confidence',
//   candidates: [
//     {
//       regNumber: 'PRM/KA/RERA/1251/446/PR/...',
//       registeredName: 'GODREJ UNITED',
//       promoterName: 'GODREJ ... DEVELOPERS PRIVATE LIMITED',
//       dataset: 'ongoing',
//       matchScore: 0.94,
//       matchTier: 'token',
//       evidence: 'token overlap 2/2; includes fuzzy (typo-tolerant) token match',
//     },
//     // ...lower-scored candidates
//   ],
//   query: { name: 'Godraj United' },
// }
```

**Ambiguous** — several plausible candidates and no clear winner. This is common for a generic or
partial query; surface the list and let a human (or a hint) decide rather than picking blindly:

```ts
const result = await resolve('Lakeside Habitat');
// status: 'ambiguous' — inspect result.candidates and choose, or narrow with a hint:
const narrowed = await resolve('Lakeside Habitat', { promoterName: 'Prestige' });
// The promoter hint boosts corroborating candidates; evidence then reads e.g.
// 'token overlap 2/2; promoter hint overlap 1/1 (score 1.00)'.
```

**Unresolved** — nothing usable. Always check `unresolvedReason`:

```ts
const result = await resolve('Some Name That Does Not Exist');
// status: 'unresolved', candidates: []
if (result.status === 'unresolved') {
  if (result.unresolvedReason === 'index_not_ready') {
    // The local index has never been built — run `npx rera-resolver sync`.
  } else {
    // 'no_candidates' — the index is real and was searched; the name just wasn't found.
  }
}
```

## Fetch live project detail

```ts
import { resolve, fetch } from 'rera-resolver';

const result = await resolve('Godraj United');

// Once you have a regNumber (from resolve(), or already known), pull live
// detail data — real registry fields, not a web-search guess.
const project = await fetch(result.candidates[0].regNumber);
console.log(project.fetchState); // 'complete' | 'detail_unavailable'
console.log(project.projectStatus, project.totalProjectCostInr, project.bankName);
console.log(project.promoter?.registrationNumber); // the promoter's CIN, PAN, GSTIN, address, directors — see below
```

`npx rera-resolver fetch "<regNumber>"` prints the same enriched JSON from a terminal.

`fetch()` works for **both** ongoing and completed projects. Completed-project detail costs 1 HTTP
call; an ongoing project costs 2 (an extra lookup to find its internal detail-page id, since the
portal's ongoing-project list doesn't carry one — see `onCost`'s `httpCalls`). A failed or
unsupported lookup degrades honestly to `fetchState: 'detail_unavailable'` rather than fabricating
a field — and even on `'complete'`, older ("legacy"-template) completed projects may have fewer
fields populated than newer ones, since the portal itself has changed what it renders over the
years; a field that isn't there is `undefined`, never guessed.

### Example output

Real, live output from `fetch('PRM/KA/RERA/1251/308/PR/170726/008819')` against an ongoing
project — every field below came from the actual portal, not a mock:

```json
{
  "regNumber": "PRM/KA/RERA/1251/308/PR/170726/008819",
  "registeredName": "THE ROOTS BY ELEGANCE INFRA",
  "promoterName": "PIONIER DEVELOPMENTS PRIVATE LIMITED",
  "dataset": "ongoing",
  "fetchedAt": "2026-07-19T14:34:37.910Z",
  "projectStatus": "Ongoing",
  "projectStartDate": "01-06-2026",
  "projectEndDate": "31-07-2027",
  "complaintsOnPromoter": 5,
  "complaintsOnProject": 0,
  "projectType": "Plotted Development",
  "projectDescription": "DEVELOPMENT OF BDA APPROVED RESIDENTIAL PROJECT",
  "extentDevelopedPct": "0 %",
  "projectAddress": "SURVEY NO. 98, CHIKKANAGAMANGALA VILLAGE , SARJAPURA HOBLI, , Anekal , Bengaluru Urban, Karnataka - 560099",
  "pinCode": "560099",
  "latitude": "12.856716251534834",
  "longitude": "77.6925632785782",
  "approvingAuthority": "BDA - Bangalore Development Authority",
  "approvedPlanNumber": "BDA/TPM/PRL-337/25-26/604/2026-27 (E-187413)",
  "planApprovalDate": "20-05-2026",
  "totalProjectCostInr": "368684262",
  "totalConstructionCostInr": "76811847",
  "bankName": "STATE BANK OF INDIA",
  "bankBranch": "sector 1, HSR LAYOUT",
  "ifscCode": "SBIN0070802",
  "numberOfPlotsOrUnits": "46",
  "promoter": {
    "typeOfFirm": "Company",
    "registrationNumber": "U70100KA2022PTC163677",
    "pan": "AANCP0678D",
    "gstin": "AANCP0678D",
    "mainObjectives": "DEVELOPMENT OF BDA APPROVED RESIDENTIAL LAYOUT",
    "address": "#48, I STAR BUILDING, 100 FT ROAD,,KORAMANGALA, BANGALORE ,Bengaluru South ,Bengaluru Urban-560034",
    "district": "Bengaluru Urban",
    "taluk": "Bengaluru South",
    "pinCode": "560034",
    "authorizedSignatory": "KAVITHA RAMREDDY",
    "ceoOrMd": "KAVITHA RAMREDDY",
    "designation": "DIRECTOR",
    "din": "07687753",
    "numberOfDirectors": "2"
  },
  "fetchState": "complete"
}
```

The matching `onCost` record confirms the two-call chain this ongoing project needed (id lookup +
detail fetch):

```json
{ "operation": "fetch", "httpCalls": 2, "llmCalls": 0, "latencyMs": 2267, "at": "2026-07-19T14:34:40.160Z" }
```

Note the doubled commas and irregular spacing in `projectAddress` and `promoter.address` (e.g.
`"100 FT ROAD,,KORAMANGALA"`, `"BANGALORE ,Bengaluru South"`) — this isn't corrupted parsing, and
it's deliberately not "cleaned up." Two things are going on: `"ROAD,,KORAMANGALA"` is a double
comma the portal's own markup genuinely contains in that one text node; the extra space before
the later commas comes from this library joining the address's multi-line continuation segments
(see [parseProjectDetails.ts](../src/parseProjectDetails.ts)'s comment on multiline fields) with a
plain space rather than trying to guess correct punctuation. The parser reports what the source
says rather than reformatting it.

### Completed projects cost one call, not two

A **completed** project carries its internal detail-page id in the index already, so `fetch()`
needs a single HTTP call — no id lookup first:

```ts
const completed = await fetch('PRM/KA/RERA/1250/303/PR/171008/001420', {
  onCost: (record) => console.log(record),
});
// onCost: { operation: 'fetch', httpCalls: 1, llmCalls: 0, latencyMs: ~900, at: '...' }
```

Completed projects registered years ago may use an older ("legacy") page template that simply
doesn't render some fields — GSTIN, for instance, is genuinely absent on some. Those come back
`undefined`, never guessed.

### When detail can't be fetched

If the detail page can't be fetched or parsed, `fetch()` degrades honestly — you keep the identity
you already had, with `fetchState: 'detail_unavailable'` instead of fabricated fields:

```ts
const project = await fetch('PRM/KA/RERA/1251/308/PR/170726/008819');
if (project.fetchState === 'detail_unavailable') {
  // regNumber, registeredName, promoterName are still populated from the index;
  // the volatile detail fields (status, cost, promoter profile) are simply absent.
  console.log(project.regNumber, project.registeredName);
}
```

## Promoter profile

```ts
import { fetchPromoter } from 'rera-resolver';

// The portal has no standalone promoter-profile endpoint — a promoter's
// profile only exists as part of one of THEIR projects' detail pages, so
// this fetches one representative project (preferring a completed one, to
// keep it to a single HTTP call) and lifts the promoter block out of it.
const promoter = await fetchPromoter('Godrej Home Constructions Private Limited');
console.log(promoter.profile?.registrationNumber); // CIN
console.log(promoter.profile?.pan, promoter.profile?.gstin, promoter.profile?.address);
console.log(promoter.projects);      // every project of theirs, from the local index — always present, zero-cost
console.log(promoter.fetchState);    // 'complete' | 'profile_unavailable'
```

`npx rera-resolver promoter "<name>"` prints the same JSON from a terminal.

## Everything a promoter has registered

```ts
import { projectsByPromoter } from 'rera-resolver';

// Zero-cost local lookup — no network call.
const portfolio = await projectsByPromoter('Prestige Estates Projects');
```

## Cross-check RERA's enforcement list

```ts
import { checkUnderInvestigation } from 'rera-resolver';

// Separate, explicitly-caveated check against RERA's own "Projects Under
// Investigation" list — useful when resolve() comes up empty or weak.
const flagged = await checkUnderInvestigation('Sobha City Casa Serenita');
if (flagged.matches.length > 0) {
  console.log(flagged.warning);  // staleness/scope caveat — always present
  console.log(flagged.dataAsOf); // how current the WHOLE list is, e.g. "2021-10-22"
}
```

A hit here means "RERA flagged this at some point" — this list has gone stale for years at a
stretch, so absence proves nothing either way.

## Keeping data fresh

The local index auto-refreshes in the background whenever it's more than `INDEX_MAX_AGE_DAYS` (7)
old — a call to `ensureIndex()` (used internally by postinstall) checks this without ever blocking
on a live crawl. To force a refresh yourself, or to run it on a schedule (cron, a GitHub Action,
etc.):

```bash
npx rera-resolver sync    # rebuild the local index now
npx rera-resolver status  # show index path, freshness, and record counts
```

```ts
import { ensureIndex } from 'rera-resolver';

// Call once at app startup for a self-healing, zero-config experience:
// builds the index if missing, refreshes it in the background if stale,
// and returns immediately if it's already fresh.
await ensureIndex();
```

## Command-line usage

Installing the package puts a `rera-resolver` binary on your path — run it with `npx` (or directly
if installed globally). Every command prints plain text or JSON to stdout, so it composes with
tools like `jq`.

```bash
# Rebuild the local index from the live RERA portal (a real network call).
npx rera-resolver sync

# Show where the index lives, how fresh it is, and how many records it holds.
npx rera-resolver status
# db path:            <your OS cache dir>/rera-resolver/index.db
# fetched at:         2026-07-19T14:34:37.910Z
# ongoing projects:   9712
# completed projects: 3418
# total records:      13040
# investigation rows: 1050 (as of 2021-10-22)

# Resolve a messy name and print the ranked ResolveResult as JSON.
# Add --promoter to pass a developer hint.
npx rera-resolver resolve "Godraj United" --promoter "Godrej"

# Fetch live project detail for a registration number.
npx rera-resolver fetch "PRM/KA/RERA/1251/308/PR/170726/008819"

# Fetch a promoter's profile plus their full project list.
npx rera-resolver promoter "Prestige Estates Projects"
```

`resolve`, `fetch`, and `promoter` print exactly the same objects the library functions return, so
you can pipe them straight into `jq`, e.g. `npx rera-resolver resolve "Godraj United" | jq
'.candidates[0].regNumber'`.

## Optional: Tier 3 LLM semantic bridge

Tiers 0–2 (exact match, then token-set fuzzy/rarity-weighted scoring) solve most cases on their
own. For the remaining case — a marketing name and legal name that share **no tokens at all** —
`resolve()` accepts an `llmClient` you provide and gives it a fallback shot, only when Tiers 0–2
didn't already reach `high_confidence`. The library never bundles an LLM vendor, key, or SDK —
`llmClient` is a plain interface (see [api.md](api.md)) you implement against whatever model you
already use. Below is a complete, working implementation against the Claude API.

### Implementing `llmClient` with Claude

```bash
npm install @anthropic-ai/sdk zod
```

```ts
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { resolve, type LlmClient } from 'rera-resolver';

// Reads ANTHROPIC_API_KEY from the environment.
const anthropic = new Anthropic();

// Mirrors LlmMatchResponse['matches'] — this is what resolve() expects back.
const MatchSchema = z.object({
  matches: z.array(
    z.object({
      regNumber: z.string(),
      reasoning: z.string(),
    }),
  ),
});

const llmClient: LlmClient = {
  async matchShortlist({ query, hints, shortlist }) {
    const response = await anthropic.messages.parse({
      model: 'claude-opus-4-8',
      max_tokens: 1024,
      system:
        "You match a messy, human-typed Karnataka real-estate project name to the correct " +
        "RERA registration. The shortlist is grounding context, not a hard restriction — if " +
        "you're confident none of them are right but you recognize the real project from your " +
        "own knowledge (e.g. the marketing name of a well-known development), name that " +
        "regNumber instead, even though it isn't in the shortlist. Every regNumber you return " +
        "is checked against the real registry before it's used anywhere, so an invented one " +
        "is simply discarded — you do not need to hedge or hallucinate-avoid; just give your " +
        "best real answer. Return an empty matches array if you have no real answer.",
      messages: [
        {
          role: 'user',
          content: JSON.stringify({ query, promoterHint: hints?.promoterName, shortlist }),
        },
      ],
      output_config: { format: zodOutputFormat(MatchSchema) },
    });

    return {
      matches: response.parsed_output?.matches ?? [],
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      // costInr is left unset — the SDK reports USD token usage, not INR cost;
      // compute it yourself from your own Anthropic pricing tier if you need it.
    };
  },
};

const withLlm = await resolve('Prestige Lakeside Habitat', undefined, {
  llmClient,
  onCost: (record) => console.log(record), // llmCalls, tokens, cost — only when Tier 3 actually ran
});
```

`shortlist` is the grounding context `resolve()` builds internally from Tier 2's weak candidates
plus any real projects matching a `promoterName` hint — you don't build it yourself, `resolve()`
passes it into `matchShortlist` on every Tier 3 call. `output_config.format` (structured outputs)
guarantees `response.parsed_output` matches `MatchSchema` exactly, so there's no free-text parsing
to get wrong.

Omit `llmClient` entirely and `resolve()` behaves exactly as if Tier 3 didn't exist — zero LLM
cost, opt-in only. Every regNumber the LLM returns is validated against the real local index
before it reaches you; anything invented is silently discarded, so this guardrail applies
automatically no matter what calls `resolve()` — script, human, or LLM agent.

See [api.md](api.md) for the full `LlmClient` interface.
