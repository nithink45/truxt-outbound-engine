// Review dashboard server. Long-running stage endpoints run inline (internal tool);
// the UI polls run/company state from the store while they work.
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import * as store from './store.js';
import { startRun, researchCompanies, draftForCompanies, approveAndSend, metrics } from './pipeline.js';
import { checkFollowups } from './stages/followup.js';
import { askAssistant } from './assistant.js';
import { PROVIDER, resolveModel } from './llm.js';
import { MODEL_TIERS } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((e) => {
    console.error(e);
    res.status(500).json({ error: e.message });
  });

// ---- Runs (Stages 1-2) ----
app.post('/api/runs', wrap(async (req, res) => {
  const { query, companyNames } = req.body || {};
  if (!query && !(companyNames || []).length) {
    return res.status(400).json({ error: 'provide query or companyNames[]' });
  }
  const run = await startRun({ query, companyNames: companyNames || [] });
  res.json(run);
}));

app.get('/api/runs', wrap(async (_req, res) => {
  res.json(store.list('runs').slice().reverse());
}));

app.get('/api/runs/:id', wrap(async (req, res) => {
  const run = store.get('runs', req.params.id);
  if (!run) return res.status(404).json({ error: 'not found' });
  const companies = (run.companyIds || []).map((id) => store.get('companies', id)).filter(Boolean);
  res.json({ ...run, companies });
}));

// ---- Research + contacts (Stages 3-4) for checked rows ----
app.post('/api/research', wrap(async (req, res) => {
  const { companyIds } = req.body || {};
  if (!(companyIds || []).length) return res.status(400).json({ error: 'companyIds[] required' });
  res.json(await researchCompanies(companyIds));
}));

// ---- Drafting (Stages 5-6) ----
app.post('/api/draft', wrap(async (req, res) => {
  const { companyIds } = req.body || {};
  if (!(companyIds || []).length) return res.status(400).json({ error: 'companyIds[] required' });
  res.json(await draftForCompanies(companyIds));
}));

// ---- Review view (Stage 7) ----
app.get('/api/drafts', wrap(async (_req, res) => {
  const drafts = store.list('drafts').slice().reverse().map((d) => ({
    ...d,
    company: store.get('companies', d.companyId),
    contact: store.get('contacts', d.contactId),
  }));
  res.json(drafts);
}));

app.patch('/api/drafts/:id', wrap(async (req, res) => {
  const { subject, body, channel } = req.body || {};
  const patch = {};
  if (subject != null) patch.subject = subject;
  if (body != null) patch.body = body;
  if (channel != null) patch.channel = channel;
  const doc = store.update('drafts', req.params.id, patch);
  if (!doc) return res.status(404).json({ error: 'not found' });
  res.json(doc);
}));

app.post('/api/drafts/:id/approve', wrap(async (req, res) => {
  res.json(await approveAndSend(req.params.id, req.body?.edits || null));
}));

app.post('/api/drafts/:id/reject', wrap(async (req, res) => {
  const doc = store.update('drafts', req.params.id, { status: 'rejected' });
  if (!doc) return res.status(404).json({ error: 'not found' });
  res.json(doc);
}));

// Outcome logging (instrumentation: opened / replied / meeting booked / recap)
app.post('/api/drafts/:id/outcome', wrap(async (req, res) => {
  const allowed = ['opened', 'replied', 'meetingBooked', 'recapLogged'];
  const patch = {};
  for (const k of allowed) if (req.body?.[k] != null) patch[k] = !!req.body[k];
  if (req.body?.meetingBooked) patch.meetingAt = new Date().toISOString();
  const doc = store.update('drafts', req.params.id, patch);
  if (!doc) return res.status(404).json({ error: 'not found' });
  store.logEvent('outcome', { draftId: doc.id, ...patch });
  res.json(doc);
}));

// ---- Follow-ups (Stage 8) ----
app.post('/api/followups/check', wrap(async (_req, res) => {
  res.json(await checkFollowups());
}));

// ---- Sales-assistant mode ----
app.post('/api/assistant', wrap(async (req, res) => {
  const { question, companyId } = req.body || {};
  if (!question) return res.status(400).json({ error: 'question required' });
  res.json({ answer: await askAssistant(question, companyId || null) });
}));

// ---- Instrumentation ----
app.get('/api/metrics', wrap(async (_req, res) => res.json(metrics())));

app.get('/api/companies', wrap(async (_req, res) => res.json(store.list('companies').slice().reverse())));

const PORT = process.env.PORT || 3333;
app.listen(PORT, () => {
  console.log(`Truxt outbound engine → http://localhost:${PORT}`);
  const frontier = resolveModel({ tier: 'frontier' });
  const fast = resolveModel({ tier: 'fast' });
  const keyEnv = { gemini: 'GEMINI_API_KEY', anthropic: 'ANTHROPIC_API_KEY', openrouter: 'OPENROUTER_API_KEY' }[PROVIDER];
  const haveKey = keyEnv ? !!process.env[keyEnv] : true;
  console.log(`LLM router: provider=${PROVIDER}  frontier=${frontier}  fast=${fast}`);
  console.log(`Stage 4 contacts: ${process.env.APOLLO_API_KEY ? 'Apollo (real people) → LLM ranks' : 'LLM identification (no APOLLO_API_KEY — set it for real contacts)'}`);
  if (!haveKey) {
    console.log(`note: ${keyEnv} not set — pipeline stages will fail until it is.`);
  } else if (PROVIDER === 'gemini') {
    console.log('mode: temporary Gemini testing. Set LLM_PROVIDER=anthropic to flip every stage to Opus.');
  }
});
