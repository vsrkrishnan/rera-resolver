#!/usr/bin/env node
import type { StateCode } from './types.js';
import { syncIndex } from './syncIndex.js';
import { resolve } from './resolve.js';
import { fetchProject } from './fetchProject.js';
import { fetchPromoter } from './fetchPromoter.js';
import { readSnapshot, readInvestigationSnapshot, resolveDbPathForState } from './storage.js';
import { DEFAULT_STATE } from './config.js';
import { SUPPORTED_STATES } from './adapters/registry.js';

const [, , command, ...rawRest] = process.argv;

function fail(message: string): never {
  console.error(`[rera-resolver] ${message}`);
  process.exit(1);
}

// Pull an optional `--state <code>` flag out of the args (mirrors the
// existing `--promoter` handling), returning the chosen state and the
// remaining args with the flag removed. Defaults to Karnataka.
function extractState(args: string[]): { state: StateCode; rest: string[] } {
  const i = args.indexOf('--state');
  if (i === -1) return { state: DEFAULT_STATE, rest: args };
  const code = (args[i + 1] ?? '').toUpperCase();
  if (!SUPPORTED_STATES.includes(code as StateCode)) {
    fail(`unknown or unsupported --state "${args[i + 1] ?? ''}". Supported: ${SUPPORTED_STATES.join(', ')}`);
  }
  return { state: code as StateCode, rest: [...args.slice(0, i), ...args.slice(i + 2)] };
}

const { state, rest } = extractState(rawRest);

switch (command) {
  case 'sync': {
    const result = await syncIndex({ state, onLog: (line) => console.log(line) });
    if (!result.ok) fail('sync failed — prior snapshot (if any) was kept. See log above.');
    console.log('[rera-resolver] sync done:', result);
    break;
  }

  case 'status': {
    const dbPath = resolveDbPathForState(state);
    const snapshot = readSnapshot(dbPath);
    const investigations = readInvestigationSnapshot(dbPath);
    console.log(`state:              ${state}`);
    console.log(`db path:            ${dbPath}`);
    if (!snapshot) {
      console.log('index:              not built yet — run `npx rera-resolver sync`');
      break;
    }
    console.log(`fetched at:         ${snapshot.fetchedAt}`);
    console.log(`ongoing projects:   ${snapshot.ongoingCount}`);
    console.log(`completed projects: ${snapshot.completedCount}`);
    console.log(`total records:      ${snapshot.records.length}`);
    console.log(`investigation rows: ${investigations?.records.length ?? 0} (as of ${investigations?.fetchedAt ?? 'n/a'})`);
    break;
  }

  case 'resolve': {
    const promoterFlagIndex = rest.indexOf('--promoter');
    const promoterName = promoterFlagIndex !== -1 ? rest[promoterFlagIndex + 1] : undefined;
    const name = promoterFlagIndex !== -1 ? rest.slice(0, promoterFlagIndex).join(' ') : rest.join(' ');
    if (!name) fail('usage: rera-resolver resolve "<name>" [--promoter <promoter name>] [--state <code>]');
    const result = await resolve(name, promoterName ? { promoterName } : undefined, { state });
    console.log(JSON.stringify(result, null, 2));
    break;
  }

  case 'fetch': {
    const regNumber = rest.join(' ');
    if (!regNumber) fail('usage: rera-resolver fetch "<regNumber>" [--state <code>]');
    const result = await fetchProject(regNumber, { state });
    console.log(JSON.stringify(result, null, 2));
    break;
  }

  case 'promoter': {
    const promoterName = rest.join(' ');
    if (!promoterName) fail('usage: rera-resolver promoter "<promoter name>" [--state <code>]');
    const result = await fetchPromoter(promoterName, { state });
    console.log(JSON.stringify(result, null, 2));
    break;
  }

  default:
    console.log(
      [
        'Usage: rera-resolver <command> [--state <code>]',
        '',
        `  --state <code>              Which state's registry to use (default ${DEFAULT_STATE}). Supported: ${SUPPORTED_STATES.join(', ')}.`,
        '',
        '  sync                        Rebuild the local index from the live RERA portal.',
        '  status                      Show local index path, freshness, and record counts.',
        '  resolve "<name>" [--promoter <name>]   Resolve a project name and print the ranked result.',
        '  fetch "<regNumber>"         Fetch live project detail (status, dates, cost, promoter profile).',
        '  promoter "<name>"           Fetch a promoter\'s profile and their full project list.',
      ].join('\n'),
    );
    process.exit(command ? 1 : 0);
}
