import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeSnapshot } from '../../storage.js';
import { fetchPromoter } from '../../fetchPromoter.js';
import type { IndexRecord } from '../../types.js';

// fetchPromoter picks ONE of a promoter's projects as the representative to
// fetch live detail from. This is engine-level code (state-agnostic), but the
// bug it guards against only reproduces on a state whose projects can
// legitimately have NO promoter page at all: Karnataka's single detail page
// always carries the promoter block regardless of which project you pick
// (see karnataka.ts's fetchDetail), so on Karnataka the old "first
// 'completed', else first" heuristic was purely a cost optimization and
// never wrong. Tamil Nadu's offline ('TN/…') projects have no promoter page
// (tamilnadu.ts's fetchDetail returns {detail} only, or null) — so a
// promoter whose FIRST-ranked project happens to be an offline one used to
// come back profile_unavailable even when an online sibling of the exact
// same promoter had a full profile. These tests seed a TN index directly and
// stub global fetch (no real network) to prove the fix: fetchPromoter now
// tries every one of the promoter's projects until one actually yields a
// profile, not just whichever is ranked/ordered first.

function withTempDb(fn: (dbPath: string) => void | Promise<void>) {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rera-resolver-fetchpromoter-test-'));
    const dbPath = join(dir, 'index-tn.db');
    try {
      await fn(dbPath);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

function seedTn(dbPath: string, records: IndexRecord[]) {
  writeSnapshot(
    { fetchedAt: new Date().toISOString(), ongoingCount: 0, completedCount: 0, records, state: 'TN' },
    { fetchedAt: new Date().toISOString(), records: [] },
    dbPath,
  );
}

const PROMOTER_ONLINE_PROJECT_HTML = `
<label>Project Name :</label><p class="fw-semibold">New Tower Phase 1</p>
<label>Stage of Construction :</label><p class="fw-semibold">Under Construction</p>
`;
const PROMOTER_DETAIL_HTML = `
<label>Type of Promoter :</label><p class="fw-semibold">company</p>
<label>Email ID :</label><p class="fw-semibold">contact@abcrealty.example</p>
`;

// The exact SAME promoterName string on both records, so scorePromoterMatch's
// exact-match branch gives them an identical 1.0 score — the tie rankAndDedupe
// resolves via its stable sort, i.e. by original record order. Seeding the
// offline (no-profile) record FIRST reproduces the real failure mode: the
// representative that used to get picked is exactly the one with no profile.
const OFFLINE_FIRST: IndexRecord[] = [
  {
    regNumber: 'TN/29/Building/0001/2023',
    registeredName: 'Old Layout Grand',
    promoterName: 'ABC Realty Pvt Ltd',
    dataset: 'registered',
    state: 'TN',
    // No detailRefs at all: an offline row this fixture's list-parse never
    // found GPS/status/date for — tamilNaduAdapter.fetchDetail returns null.
  },
  {
    regNumber: 'TNRERA/29/BLG/0099/2026',
    registeredName: 'New Tower Phase 1',
    promoterName: 'ABC Realty Pvt Ltd',
    dataset: 'registered',
    state: 'TN',
    detailRefs: {
      project: 'https://fake.test/public-view2/project-uuid',
      promoter: 'https://fake.test/public-view1/promoter-uuid',
    },
  },
];

function stubFetch(responses: Record<string, string>) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request) => {
    const key = String(url);
    const body = responses[key];
    if (body === undefined) throw new Error(`unexpected fetch in test: ${key}`);
    return new Response(body, { status: 200 });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

test(
  'fetchPromoter finds the profile on a later project when the first-ranked one has none (Tamil Nadu offline-then-online)',
  withTempDb(async (dbPath) => {
    seedTn(dbPath, OFFLINE_FIRST);
    const restore = stubFetch({
      'https://fake.test/public-view2/project-uuid': PROMOTER_ONLINE_PROJECT_HTML,
      'https://fake.test/public-view1/promoter-uuid': PROMOTER_DETAIL_HTML,
    });
    try {
      const result = await fetchPromoter('ABC Realty Pvt Ltd', { dbPath, state: 'TN' });
      assert.equal(result.fetchState, 'complete');
      assert.equal(result.profile?.email, 'contact@abcrealty.example');
      // Both of the promoter's projects are still reported, regardless of
      // which one supplied the profile.
      assert.equal(result.projects.length, 2);
    } finally {
      restore();
    }
  }),
);

test(
  'fetchPromoter reports profile_unavailable (not an error) when every one of a promoter\'s projects lacks a profile',
  withTempDb(async (dbPath) => {
    // Both offline, neither reachable for a promoter page at all.
    seedTn(dbPath, [
      { ...OFFLINE_FIRST[0], regNumber: 'TN/29/Building/0002/2023', registeredName: 'Old Layout North' },
      { ...OFFLINE_FIRST[0], regNumber: 'TN/29/Building/0003/2023', registeredName: 'Old Layout South' },
    ]);
    const result = await fetchPromoter('ABC Realty Pvt Ltd', { dbPath, state: 'TN' });
    assert.equal(result.fetchState, 'profile_unavailable');
    assert.equal(result.profile, undefined);
    assert.equal(result.projects.length, 2);
  }),
);

test(
  'fetchPromoter returns profile_unavailable with no projects when the promoter is not in the index',
  withTempDb(async (dbPath) => {
    seedTn(dbPath, OFFLINE_FIRST);
    const result = await fetchPromoter('Nobody Realty Ever Registered', { dbPath, state: 'TN' });
    assert.equal(result.fetchState, 'profile_unavailable');
    assert.equal(result.projects.length, 0);
  }),
);
