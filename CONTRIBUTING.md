# Contributing

## Workflow

**External contributors don't push directly to `main`.** To contribute:

1. Create a branch off `main` for your change.
2. Open a pull request from that branch.
3. The maintainer reviews and merges it. PRs are not self-merged.

(Repo owners may push directly to `main` for small, low-risk changes at their own discretion —
this exception doesn't extend to anyone else.)

Before opening a PR, run the checklist below yourself — there's no CI bot to catch it for you:

```bash
npm run build
npm test
```

## Local setup

```bash
npm install
npm test              # matcher logic, real-markup parsing fixtures, resolve/fetch integration, Tier 3 (llmBridge)
npm run build          # tsc -> dist/
npm run sync           # populate/refresh the repo-local SQLite cache from the live portal
npm run measure         # run the labeled eval set (src/eval/eval-set.ts) and report recall@1/@5
```

`npm run sync` hits the real government portal — it's a live network call, not a mock.

## The eval set

`src/eval/eval-set.ts` is a small, honestly-labeled set of real queries tried during development,
each with documented provenance and a confidence rating (`confirmed` / `high_confidence_inferred`
/ `unconfirmed`) — not a synthetic benchmark.

## Design principles

1. **Don't invent data.** Every field this library returns is either parsed from a portal
   response or explicitly marked as unavailable — never guessed, never silently defaulted.
2. **Don't auto-confirm.** Ranked candidates with scores and evidence, always. The calling
   application owns the decision to treat a match as confirmed.
3. **Don't fake a detail fetch.** A failed or unsupported detail lookup returns the identity you
   already had plus `fetchState: 'detail_unavailable'` — never `null`, never a fabricated field.

## Reporting issues

Open a GitHub issue with a clear description and, where relevant, the exact query or `regNumber`
that misbehaved. See [SECURITY.md](SECURITY.md) instead if the issue is a security vulnerability.
