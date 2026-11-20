import express from 'express';
import { trendsService, MONTH_CHOICES, BASES, GROUPS } from '../services/trends/service.js';
import { sameMachineOnly } from './reviews.js';

// Trends: monthly counts of the NGK tickets that were in a sprint, from a local copy that is read from Jira only when asked.
/** 3, 6 or 'ytd' (this year so far); anything else is left as it is so the check below rejects it. */
const parseMonths = (v) => (v === 'ytd' ? 'ytd' : Number(v || 6));

export const createTrendsRouter = ({ service = trendsService } = {}) => {
  const router = express.Router();

  // GET /api/trends/status  — the sync state
  router.get('/trends/status', (req, res) => res.json({ success: true, data: service.status() }));

  // GET /api/trends/sprint-tickets?basis=sprint|created|resolved&months=3|6|ytd&group=all|type|client|component|assignee&type=&client=&component=&assignee=&feTeam=1
  router.get('/trends/sprint-tickets', (req, res) => {
    const basis = String(req.query.basis || 'resolved');
    const group = String(req.query.group || 'all');
    const months = parseMonths(req.query.months);
    if (!BASES.includes(basis) || !GROUPS.includes(group) || !MONTH_CHOICES.includes(months)) {
      return res.status(400).json({ success: false, error: `basis is one of ${BASES.join(', ')}; group is one of ${GROUPS.join(', ')}; months is one of ${MONTH_CHOICES.join(', ')}` });
    }
    // a filter can be given several times (client=A&client=B): the ticket must match one of them
    const many = (v) => (Array.isArray(v) ? v : [v]).filter((x) => typeof x === 'string' && x);
    const filters = { type: many(req.query.type), client: many(req.query.client), assignee: many(req.query.assignee), component: many(req.query.component), feTeam: ['1', 'true'].includes(String(req.query.feTeam)) };
    res.json({ success: true, data: { ...service.sprintTickets({ basis, group, months, filters }), status: service.status() } });
  });

  // GET /api/trends/sprint-tickets/list?basis=&months=&type=&client=&component=&assignee=&feTeam=1  — the tickets behind the chart (same filters), newest first
  router.get('/trends/sprint-tickets/list', (req, res) => {
    const basis = String(req.query.basis || 'resolved');
    const months = parseMonths(req.query.months);
    if (!BASES.includes(basis) || !MONTH_CHOICES.includes(months)) {
      return res.status(400).json({ success: false, error: `basis is one of ${BASES.join(', ')}; months is one of ${MONTH_CHOICES.join(', ')}` });
    }
    const many = (v) => (Array.isArray(v) ? v : [v]).filter((x) => typeof x === 'string' && x);
    const filters = { type: many(req.query.type), client: many(req.query.client), assignee: many(req.query.assignee), component: many(req.query.component), feTeam: ['1', 'true'].includes(String(req.query.feTeam)) };
    res.json({ success: true, data: service.ticketList({ basis, months, filters }) });
  });

  const readFilters = (src) => {
    const many = (v) => (Array.isArray(v) ? v : [v]).filter((x) => typeof x === 'string' && x);
    return { client: many(src.client), assignee: many(src.assignee), component: many(src.component), feTeam: ['1', 'true', true].includes(src.feTeam) };
  };

  // GET /api/trends/defects?months=3|6|ytd&client=&assignee=&feTeam=1  — the defect analysis (numbers, rule-based focus, and the saved guidance if there is one). Never calls the model.
  router.get('/trends/defects', (req, res) => {
    const months = parseMonths(req.query.months);
    if (!MONTH_CHOICES.includes(months)) return res.status(400).json({ success: false, error: `months is one of ${MONTH_CHOICES.join(', ')}` });
    res.json({ success: true, data: { ...service.defectAnalysis({ months, filters: readFilters(req.query) }), status: service.status() } });
  });

  // POST /api/trends/defects/guidance  {months, client:[], assignee:[], feTeam, force}  — asks the model for the written guidance. One at a time.
  router.post('/trends/defects/guidance', sameMachineOnly, async (req, res) => {
    const b = req.body || {};
    const months = parseMonths(b.months);
    if (!MONTH_CHOICES.includes(months)) return res.status(400).json({ success: false, error: `months is one of ${MONTH_CHOICES.join(', ')}` });
    const r = await service.defectGuidance({ months, filters: readFilters(b), force: b.force === true });
    if (r.busy) return res.status(409).json({ success: false, error: 'The guidance is already being written' });
    if (!r.ok) return res.status(502).json({ success: false, error: r.reason });
    const { ok, ...guidance } = r;
    res.json({ success: true, data: guidance });
  });

  // GET /api/trends/patterns/ingest  — the RAG ingest started by recording or adding: running ("queued, done when done"), done, failed or idle
  router.get('/trends/patterns/ingest', (req, res) => res.json({ success: true, data: service.ingestStatus() }));

  // POST /api/trends/patterns/record  {months, client[], assignee[], component[], feTeam}  — record the defects in view that repeat an existing RAG pattern
  // (seen + 1, ticket added; nothing else is edited) and run the RAG's ingest once. 409 when one is running.
  router.post('/trends/patterns/record', sameMachineOnly, async (req, res) => {
    const b = req.body || {};
    const months = parseMonths(b.months);
    if (!MONTH_CHOICES.includes(months)) return res.status(400).json({ success: false, error: `months is one of ${MONTH_CHOICES.join(', ')}` });
    const r = await service.recordRepeats({ months, filters: readFilters(b) });
    if (r.busy) return res.status(409).json({ success: false, error: 'Repeats are already being recorded' });
    if (!r.ok) return res.status(502).json({ success: false, error: r.reason });
    const { ok, ...data } = r;
    res.json({ success: true, data });
  });

  // POST /api/trends/patterns/draft  {months, filters..., cluster: "<id from the analysis>"}  — one model call: a draft pattern saved for review, never written to the RAG.
  router.post('/trends/patterns/draft', sameMachineOnly, async (req, res) => {
    const b = req.body || {};
    const months = parseMonths(b.months);
    if (!MONTH_CHOICES.includes(months) || typeof b.cluster !== 'string' || !/^[0-9a-f]{8}$/.test(b.cluster)) return res.status(400).json({ success: false, error: 'Send {"months": 3|6, "cluster": "<id>"}' });
    const r = await service.draftForCluster({ months, filters: readFilters(b), cluster: b.cluster });
    if (r.busy) return res.status(409).json({ success: false, error: 'A pattern is already being drafted' });
    if (r.notAPattern) return res.json({ success: true, data: { notAPattern: true, reason: r.reason } });
    if (!r.ok) return res.status(502).json({ success: false, error: r.reason });
    const { ok, ...data } = r;
    res.json({ success: true, data });
  });

  // POST /api/trends/patterns/add  {text}  — add a reviewed pattern to the RAG as docs/defects/<id>.md (checked again against the RAG's rules, never overwriting)
  // and run the RAG's ingest. 422 with the problems when the checks fail or the id exists; 409 when another add is running.
  router.post('/trends/patterns/add', sameMachineOnly, async (req, res) => {
    const text = req.body?.text;
    if (typeof text !== 'string' || !text.trim() || text.length > 20000) return res.status(400).json({ success: false, error: 'Send {"text": "<the pattern file>"} (at most 20000 characters)' });
    const r = await service.addPattern({ text });
    if (r.busy) return res.status(409).json({ success: false, error: 'A pattern is already being added' });
    if (!r.ok) return res.status(/not found|could not be written/.test(r.reason) ? 502 : 422).json({ success: false, error: r.reason, problems: r.problems || [] });
    const { ok, ...data } = r;
    res.json({ success: true, data });
  });

  // POST /api/trends/refresh  — read from Jira now (the only way the copy is updated). 202 when it started, 409 when a read is already going.
  router.post('/trends/refresh', sameMachineOnly, (req, res) => {
    if (!service.refresh()) return res.status(409).json({ success: false, error: 'A sync is already running', data: service.status() });
    res.status(202).json({ success: true, data: service.status() });
  });

  return router;
};

export default createTrendsRouter();
