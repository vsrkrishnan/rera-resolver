#!/usr/bin/env node
import { syncIndex } from './syncIndex.js';
import { resolve } from './resolve.js';
import { fetchProject } from './fetchProject.js';
import { fetchPromoter } from './fetchPromoter.js';
import { readSnapshot, readInvestigationSnapshot, DEFAULT_DB_PATH } from './storage.js';

const [, , command, ...rest] = process.argv;

function fail(message: string): never {
  console.error(`[rera-resolver] ${message}`);
  process.exit(1);
}

switch (command) {
  case 'sync': {
    const result = await syncIndex({ onLog: (line) => console.log(line) });
    if (!result.ok) fail('sync failed — prior snapshot (if any) was kept. See log above.');
    console.log('[rera-resolver] sync done:', result);
    break;
  }

  case 'status': {
    const snapshot = readSnapshot();
    const investigations = readInvestigationSnapshot();
    console.log(`db path:            ${DEFAULT_DB_PATH}`);
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
    if (!name) fail('usage: rera-resolver resolve "<name>" [--promoter <promoter name>]');
    const result = await resolve(name, promoterName ? { promoterName } : undefined);
    console.log(JSON.stringify(result, null, 2));
    break;
  }

  case 'fetch': {
    const regNumber = rest.join(' ');
    if (!regNumber) fail('usage: rera-resolver fetch "<regNumber>"');
    const result = await fetchProject(regNumber);
    console.log(JSON.stringify(result, null, 2));
    break;
  }

  case 'promoter': {
    const promoterName = rest.join(' ');
    if (!promoterName) fail('usage: rera-resolver promoter "<promoter name>"');
    const result = await fetchPromoter(promoterName);
    console.log(JSON.stringify(result, null, 2));
    break;
  }

  default:
    console.log(
      [
        'Usage: rera-resolver <command>',
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
