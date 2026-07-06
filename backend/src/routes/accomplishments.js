import express from 'express';
import {
  getAllAccomplishments,
  getSprintList,
  createAccomplishment,
  updateAccomplishment,
  deleteAccomplishment,
} from '../services/accomplishmentService.js';

const router = express.Router();

// GET /api/accomplishments?sprint=&category=&type=
router.get('/accomplishments', (req, res) => {
  try {
    const { sprint, category, type } = req.query;
    const data = getAllAccomplishments({ sprint, category, type });
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/accomplishments/sprints
router.get('/accomplishments/sprints', (req, res) => {
  try {
    const sprints = getSprintList();
    res.json({ success: true, data: sprints });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/accomplishments
router.post('/accomplishments', (req, res) => {
  try {
    const { title, type, detail, issueKey, sprint, date, category, impact } = req.body;
    if (!title) {
      return res.status(400).json({ success: false, error: 'title is required' });
    }
    const entry = createAccomplishment({ title, type, detail, issueKey, sprint, date, category, impact });
    res.status(201).json({ success: true, data: entry });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/accomplishments/:id
router.put('/accomplishments/:id', (req, res) => {
  try {
    const { id } = req.params;
    const updated = updateAccomplishment(id, req.body);
    if (!updated) return res.status(404).json({ success: false, error: 'Accomplishment not found' });
    res.json({ success: true, data: updated });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/accomplishments/:id
router.delete('/accomplishments/:id', (req, res) => {
  try {
    const { id } = req.params;
    const deleted = deleteAccomplishment(id);
    if (!deleted) return res.status(404).json({ success: false, error: 'Accomplishment not found' });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
