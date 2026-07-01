import React, { useState, useEffect, useMemo, memo } from 'react';
import ShimmerLoading from './ShimmerLoading';
import { Todo, TodoCategory, TodoPriority, CreateTodoPayload } from '../types';
import { todosApi } from '../services/api';
import { parseLocalDate } from '../utils/dateUtils';

// ─── Types ───────────────────────────────────────────────────────────────────
type TodoGroupBy = 'none' | 'category' | 'priority' | 'status' | 'dueDate';

interface FormState {
  title: string;
  priority: TodoPriority;
  dueDate: string;
  myDay: boolean;
  markClosed: boolean;
  category: string;
  brief: string;
  checklist: Array<{ id?: string; text: string; done: boolean }>;
}

export interface TodoPageProps {
  addTodoTrigger?: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
const todayD = (): Date => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const todayStr = () => new Date().toISOString().slice(0, 10);
const fmtDate = (d: Date | null) => d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';

const INIT_FORM = (): FormState => ({
  title: '', priority: 'medium', dueDate: todayStr(),
  myDay: false, markClosed: false, category: 'Tasks', brief: '', checklist: [],
});

const PRI_BTNS: { v: TodoPriority; label: string; active: string; inactive: string }[] = [
  { v: 'high',   label: '🔴 High',   active: 'bg-red-600 text-white border-red-600',       inactive: 'bg-white text-red-700 border-red-300 hover:bg-red-50' },
  { v: 'medium', label: '🟡 Medium', active: 'bg-yellow-500 text-white border-yellow-500', inactive: 'bg-white text-yellow-700 border-yellow-300 hover:bg-yellow-50' },
  { v: 'low',    label: '🟢 Low',    active: 'bg-green-600 text-white border-green-600',   inactive: 'bg-white text-green-700 border-green-300 hover:bg-green-50' },
];

const GROUP_OPTIONS: { key: TodoGroupBy; label: string }[] = [
  { key: 'category', label: 'Category' },
  { key: 'priority',  label: 'Priority' },
  { key: 'status',    label: 'Status' },
  { key: 'dueDate',   label: 'Due Date' },
];

const getGroupVal = (t: Todo, by: TodoGroupBy): string => {
  if (by === 'none')     return 'All';
  if (by === 'category') return t.category || 'Uncategorized';
  if (by === 'priority') return t.priority;
  if (by === 'status')   return t.done === 1 ? 'Done' : 'Active';
  if (by === 'dueDate')  return t.due_date || 'No Due Date';
  return 'All';
};

const groupTodos = (rows: Todo[], by: TodoGroupBy): Map<string, Todo[]> => {
  const m = new Map<string, Todo[]>();
  for (const row of rows) {
    const key = getGroupVal(row, by);
    if (!m.has(key)) m.set(key, []);
    m.get(key)!.push(row);
  }
  return m;
};

// ─── Main Component ──────────────────────────────────────────────────────────
const TodoPage: React.FC<TodoPageProps> = ({ addTodoTrigger }) => {
  const [todos, setTodos]               = useState<Todo[]>([]);
  const [categories, setCategories]     = useState<TodoCategory[]>([{ id: 'cat-tasks', name: 'Tasks', created_at: '' }]);
  const [todosLoading, setTodosLoading] = useState(false);
  const [searchTerm, setSearchTerm]     = useState('');
  const [todoFilter, setTodoFilter]     = useState('active');
  const [catFilter, setCatFilter]       = useState('all');
  const [groupBy, setGroupBy]           = useState<TodoGroupBy>('none');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [groupBySearch, setGroupBySearch] = useState('');
  const [catSearch, setCatSearch]       = useState('');

  const [showForm, setShowForm]         = useState(false);
  const [editingId, setEditingId]       = useState<string | null>(null);
  const [form, setForm]                 = useState<FormState>(INIT_FORM());
  const [clInput, setClInput]           = useState('');
  const [newCatInput, setNewCatInput]   = useState('');
  const [addingCat, setAddingCat]       = useState(false);
  const [formErr, setFormErr]           = useState<string | null>(null);

  useEffect(() => {
    loadTodos();
    todosApi.getCategories().then(setCategories).catch(() => {});
  }, []);

  const loadTodos = async () => {
    setTodosLoading(true);
    try { setTodos(await todosApi.getAll()); } catch {} finally { setTodosLoading(false); }
  };

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.filter-dropdown')) setOpenDropdown(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => { setExpandedGroups(new Set()); }, [groupBy]);

  // Open + add form when triggered from FAB
  useEffect(() => {
    if (!addTodoTrigger) return;
    setEditingId(null); setForm(INIT_FORM()); setClInput(''); setFormErr(null); setShowForm(true);
  }, [addTodoTrigger]);

  // ── Filtered + grouped todos ─────────────────────────────────────────────
  const filteredTodos = useMemo(() => {
    const t = todayD();
    let r = todos;
    if (todoFilter === 'slack')             r = r.filter(td => td.type === 'slack');
    else if (todoFilter === 'jira-notification') r = r.filter(td => td.type === 'jira-notification');
    else if (todoFilter === 'my-day')       r = r.filter(td => td.my_day === 1 && td.done === 0);
    else if (todoFilter === 'active')       r = r.filter(td => td.done === 0);
    else if (todoFilter === 'today')        r = r.filter(td => { const d = parseLocalDate(td.due_date); return td.done === 0 && d ? d.getTime() === t.getTime() : false; });
    else if (todoFilter === 'overdue')      r = r.filter(td => { const d = parseLocalDate(td.due_date); return td.done === 0 && d ? d < t : false; });
    else if (todoFilter === 'done')         r = r.filter(td => td.done === 1);
    if (catFilter !== 'all') r = r.filter(td => td.type !== 'task' || td.category === catFilter);
    if (searchTerm.trim()) {
      const q = searchTerm.trim().toLowerCase();
      r = r.filter(td => td.title.toLowerCase().includes(q) || (td.brief || '').toLowerCase().includes(q) || (td.category || '').toLowerCase().includes(q));
    }
    return r;
  }, [todos, todoFilter, catFilter, searchTerm]);

  const groupedTodos = useMemo(() => groupTodos(filteredTodos, groupBy), [filteredTodos, groupBy]);

  const todoStats = useMemo(() => {
    const t = todayD();
    const tasks  = todos.filter(td => td.type === 'task');
    const active = tasks.filter(td => td.done === 0);
    return {
      myDay:   active.filter(td => td.my_day === 1).length,
      active:  active.length,
      today:   active.filter(td => { const d = parseLocalDate(td.due_date); return d ? d.getTime() === t.getTime() : false; }).length,
      overdue: active.filter(td => { const d = parseLocalDate(td.due_date); return d ? d < t : false; }).length,
      done:    tasks.filter(td => td.done === 1).length,
    };
  }, [todos]);

  // ── Todo CRUD ─────────────────────────────────────────────────────────────
  const openAdd = () => {
    setEditingId(null); setForm(INIT_FORM()); setClInput(''); setFormErr(null); setShowForm(true);
  };
  const openEdit = (todo: Todo) => {
    setEditingId(todo.id);
    setForm({
      title: todo.title, priority: todo.priority, dueDate: todo.due_date || '',
      myDay: todo.my_day === 1, markClosed: todo.done === 1, category: todo.category || 'Tasks', brief: todo.brief || '',
      checklist: (todo.checklist || []).map(c => ({ id: c.id, text: c.text, done: c.done === 1 })),
    });
    setClInput(''); setFormErr(null); setShowForm(true);
  };
  const closeForm = () => {
    if (editingId) void handleSave(true);
    else { setShowForm(false); setEditingId(null); }
  };

  const addCLItem = () => {
    if (!clInput.trim()) return;
    setForm(f => ({ ...f, checklist: [...f.checklist, { text: clInput.trim(), done: false }] }));
    setClInput('');
  };

  const handleSave = async (skipClose = false, forceClosed?: boolean) => {
    if (!form.title.trim()) { setFormErr('Title is required.'); return; }
    try {
      const markClosed = forceClosed ?? form.markClosed;
      const payload: CreateTodoPayload = {
        title: form.title.trim(), priority: form.priority,
        dueDate: form.dueDate || undefined, myDay: form.myDay,
        category: form.category, brief: form.brief || undefined,
        checklist: form.checklist,
      };
      if (editingId) {
        const updated = await todosApi.update(editingId, { ...payload, done: markClosed } as any);
        setTodos(prev => prev.map(t => t.id === editingId ? updated : t));
      } else {
        const created = await todosApi.create(payload);
        if (markClosed) {
          const closed = await todosApi.update(created.id, { done: true });
          setTodos(prev => [closed, ...prev]);
        } else {
          setTodos(prev => [created, ...prev]);
        }
      }
      setShowForm(false); setEditingId(null);
      void skipClose;
    } catch { setFormErr('Failed to save.'); }
  };

  const toggleDone = async (todo: Todo) => {
    const u = await todosApi.update(todo.id, { done: todo.done === 0 });
    setTodos(prev => prev.map(t => t.id === todo.id ? u : t));
  };
  const toggleMyDay = async (todo: Todo) => {
    const u = await todosApi.update(todo.id, { myDay: todo.my_day === 0 });
    setTodos(prev => prev.map(t => t.id === todo.id ? u : t));
  };
  const handleDelete = async (id: string) => {
    if (!confirm('Delete this to-do?')) return;
    await todosApi.delete(id);
    setTodos(prev => prev.filter(t => t.id !== id));
  };
  const addCategory = async () => {
    if (!newCatInput.trim()) return;
    try {
      const cat = await todosApi.createCategory(newCatInput.trim());
      setCategories(prev => [...prev, cat]);
      setForm(f => ({ ...f, category: cat.name }));
      setNewCatInput(''); setAddingCat(false);
    } catch {}
  };

  const FILTER_PILLS = [
    { k: 'all',     label: 'All' },
    { k: 'my-day',  label: `☀️ My Day${todoStats.myDay > 0 ? ` (${todoStats.myDay})` : ''}` },
    { k: 'active',  label: `Active (${todoStats.active})` },
    { k: 'today',   label: `Today (${todoStats.today})` },
    { k: 'overdue', label: `⚠️ Overdue (${todoStats.overdue})` },
    { k: 'done',    label: `Done (${todoStats.done})` },
  ];

  return (
    <div className="h-full flex flex-col bg-gray-50 relative">
      {/* Shimmer overlay — keeps DOM alive so no destroy/rebuild on refresh */}
      {todosLoading && (
        <div className="absolute inset-0 z-20 bg-gray-50">
          <ShimmerLoading />
        </div>
      )}

      <div className="bg-white border-b border-gray-200 p-4">
        <div className="space-y-3">
          {/* Row 1 — Search + stats */}
          <div className="flex gap-3 items-center">
            <input
              type="text"
              placeholder="Search to-dos by title, notes, category..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="flex gap-2 text-sm font-medium">
              <div className="bg-blue-50 px-3 py-2 rounded-lg whitespace-nowrap">
                <span className="text-gray-600">Active: </span>
                <span className="text-blue-700 font-bold">{todoStats.active}</span>
              </div>
              <div className="bg-red-50 px-3 py-2 rounded-lg whitespace-nowrap">
                <span className="text-gray-600">Overdue: </span>
                <span className="text-red-700 font-bold">{todoStats.overdue}</span>
              </div>
            </div>
          </div>

          {/* Row 2 — Filter pills + Group By */}
          <div className="flex gap-2 items-center flex-wrap">
            {FILTER_PILLS.map(f => (
              <button key={f.k} onClick={() => setTodoFilter(f.k)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  todoFilter === f.k ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}>{f.label}</button>
            ))}

            <div className="h-6 w-px bg-gray-300" />

            {/* Group By */}
            <div className="relative z-30 filter-dropdown">
              <button onClick={() => setOpenDropdown(openDropdown === 'groupby' ? null : 'groupby')}
                className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm bg-white hover:bg-gray-50 text-left">
                Group By{groupBy !== 'none' ? ` (${GROUP_OPTIONS.find(g => g.key === groupBy)?.label})` : '...'}
              </button>
              {openDropdown === 'groupby' && (
                <div className="absolute z-40 mt-1 bg-white border border-gray-300 rounded-lg shadow-lg p-2 min-w-[200px] max-h-[300px] overflow-y-auto">
                  <input type="text" placeholder="Search..." value={groupBySearch} onChange={e => setGroupBySearch(e.target.value)}
                    className="w-full px-2 py-1 mb-2 border border-gray-300 rounded text-sm" onClick={e => e.stopPropagation()} />
                  <div className="px-2 py-1 rounded cursor-pointer hover:bg-gray-100 text-sm"
                    onClick={() => { setGroupBy('none'); setGroupBySearch(''); setOpenDropdown(null); }}>None</div>
                  {GROUP_OPTIONS.filter(g => g.label.toLowerCase().includes(groupBySearch.toLowerCase())).map(g => (
                    <div key={g.key} className="px-2 py-1 rounded cursor-pointer hover:bg-gray-100 text-sm"
                      onClick={() => { setGroupBy(g.key); setGroupBySearch(''); setOpenDropdown(null); }}>{g.label}</div>
                  ))}
                </div>
              )}
            </div>

            {/* Category filter */}
            <div className="relative z-30 filter-dropdown">
              <button onClick={() => setOpenDropdown(openDropdown === 'category' ? null : 'category')}
                className={`px-3 py-1.5 border rounded-lg text-sm bg-white hover:bg-gray-50 text-left ${
                  catFilter !== 'all' ? 'border-blue-400 text-blue-700' : 'border-gray-300 text-gray-700'
                }`}>
                Category{catFilter !== 'all' ? ` (${catFilter})` : '...'}
              </button>
              {openDropdown === 'category' && (
                <div className="absolute z-40 mt-1 bg-white border border-gray-300 rounded-lg shadow-lg p-2 min-w-[200px] max-h-[300px] overflow-y-auto">
                  <input type="text" placeholder="Search..." value={catSearch} onChange={e => setCatSearch(e.target.value)}
                    className="w-full px-2 py-1 mb-2 border border-gray-300 rounded text-sm" onClick={e => e.stopPropagation()} />
                  <div className="px-2 py-1 rounded cursor-pointer hover:bg-gray-100 text-sm"
                    onClick={() => { setCatFilter('all'); setCatSearch(''); setOpenDropdown(null); }}>All Categories</div>
                  {categories.filter(c => c.name.toLowerCase().includes(catSearch.toLowerCase())).map(c => (
                    <div key={c.id} className="px-2 py-1 rounded cursor-pointer hover:bg-gray-100 text-sm"
                      onClick={() => { setCatFilter(c.name); setCatSearch(''); setOpenDropdown(null); }}>{c.name}</div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex gap-2 ml-auto items-center">
              <button onClick={loadTodos}
                className="px-3 py-1.5 bg-blue-500 text-white rounded-lg text-sm hover:bg-blue-600">🔄 Refresh</button>
              <button onClick={openAdd}
                className="px-4 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700">+ Add To-Do</button>
              <span className="text-sm text-gray-600 whitespace-nowrap">
                {filteredTodos.length} / {todos.length} to-dos
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-auto bg-white">
        {!todosLoading && filteredTodos.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <div className="text-4xl mb-3">📭</div>
            <p className="font-medium">Nothing here</p>
          </div>
        )}

        {!todosLoading && filteredTodos.length > 0 && Array.from(groupedTodos.entries()).map(([groupKey, groupRows]) => {
          const isExpanded = groupBy === 'none' || expandedGroups.has(groupKey);
          return (
            <div key={groupKey} className="border-b border-gray-200">
              {groupBy !== 'none' && (
                <div onClick={() => setExpandedGroups(prev => { const n = new Set(prev); n.has(groupKey) ? n.delete(groupKey) : n.add(groupKey); return n; })}
                  className="bg-gray-50 px-6 py-1.5 cursor-pointer hover:bg-gray-100 transition-colors flex items-center gap-3 sticky top-0 z-10">
                  <span className="text-gray-400 text-sm">{isExpanded ? '▼' : '▶'}</span>
                  <span className="font-semibold text-gray-700 text-sm">{groupKey} ({groupRows.length})</span>
                </div>
              )}
              {isExpanded && (
                <div style={{ minWidth: 'max-content' }}>
                  {/* Table Header */}
                  <div className="flex bg-gray-800 border-b-2 border-gray-900 sticky top-0 z-20 shadow-md">
                    <div className="px-4 py-1.5 text-sm font-bold text-white border-r border-gray-700" style={{ width: 40 }} />
                    <div className="flex-1 px-4 py-1.5 text-left text-sm font-bold text-white border-r border-gray-700">Title</div>
                    <div className="px-4 py-1.5 text-left text-sm font-bold text-white border-r border-gray-700" style={{ width: 120 }}>Due</div>
                    <div className="px-4 py-1.5 text-left text-sm font-bold text-white border-r border-gray-700" style={{ width: 110 }}>Priority</div>
                    <div className="px-4 py-1.5 text-left text-sm font-bold text-white border-r border-gray-700" style={{ width: 130 }}>Category</div>
                    <div className="px-4 py-1.5 text-center text-sm font-bold text-white border-r border-gray-700" style={{ width: 80 }}>Flags</div>
                    <div className="px-4 py-1.5 text-sm font-bold text-white" style={{ width: 90 }} />
                  </div>

                  {/* Rows */}
                  {groupRows.map((todo, index) => {
                    const isDone   = todo.done === 1;
                    const isMyDay  = todo.my_day === 1;
                    const t = todayD();
                    const d = parseLocalDate(todo.due_date);
                    const overdue  = Boolean(d) && !isDone && d! < t;
                    const dueToday = Boolean(d) && !isDone && d!.getTime() === t.getTime();
                    const baseBg = isDone ? 'bg-gray-50 opacity-60' : overdue ? 'bg-red-100' : dueToday ? 'bg-orange-100' : (index % 2 === 0 ? 'bg-white' : 'bg-gray-50');
                    return (
                      <div key={todo.id}
                        className={`flex border-b border-gray-100 hover:opacity-90 transition-colors cursor-pointer ${baseBg}`}
                        onClick={() => openEdit(todo)}>
                        {/* Done checkbox */}
                        <div className="px-4 py-3 flex items-center justify-center border-r border-gray-100" style={{ width: 40 }}>
                          <button onClick={e => { e.stopPropagation(); void toggleDone(todo); }}
                            className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                              isDone ? 'bg-green-500 border-green-500' : 'border-gray-400 hover:border-blue-500'
                            }`}>
                            {isDone && <span className="text-white text-xs">✓</span>}
                          </button>
                        </div>
                        {/* Title */}
                        <div className="flex-1 px-4 py-3 border-r border-gray-100 text-sm" style={{ whiteSpace: 'normal', wordBreak: 'break-word' }}>
                          <span className={`font-medium ${isDone ? 'line-through text-gray-400' : 'text-gray-800'}`}>{todo.title}</span>
                          {todo.brief && <span className="ml-2 text-xs text-gray-400">{todo.brief}</span>}
                        </div>
                        {/* Due */}
                        <div className={`px-4 py-3 border-r border-gray-100 text-sm whitespace-nowrap ${overdue ? 'text-red-600 font-semibold' : dueToday ? 'text-orange-600 font-semibold' : 'text-gray-500'}`} style={{ width: 120 }}>
                          {overdue && '⚠️ '}{fmtDate(d)}
                        </div>
                        {/* Priority */}
                        <div className="px-4 py-3 border-r border-gray-100 text-sm" style={{ width: 110 }}>
                          <span className={`text-xs px-1.5 py-0.5 rounded-full border ${
                            todo.priority === 'high' ? 'bg-red-50 text-red-700 border-red-300' :
                            todo.priority === 'low'  ? 'bg-green-50 text-green-700 border-green-300' :
                            'bg-yellow-50 text-yellow-700 border-yellow-300'
                          }`}>{todo.priority}</span>
                        </div>
                        {/* Category */}
                        <div className="px-4 py-3 border-r border-gray-100 text-xs text-gray-500" style={{ width: 130 }}>{todo.category || '—'}</div>
                        {/* Flags */}
                        <div className="px-4 py-3 border-r border-gray-100 text-center" style={{ width: 80 }}>
                          <button onClick={e => { e.stopPropagation(); void toggleMyDay(todo); }} title="My Day"
                            className={`text-base ${isMyDay ? 'text-yellow-500' : 'text-gray-300 hover:text-yellow-400'}`}>☀️</button>
                        </div>
                        {/* Actions */}
                        <div className="px-4 py-3" style={{ width: 90 }}>
                          <div className="flex gap-1 justify-end">
                            <button onClick={e => { e.stopPropagation(); openEdit(todo); }} className="p-1 text-gray-400 hover:text-blue-600">✏️</button>
                            <button onClick={e => { e.stopPropagation(); void handleDelete(todo.id); }} className="p-1 text-gray-400 hover:text-red-600">🗑</button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ══ ADD / EDIT FORM ══════════════════════════════════════════════════ */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={closeForm}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-800">
                {editingId ? 'Edit To-Do' : 'Add To-Do'}
              </h3>
              <div className="flex gap-2 items-center">
                {editingId && (
                  <button onClick={() => void handleSave(false, true)}
                    className="px-4 py-2 text-sm bg-gray-700 text-white font-medium rounded-lg hover:bg-gray-800">
                    Closed
                  </button>
                )}
                {!editingId && (
                  <button onClick={() => void handleSave()}
                    className="px-5 py-2 text-sm bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700">
                    Add To-Do
                  </button>
                )}
                <button onClick={() => { setShowForm(false); setEditingId(null); }}
                  className="w-8 h-8 flex items-center justify-center text-gray-500 hover:bg-gray-100 rounded-lg text-lg font-medium">
                  ✕
                </button>
              </div>
            </div>

            {formErr && <p className="text-red-600 text-xs mb-3">{formErr}</p>}

            <div className="space-y-4">
              {/* Title */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Title <span className="text-red-500">*</span></label>
                <input type="text" value={form.title} autoFocus
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="What needs to be done?" />
              </div>

              {/* Due date + My Day */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Due Date</label>
                <div className="flex gap-2 items-center">
                  <input type="date" value={form.dueDate}
                    onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  <button onClick={() => setForm(f => ({ ...f, myDay: !f.myDay }))}
                    className={`px-3 py-2 rounded-lg border text-sm font-medium transition-colors whitespace-nowrap ${
                      form.myDay ? 'bg-yellow-400 text-white border-yellow-400' : 'bg-white text-gray-600 border-gray-300 hover:bg-yellow-50'
                    }`}>☀️ My Day</button>
                </div>
              </div>

              {/* Checklist */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-2">Checklist</label>
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  {form.checklist.length > 0 && (
                    <div className="divide-y divide-gray-100">
                      {form.checklist.map((item, idx) => (
                        <div key={idx} className="flex items-center gap-2 px-3 py-2">
                          <input type="checkbox" checked={item.done}
                            onChange={() => setForm(f => ({ ...f, checklist: f.checklist.map((c, i) => i === idx ? { ...c, done: !c.done } : c) }))}
                            className="w-4 h-4 rounded" />
                          <span className={`flex-1 text-sm ${item.done ? 'line-through text-gray-400' : 'text-gray-700'}`}>{item.text}</span>
                          <button onClick={() => setForm(f => ({ ...f, checklist: f.checklist.filter((_, i) => i !== idx) }))}
                            className="text-gray-400 hover:text-red-500 text-xs">✕</button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2 p-2 bg-gray-50">
                    <input type="text" value={clInput} placeholder="Add a step…"
                      onChange={e => setClInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && addCLItem()}
                      className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
                    <button onClick={addCLItem} className="px-3 py-1 bg-blue-500 text-white text-sm rounded hover:bg-blue-600">+</button>
                  </div>
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Notes</label>
                <textarea value={form.brief} rows={2}
                  onChange={e => setForm(f => ({ ...f, brief: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  placeholder="Optional notes…" />
              </div>

              {/* Category */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Category</label>
                <div className="flex gap-2">
                  <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                  </select>
                  {!addingCat ? (
                    <button onClick={() => setAddingCat(true)}
                      className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-blue-600 hover:bg-blue-50">+ New</button>
                  ) : (
                    <div className="flex gap-1">
                      <input type="text" value={newCatInput} autoFocus
                        onChange={e => setNewCatInput(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') addCategory(); if (e.key === 'Escape') setAddingCat(false); }}
                        placeholder="Category name" className="px-2 py-1 border border-blue-400 rounded text-sm w-32 focus:outline-none" />
                      <button onClick={addCategory} className="px-2 text-green-600 hover:text-green-800 font-bold">✓</button>
                      <button onClick={() => setAddingCat(false)} className="px-2 text-gray-400 hover:text-gray-600">✕</button>
                    </div>
                  )}
                </div>
              </div>

              {/* Priority quick buttons */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-2">Priority</label>
                <div className="flex gap-2">
                  {PRI_BTNS.map(b => (
                    <button key={b.v} onClick={() => setForm(f => ({ ...f, priority: b.v }))}
                      className={`px-4 py-1.5 rounded-lg border text-sm font-medium transition-colors ${
                        form.priority === b.v ? b.active : b.inactive
                      }`}>{b.label}</button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default memo(TodoPage);
