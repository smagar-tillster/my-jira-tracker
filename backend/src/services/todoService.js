import { randomUUID } from 'crypto';
import { getDb } from '../db/database.js';

const parseRow = (row) => {
  if (!row) return null;
  let checklist = [];
  try {
    const parsed = row.checklist_json ? JSON.parse(row.checklist_json) : [];
    checklist = parsed.filter(c => c && c.id);
  } catch {}
  const { checklist_json, ...rest } = row;
  return { ...rest, checklist };
};

const WITH_CHECKLIST = `
  SELECT t.*,
    COALESCE(
      (SELECT json_group_array(json_object('id',c.id,'text',c.text,'done',c.done,'sort_order',c.sort_order))
       FROM todo_checklist c WHERE c.todo_id = t.id ORDER BY c.sort_order),
      '[]'
    ) AS checklist_json
  FROM todos t
`;

const getById = (db, id) =>
  parseRow(db.prepare(
    `SELECT t.*,
      COALESCE(
        (SELECT json_group_array(json_object('id',c.id,'text',c.text,'done',c.done,'sort_order',c.sort_order))
         FROM todo_checklist c WHERE c.todo_id = t.id ORDER BY c.sort_order),
        '[]'
      ) AS checklist_json
     FROM todos t WHERE t.id = ?`
  ).get(id));

// ── Read ────────────────────────────────────────────────────────────────────
export const getAllTodos = (type = null) => {
  const db = getDb();
  const order = 'ORDER BY t.done ASC, t.my_day DESC, t.due_date ASC, t.created_at DESC';
  if (type) {
    return db.prepare(`${WITH_CHECKLIST} WHERE t.type = ? ${order}`).all(type).map(parseRow);
  }
  return db.prepare(`${WITH_CHECKLIST} ${order}`).all().map(parseRow);
};

export const getTodosDueToday = () => {
  const today = new Date().toISOString().slice(0, 10);
  return getDb()
    .prepare(`${WITH_CHECKLIST} WHERE t.due_date = ? AND t.done = 0 ORDER BY t.priority DESC`)
    .all(today)
    .map(parseRow);
};

// ── Create ───────────────────────────────────────────────────────────────────
export const createTodo = (todo) => {
  const db  = getDb();
  const id  = randomUUID();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO todos (id, type, title, brief, due_date, done, priority, my_day, category, created_at)
    VALUES (?, 'task', ?, ?, ?, 0, ?, ?, ?, ?)
  `).run(
    id,
    todo.title,
    todo.brief    ?? null,
    todo.dueDate  ?? null,
    todo.priority ?? 'medium',
    todo.myDay    ? 1 : 0,
    todo.category ?? 'Tasks',
    now,
  );

  if (todo.checklist?.length) {
    const ins = db.prepare(
      'INSERT INTO todo_checklist (id, todo_id, text, done, sort_order, created_at) VALUES (?,?,?,?,?,?)'
    );
    todo.checklist.forEach((item, i) =>
      ins.run(randomUUID(), id, item.text, item.done ? 1 : 0, i, now)
    );
  }

  return getById(db, id);
};

// ── Update ───────────────────────────────────────────────────────────────────
export const updateTodo = (id, updates) => {
  const db     = getDb();
  const fields = [];
  const values = [];

  if (updates.title    !== undefined) { fields.push('title = ?');     values.push(updates.title); }
  if (updates.brief    !== undefined) { fields.push('brief = ?');     values.push(updates.brief); }
  if (updates.dueDate  !== undefined) { fields.push('due_date = ?');  values.push(updates.dueDate); }
  if (updates.done     !== undefined) { fields.push('done = ?');      values.push(updates.done ? 1 : 0); }
  if (updates.priority !== undefined) { fields.push('priority = ?');  values.push(updates.priority); }
  if (updates.myDay    !== undefined) { fields.push('my_day = ?');    values.push(updates.myDay ? 1 : 0); }
  if (updates.category !== undefined) { fields.push('category = ?');  values.push(updates.category); }

  if (fields.length > 0) {
    values.push(id);
    db.prepare(`UPDATE todos SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }

  if (updates.checklist !== undefined) {
    db.prepare('DELETE FROM todo_checklist WHERE todo_id = ?').run(id);
    if (updates.checklist.length > 0) {
      const now = new Date().toISOString();
      const ins = db.prepare(
        'INSERT INTO todo_checklist (id, todo_id, text, done, sort_order, created_at) VALUES (?,?,?,?,?,?)'
      );
      updates.checklist.forEach((item, i) =>
        ins.run(item.id || randomUUID(), id, item.text, item.done ? 1 : 0, i, now)
      );
    }
  }

  return getById(db, id);
};

// ── Delete ───────────────────────────────────────────────────────────────────
export const deleteTodo = (id) => {
  const result = getDb().prepare('DELETE FROM todos WHERE id = ?').run(id);
  return result.changes > 0;
};

// ── Categories ───────────────────────────────────────────────────────────────
export const getAllCategories = () =>
  getDb().prepare('SELECT * FROM todo_categories ORDER BY name ASC').all();

export const createCategory = (name) => {
  const db = getDb();
  const id = randomUUID();
  db.prepare('INSERT INTO todo_categories (id, name) VALUES (?, ?)').run(id, name.trim());
  return db.prepare('SELECT * FROM todo_categories WHERE id = ?').get(id);
};

export const deleteCategory = (id) => {
  if (id === 'cat-tasks') throw new Error('Cannot delete the default Tasks category');
  const result = getDb().prepare('DELETE FROM todo_categories WHERE id = ?').run(id);
  return result.changes > 0;
};

