#!/usr/bin/env node
// Runs after `npm install`. Best-effort only: a portal outage, an offline
// install, a locked-down CI network, or `dist` not being built yet (a
// repo-local dev install before the first `npm run build`) must never fail
// the install itself — this always exits 0, no matter what happens inside.
import { ensureIndex } from './ensureIndex.js';

if (process.env.RERA_RESOLVER_SKIP_POSTINSTALL) {
  console.log('[rera-resolver] RERA_RESOLVER_SKIP_POSTINSTALL set, skipping index bootstrap.');
  process.exit(0);
}

try {
  const result = await ensureIndex({ onLog: (line) => console.log(line) });
  if (result.status === 'unavailable') {
    console.log(
      '[rera-resolver] Could not reach the RERA portal to build the local index right now. ' +
        'resolve() will report unresolvedReason: "index_not_ready" until you run `npx rera-resolver sync`.',
    );
  } else {
    console.log(`[rera-resolver] Local index ${result.status} (fetchedAt=${result.fetchedAt}). Ready to resolve().`);
  }
} catch (err) {
  console.log(
    '[rera-resolver] Skipped automatic index bootstrap due to an unexpected error. ' +
      'Run `npx rera-resolver sync` when ready.',
    err instanceof Error ? err.message : err,
  );
}

process.exit(0);
