#!/usr/bin/env tsx
// Runnable entrypoint for syncIndex (spec §5.5). The consumer's environment
// (cron, systemd timer, GitHub Actions schedule, etc.) is responsible for
// invoking this on a cadence — intended weekly. This script itself does not
// schedule anything.
import { syncIndex } from '../src/syncIndex.js';
import { DEFAULT_STATE } from '../src/config.js';
import { SUPPORTED_STATES } from '../src/adapters/registry.js';
import type { StateCode } from '../src/types.js';

// Which state to crawl: `--state <code>` (default KA). With RERA_RESOLVER_DB_DIR
// set (the npm script sets it to `data`), this writes to data/index-<state>.db,
// so each state's index is a separate file.
const flagIdx = process.argv.indexOf('--state');
const stateArg = flagIdx !== -1 ? (process.argv[flagIdx + 1] ?? '').toUpperCase() : DEFAULT_STATE;
if (!SUPPORTED_STATES.includes(stateArg as StateCode)) {
  console.error(`[sync] unknown/unsupported --state "${stateArg}". Supported: ${SUPPORTED_STATES.join(', ')}`);
  process.exit(1);
}
const state = stateArg as StateCode;

const result = await syncIndex({
  state,
  onLog: (line) => console.log(line),
  onCost: (record) => console.log('[cost]', JSON.stringify(record)),
});

if (!result.ok) {
  console.error('[sync] sync failed, prior snapshot retained:', result);
  process.exit(1);
}

console.log('[sync] done:', result);
