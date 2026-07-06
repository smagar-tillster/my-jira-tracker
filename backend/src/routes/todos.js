import express from 'express';
import {
  getAllTodos,
  getTodosDueToday,
  createTodo,
  updateTodo,
  deleteTodo,
  getAllCategories,
  createCategory,
  deleteCategory,
} from '../services/todoService.js';

const router = express.Router();

// ── Specific sub-routes BEFORE :id parameterized routes ─────────────────────

// GET /api/todos/categories
router.get('/todos/categories', (req, res) => {
  try {
    res.json({ success: true, data: getAllCategories() });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// POST /api/todos/categories
router.post('/todos/categories', (req, res) => {
  try {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ success: false, error: 'name is required' });
    const cat = createCategory(name);
    res.status(201).json({ success: true, data: cat });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// DELETE /api/todos/categories/:id
router.delete('/todos/categories/:id', (req, res) => {
  try {
    const deleted = deleteCategory(req.params.id);
    if (!deleted) return res.status(404).json({ success: false, error: 'Category not found' });
    res.json({ success: true });
  } catch (e) {
    const status = e.message.includes('Cannot delete') ? 400 : 500;
    res.status(status).json({ success: false, error: e.message });
  }
});

// GET /api/todos/today
router.get('/todos/today', (req, res) => {
  try {
    res.json({ success: true, data: getTodosDueToday() });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── Generic CRUD ─────────────────────────────────────────────────────────────

// GET /api/todos?type=
router.get('/todos', (req, res) => {
  try {
    const todos = getAllTodos(req.query.type || null);
    res.json({ success: true, data: todos });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// POST /api/todos
router.post('/todos', (req, res) => {
  try {
    const { title } = req.body;
    if (!title?.trim()) return res.status(400).json({ success: false, error: 'title is required' });
    const todo = createTodo(req.body);
    res.status(201).json({ success: true, data: todo });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// PUT /api/todos/:id
router.put('/todos/:id', (req, res) => {
  try {
    const updated = updateTodo(req.params.id, req.body);
    if (!updated) return res.status(404).json({ success: false, error: 'Todo not found' });
    res.json({ success: true, data: updated });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// DELETE /api/todos/:id
router.delete('/todos/:id', (req, res) => {
  try {
    const deleted = deleteTodo(req.params.id);
    if (!deleted) return res.status(404).json({ success: false, error: 'Todo not found' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

export default router;

