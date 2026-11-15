import express from 'express';
import { trendsService, MONTH_CHOICES, BASES, GROUPS } from '../services/trends/service.js';
import { sameMachineOnly } from './reviews.js';

// Trends: monthly counts of the NGK tickets that were in a sprint, from a local copy that is read from Jira only when asked.
export const createTrendsRouter = ({ service = trendsService } = {}) => {
  const router = express.Router();

  // GET /api/trends/status  — the sync state
  router.get('/trends/status', (req, res) => res.json({ success: true, data: service.status() }));

  // GET /api/trends/sprint-tickets?basis=sprint|created|resolved&months=3|6&group=all|type|client|assignee&type=&type=&client=&client=&assignee=&feTeam=1
  router.get('/trends/sprint-tickets', (req, res) => {
    const basis = String(req.query.basis || 'resolved');
    const group = String(req.query.group || 'all');
    const months = Number(req.query.months || 6);
    if (!BASES.includes(basis) || !GROUPS.includes(group) || !MONTH_CHOICES.includes(months)) {
      return res.status(400).json({ success: false, error: `basis is one of ${BASES.join(', ')}; group is one of ${GROUPS.join(', ')}; months is one of ${MONTH_CHOICES.join(', ')}` });
    }
    // a filter can be given several times (client=A&client=B): the ticket must match one of them
    const many = (v) => (Array.isArray(v) ? v : [v]).filter((x) => typeof x === 'string' && x);
    const filters = { type: many(req.query.type), client: many(req.query.client), assignee: many(req.query.assignee), feTeam: ['1', 'true'].includes(String(req.query.feTeam)) };
    res.json({ success: true, data: { ...service.sprintTickets({ basis, group, months, filters }), status: service.status() } });
  });

  // POST /api/trends/refresh  — read from Jira now (the only way the copy is updated). 202 when it started, 409 when a read is already going.
  router.post('/trends/refresh', sameMachineOnly, (req, res) => {
    if (!service.refresh()) return res.status(409).json({ success: false, error: 'A sync is already running', data: service.status() });
    res.status(202).json({ success: true, data: service.status() });
  });

  return router;
};

export default createTrendsRouter();
