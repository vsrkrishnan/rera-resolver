#!/usr/bin/env tsx
// Runnable entrypoint for syncIndex (spec §5.5). The consumer's environment
// (cron, systemd timer, GitHub Actions schedule, etc.) is responsible for
// invoking this on a cadence — intended weekly. This script itself does not
// schedule anything.
import { syncIndex } from '../src/syncIndex.js';

const result = await syncIndex({
  onLog: (line) => console.log(line),
  onCost: (record) => console.log('[cost]', JSON.stringify(record)),
});

if (!result.ok) {
  console.error('[sync] sync failed, prior snapshot retained:', result);
  process.exit(1);
}

console.log('[sync] done:', result);
