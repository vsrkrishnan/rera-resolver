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
  UnknownRegNumberError,
} from '../dist/index.js';

import { cached } from './cache.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DB_PATH = process.env.RERA_RESOLVER_DB_PATH ?? path.resolve(__dirname, '../data/index.db');

// Self-heals a missing/stale local index against the live portal — no index
// needs to be baked into the deploy image or committed to git. Blocking only
// when no index exists at all (first boot); a stale-but-present index still
// serves immediately while ensureIndex refreshes it in the background.
const indexStatus = await ensureIndex({ dbPath: DB_PATH });
console.log(`[rera-resolver-web] index status: ${indexStatus.status} (fetchedAt: ${indexStatus.fetchedAt ?? 'n/a'})`);

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/status', (_req, res) => {
  const snapshot = readSnapshot(DB_PATH);
  if (!snapshot) {
    return res.status(503).json({ ready: false, dbPath: DB_PATH });
  }
  res.json({
    ready: true,
    dbPath: DB_PATH,
    fetchedAt: snapshot.fetchedAt,
    ongoingCount: snapshot.ongoingCount,
    completedCount: snapshot.completedCount,
    totalRecords: snapshot.records.length,
  });
});

app.get('/api/resolve', async (req, res) => {
  const name = typeof req.query.name === 'string' ? req.query.name.trim() : '';
  const promoterName = typeof req.query.promoter === 'string' ? req.query.promoter.trim() : '';
  if (!name) return res.status(400).json({ error: 'query param "name" is required' });

  const hints = promoterName ? { promoterName } : undefined;
  const result = await resolve(name, hints, { dbPath: DB_PATH });

  if (result.unresolvedReason === 'index_not_ready') {
    return res.status(503).json({ error: 'local index is not built yet', result });
  }
  res.json(result);
});

app.get('/api/project', async (req, res) => {
  const regNumber = typeof req.query.regNumber === 'string' ? req.query.regNumber.trim() : '';
  if (!regNumber) return res.status(400).json({ error: 'query param "regNumber" is required' });

  try {
    const project = await cached(`project:${regNumber}`, () =>
      fetchProject(regNumber, { dbPath: DB_PATH }),
    );
    res.json(project);
  } catch (err) {
    if (err instanceof UnknownRegNumberError) {
      return res.status(404).json({ error: 'unknown regNumber — not present in the local index' });
    }
    console.error('[api/project]', err);
    res.status(500).json({ error: 'internal error fetching project detail' });
  }
});

app.get('/api/promoter', async (req, res) => {
  const name = typeof req.query.name === 'string' ? req.query.name.trim() : '';
  if (!name) return res.status(400).json({ error: 'query param "name" is required' });

  try {
    const [promoter, investigation] = await Promise.all([
      cached(`promoter:${name}`, () => fetchPromoter(name, { dbPath: DB_PATH })),
      checkUnderInvestigation(name, undefined, { dbPath: DB_PATH }),
    ]);
    res.json({ promoter, investigation });
  } catch (err) {
    console.error('[api/promoter]', err);
    res.status(500).json({ error: 'internal error fetching promoter detail' });
  }
});

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => {
  console.log(`[rera-resolver-web] listening on :${PORT} (db: ${DB_PATH})`);
});
