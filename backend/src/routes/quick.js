import express from 'express';
import { quickService } from '../services/quick/service.js';
import { sameMachineOnly } from './reviews.js';

// Quick Analysis: the last report, the run state, Run now, and marking new tickets read.
export const createQuickRouter = ({ service = quickService } = {}) => {
  const router = express.Router();

  // GET /api/quick/status  — cheap; the bell polls it
  router.get('/quick/status', (req, res) => res.json({ success: true, data: service.status() }));

  // GET /api/quick/report  — the stored report (null before the first run) and the run state
  router.get('/quick/report', (req, res) => res.json({ success: true, data: { report: service.currentReport(), status: service.status() } }));

  // POST /api/quick/run  — Run now. 202 when it started, 409 when a run is already going.
  router.post('/quick/run', sameMachineOnly, (req, res) => {
    if (!service.runNow()) return res.status(409).json({ success: false, error: 'A run is already in progress', data: service.status() });
    res.status(202).json({ success: true, data: service.status() });
  });

  // PUT /api/quick/new/:key/read  {"read": true|false}  — a ticket marked read is skipped from then on
  router.put('/quick/new/:key/read', (req, res) => {
    const key = String(req.params.key || '').toUpperCase();
    if (!/^[A-Z][A-Z0-9]*-\d+$/.test(key)) return res.status(400).json({ success: false, error: 'Not a ticket key' });
    if (!service.markRead(key, req.body?.read !== false)) return res.status(404).json({ success: false, error: `${key} is not in the new tickets` });
    res.json({ success: true, data: service.status() });
  });

  // POST /api/quick/viewed  — the page was opened: the bell clears until the next run finds something new
  router.post('/quick/viewed', (req, res) => { service.markViewed(); res.json({ success: true, data: service.status() }); });

  return router;
};

export default createQuickRouter();
