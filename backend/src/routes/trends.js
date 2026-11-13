import express from 'express';
import { trendsService, MONTH_CHOICES, BASES } from '../services/trends/service.js';
import { sameMachineOnly } from './reviews.js';

// Trends: monthly counts of the NGK tickets that were in a sprint, from a local copy kept in step with Jira.
export const createTrendsRouter = ({ service = trendsService } = {}) => {
  const router = express.Router();

  // GET /api/trends/status  — the sync state
  router.get('/trends/status', (req, res) => res.json({ success: true, data: service.status() }));

  // GET /api/trends/sprint-tickets?basis=sprint|created|resolved&months=6|12|24|all
  router.get('/trends/sprint-tickets', (req, res) => {
    const basis = String(req.query.basis || 'sprint');
    const monthsRaw = String(req.query.months || '12');
    const months = monthsRaw === 'all' ? 'all' : Number(monthsRaw);
    if (!BASES.includes(basis) || !MONTH_CHOICES.includes(months)) {
      return res.status(400).json({ success: false, error: `basis is one of ${BASES.join(', ')}; months is one of ${MONTH_CHOICES.join(', ')}` });
    }
    res.json({ success: true, data: { ...service.sprintTickets({ basis, months }), status: service.status() } });
  });

  // POST /api/trends/refresh  {"full": true|false}  — read from Jira now. 202 when it started, 409 when a sync is already going.
  router.post('/trends/refresh', sameMachineOnly, (req, res) => {
    if (!service.refresh(req.body?.full === true ? 'full' : 'auto')) return res.status(409).json({ success: false, error: 'A sync is already running', data: service.status() });
    res.status(202).json({ success: true, data: service.status() });
  });

  return router;
};

export default createTrendsRouter();
