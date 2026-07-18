#!/usr/bin/env tsx
// Spec §8 measurement gate: runs Tiers 0-2 (resolve(), no LLM) against the
// labeled eval set and reports recall@1/recall@5, split well-known vs
// obscure. Multi-answer cases (a query with several genuinely correct
// projects) count as a recall@k hit if ANY accepted regNumber appears in the
// top k — recall@1 is explicitly noted as not meaningful for those, since
// there is no single right answer to rank first.
//
// For expectNotHighConfidence cases (projects confirmed/inferred absent from
// the registry), the pass bar is specifically "never falsely asserts
// high_confidence" — NOT "must return status: unresolved". A query sharing a
// real brand token with real same-developer projects can legitimately come
// back 'ambiguous' with weak, hedged candidates; that's honest behavior, not
// a failure. See eval-set.ts's comment on this field for how that was
// learned (the hard way, against this exact script's first run).
import { resolve } from '../src/resolve.js';
import { EVAL_SET, type EvalCase } from '../src/eval/eval-set.js';

interface CaseResult {
  evalCase: EvalCase;
  status: string;
  top1Hit: boolean;
  top5Hit: boolean;
  noFalseHighConfidence: boolean | null; // null = not applicable (this case expects a real match)
  strictlyUnresolved: boolean | null; // informational only, not pass/fail
  topCandidates: string[];
}

async function runCase(evalCase: EvalCase): Promise<CaseResult> {
  const r = await resolve(evalCase.query);
  const top1 = r.candidates.slice(0, 1).map((c) => c.regNumber);
  const top5 = r.candidates.slice(0, 5).map((c) => c.regNumber);

  if (evalCase.expectNotHighConfidence) {
    return {
      evalCase,
      status: r.status,
      top1Hit: false,
      top5Hit: false,
      noFalseHighConfidence: r.status !== 'high_confidence',
      strictlyUnresolved: r.status === 'unresolved',
      topCandidates: r.candidates.slice(0, 3).map((c) => c.registeredName),
    };
  }

  const accepted = new Set(evalCase.acceptedRegNumbers ?? []);
  return {
    evalCase,
    status: r.status,
    top1Hit: top1.some((rn) => accepted.has(rn)),
    top5Hit: top5.some((rn) => accepted.has(rn)),
    noFalseHighConfidence: null,
    strictlyUnresolved: null,
    topCandidates: r.candidates.slice(0, 3).map((c) => c.registeredName),
  };
}

function summarize(label: string, results: CaseResult[]) {
  const matchCases = results.filter((r) => !r.evalCase.expectNotHighConfidence);
  const absenceCases = results.filter((r) => r.evalCase.expectNotHighConfidence);

  const recall1 = matchCases.length ? matchCases.filter((r) => r.top1Hit).length / matchCases.length : null;
  const recall5 = matchCases.length ? matchCases.filter((r) => r.top5Hit).length / matchCases.length : null;
  const noFalseHighConf = absenceCases.length
    ? absenceCases.filter((r) => r.noFalseHighConfidence).length / absenceCases.length
    : null;
  const strictlyUnresolved = absenceCases.length
    ? absenceCases.filter((r) => r.strictlyUnresolved).length / absenceCases.length
    : null;

  console.log(`\n=== ${label} (n=${results.length}: ${matchCases.length} match-cases, ${absenceCases.length} absence-cases) ===`);
  if (recall1 !== null) console.log(`  recall@1: ${(recall1 * 100).toFixed(0)}% (${matchCases.filter((r) => r.top1Hit).length}/${matchCases.length})`);
  if (recall5 !== null) console.log(`  recall@5: ${(recall5 * 100).toFixed(0)}% (${matchCases.filter((r) => r.top5Hit).length}/${matchCases.length})`);
  if (noFalseHighConf !== null)
    console.log(
      `  no false high_confidence: ${(noFalseHighConf * 100).toFixed(0)}% (${absenceCases.filter((r) => r.noFalseHighConfidence).length}/${absenceCases.length}) [the real pass bar]`,
    );
  if (strictlyUnresolved !== null)
    console.log(
      `  strictly unresolved: ${(strictlyUnresolved * 100).toFixed(0)}% (${absenceCases.filter((r) => r.strictlyUnresolved).length}/${absenceCases.length}) [informational only, not pass/fail]`,
    );
}

const results = await Promise.all(EVAL_SET.map(runCase));

console.log('=== Per-case detail ===');
for (const r of results) {
  const outcome = r.evalCase.expectNotHighConfidence
    ? r.noFalseHighConfidence
      ? `PASS (${r.status}, no false high_confidence)`
      : `FAIL (falsely asserted high_confidence)`
    : r.top1Hit
      ? 'PASS (recall@1)'
      : r.top5Hit
        ? 'PASS (recall@5 only)'
        : 'FAIL (not in top 5)';
  console.log(`\n"${r.evalCase.query}" [${r.evalCase.category}, ${r.evalCase.confidence}] -> ${outcome}`);
  console.log(`  status: ${r.status}, top candidates: ${JSON.stringify(r.topCandidates)}`);
}

summarize('ALL CASES', results);
summarize('WELL-KNOWN', results.filter((r) => r.evalCase.wellKnown));
summarize('OBSCURE/LESS-KNOWN', results.filter((r) => !r.evalCase.wellKnown));
summarize('CONFIRMED confidence only', results.filter((r) => r.evalCase.confidence === 'confirmed'));

console.log(
  `\nNote: this eval set has ${EVAL_SET.length} cases — well below the spec's "a few dozen minimum". These numbers are a documented starting point, not a final measurement.`,
);
