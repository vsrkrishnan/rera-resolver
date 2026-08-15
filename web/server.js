import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

import {
  resolve,
  fetch as fetchProject,
  fetchPromoter,
  checkUnderInvestigation,
  readSnapshot,
  ensureIndex,
  resolveDbPathForState,
  getAdapter,
  SUPPORTED_STATES,
  UnknownRegNumberError,
} from '../dist/index.js';

import { cached } from './cache.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Multi-state: never pin a single DB file. Each state has its own
// index-<state>.db under RERA_RESOLVER_DB_DIR; the library resolves the path
// per call from the `state` option. A query always targets exactly ONE state —
// there is deliberately no cross-state search here.
process.env.RERA_RESOLVER_DB_DIR ??= path.resolve(__dirname, '../data');
delete process.env.RERA_RESOLVER_DB_PATH;

// Every supported state (KA, TN) self-heals its own index on boot. Present-but-
// stale indexes serve immediately while refreshing; only a wholly missing index
// blocks. States advertise themselves via getAdapter(state).name.
const STATES = SUPPORTED_STATES.map((code) => ({ code, name: getAdapter(code).name }));
for (const s of STATES) {
  const status = await ensureIndex({ state: s.code });
  const snapshot = readSnapshot(resolveDbPathForState(s.code));
  s.totalRecords = snapshot?.records.length ?? 0; // shown in the state toggle
  console.log(`[rera-resolver-web] ${s.code} (${s.name}) index: ${status.status} (${s.totalRecords} projects, fetchedAt: ${status.fetchedAt ?? 'n/a'})`);
}

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

// Resolve and validate the required `state` query param. A request without a
// valid, supported state is rejected — the caller must be explicit about which
// registry it means (there is no implicit default).
function requireState(req, res) {
  const raw = typeof req.query.state === 'string' ? req.query.state.trim().toUpperCase() : '';
  if (!raw) {
    res.status(400).json({ error: 'query param "state" is required (e.g. KA, TN)' });
    return null;
  }
  if (!SUPPORTED_STATES.includes(raw)) {
    res.status(400).json({ error: `unsupported state "${raw}" — supported: ${SUPPORTED_STATES.join(', ')}` });
    return null;
  }
  return raw;
}

// The states the UI offers — single source of truth (a future state appears
// here automatically once its adapter is registered).
app.get('/api/states', (_req, res) => {
  res.json({ states: STATES });
});

app.get('/api/status', (req, res) => {
  const state = requireState(req, res);
  if (!state) return;
  const snapshot = readSnapshot(resolveDbPathForState(state));
  if (!snapshot) return res.status(503).json({ ready: false, state });
  res.json({
    ready: true,
    state,
    fetchedAt: snapshot.fetchedAt,
    totalRecords: snapshot.records.length,
  });
});

app.get('/api/resolve', async (req, res) => {
  const state = requireState(req, res);
  if (!state) return;
  const name = typeof req.query.name === 'string' ? req.query.name.trim() : '';
  const promoterName = typeof req.query.promoter === 'string' ? req.query.promoter.trim() : '';
  if (!name) return res.status(400).json({ error: 'query param "name" is required' });

  const hints = promoterName ? { promoterName } : undefined;
  const result = await resolve(name, hints, { state });

  if (result.unresolvedReason === 'index_not_ready') {
    return res.status(503).json({ error: 'local index is not built yet', result });
  }
  res.json(result);
});

app.get('/api/project', async (req, res) => {
  const state = requireState(req, res);
  if (!state) return;
  const regNumber = typeof req.query.regNumber === 'string' ? req.query.regNumber.trim() : '';
  if (!regNumber) return res.status(400).json({ error: 'query param "regNumber" is required' });

  try {
    const project = await cached(`${state}:project:${regNumber}`, () => fetchProject(regNumber, { state }));
    res.json(project);
  } catch (err) {
    if (err instanceof UnknownRegNumberError) {
      return res.status(404).json({ error: 'unknown regNumber — not present in this state\'s index' });
    }
    console.error('[api/project]', err);
    res.status(500).json({ error: 'internal error fetching project detail' });
  }
});

app.get('/api/promoter', async (req, res) => {
  const state = requireState(req, res);
  if (!state) return;
  const name = typeof req.query.name === 'string' ? req.query.name.trim() : '';
  if (!name) return res.status(400).json({ error: 'query param "name" is required' });

  try {
    const [promoter, investigation] = await Promise.all([
      cached(`${state}:promoter:${name}`, () => fetchPromoter(name, { state })),
      checkUnderInvestigation(name, undefined, { state }),
    ]);
    res.json({ promoter, investigation });
  } catch (err) {
    console.error('[api/promoter]', err);
    res.status(500).json({ error: 'internal error fetching promoter detail' });
  }
});

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => {
  console.log(`[rera-resolver-web] listening on :${PORT} (states: ${SUPPORTED_STATES.join(', ')})`);
});
