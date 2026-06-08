import React, { useState, useEffect, useMemo, memo } from 'react';
import ReactMarkdown from 'react-markdown';
import ShimmerLoading from './ShimmerLoading';
import { JiraIssue, Todo, TodoCategory, TodoPriority, CreateTodoPayload, DailySummary } from '../types';
import { jiraApi, todosApi, dailySummaryApi } from '../services/api';
import { parseLocalDate } from '../utils/dateUtils';

// ─── Types ───────────────────────────────────────────────────────────────────
type HomeInnerTab = 'quickview' | 'todos';
type GroupBy = 'none' | 'assignee' | 'client' | 'issueType' | 'status' | 'release';
type ActionRow = { kind: 'jira'; issue: JiraIssue } | { kind: 'todo'; todo: Todo };
type SortCol = 'source' | 'key' | 'summary' | 'status' | 'assignee' | 'dueDate' | 'uat' | 'release';
type SortDir = 'asc' | 'desc';

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

export interface HomeTabProps {
  sprintIssues: JiraIssue[];
  myIssues: JiraIssue[];
  sprintLoading: boolean;
  myLoading: boolean;
  onRefresh: () => void;
  addTodoTrigger?: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
const todayD = (): Date => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const todayStr = () => new Date().toISOString().slice(0, 10);
const fmtDate = (d: Date | null) => d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';

const isOnOrBefore = (s: string | null | undefined, ref: Date): boolean => {
  if (!s || s === 'NA') return false;
  const d = parseLocalDate(s);
  return d ? d <= ref : false;
};
const isAfterAndOnOrBefore = (s: string | null | undefined, after: Date, onOrBefore: Date): boolean => {
  if (!s || s === 'NA') return false;
  const d = parseLocalDate(s);
  return d ? d > after && d <= onOrBefore : false;
};
const dateTriggerCls = (s: string | null | undefined): string => {
  if (!s || s === 'NA') return 'text-gray-400';
  const d = parseLocalDate(s);
  if (!d) return 'text-gray-400';
  const t = todayD();
  if (d < t) return 'text-red-600 font-semibold';
  if (d.getTime() === t.getTime()) return 'text-orange-600 font-semibold';
  return 'text-yellow-700 font-semibold';
};

const getGroupVal = (row: ActionRow, by: GroupBy): string => {
  if (by === 'none') return 'All';
  if (row.kind === 'todo') {
    const map: Record<GroupBy, string> = { none: 'All', assignee: 'Me', client: 'N/A', issueType: 'Task', status: row.todo.done === 1 ? 'CLOSED' : 'TO DO', release: row.todo.due_date || 'No Release' };
    return map[by];
  }
  const i = row.issue;
  if (by === 'assignee') return i.assignee || 'Unassigned';
  if (by === 'client')   return i.client || 'N/A';
  if (by === 'issueType') return i.issueType || 'Other';
  if (by === 'status')   return i.status || 'Unknown';
  if (by === 'release')  return (i.releaseDate && i.releaseDate !== 'NA') ? i.releaseDate : 'No Release';
  return 'All';
};

const groupRows = (rows: ActionRow[], by: GroupBy): Map<string, ActionRow[]> => {
  const m = new Map<string, ActionRow[]>();
  for (const row of rows) {
    const key = getGroupVal(row, by);
    if (!m.has(key)) m.set(key, []);
    m.get(key)!.push(row);
  }
  return m;
};

const INIT_FORM = (): FormState => ({
  title: '', priority: 'medium', dueDate: todayStr(),
  myDay: false, markClosed: false, category: 'Tasks', brief: '', checklist: [],
});

const PRI_BTNS: { v: TodoPriority; label: string; active: string; inactive: string }[] = [
  { v: 'high',   label: '🔴 High',   active: 'bg-red-600 text-white border-red-600',       inactive: 'bg-white text-red-700 border-red-300 hover:bg-red-50' },
  { v: 'medium', label: '🟡 Medium', active: 'bg-yellow-500 text-white border-yellow-500', inactive: 'bg-white text-yellow-700 border-yellow-300 hover:bg-yellow-50' },
  { v: 'low',    label: '🟢 Low',    active: 'bg-green-600 text-white border-green-600',   inactive: 'bg-white text-green-700 border-green-300 hover:bg-green-50' },
];

const SOURCE_BADGE: Record<string, React.ReactElement> = {
  sprint: <span className="px-1.5 py-0.5 rounded text-xs bg-blue-100 text-blue-700 font-medium">Sprint</span>,
  me:     <span className="px-1.5 py-0.5 rounded text-xs bg-purple-100 text-purple-700 font-medium">Me</span>,
  todo:   <span className="px-1.5 py-0.5 rounded text-xs bg-green-100 text-green-700 font-medium">Task</span>,
  slack:  <span className="px-1.5 py-0.5 rounded text-xs bg-orange-100 text-orange-700 font-medium">Slack</span>,
  jira:   <span className="px-1.5 py-0.5 rounded text-xs bg-gray-100 text-gray-600 font-medium">Jira</span>,
};

// ─── Main Component ──────────────────────────────────────────────────────────
const HomeTab: React.FC<HomeTabProps> = ({ sprintIssues, myIssues, sprintLoading, myLoading, onRefresh, addTodoTrigger }) => {
  const [innerTab, setInnerTab]       = useState<HomeInnerTab>('quickview');

  // Quick View filters
  const [importantOnly, setImportantOnly] = useState(false);
  const [feTeamOnly, setFeTeamOnly]       = useState(false);
  const [meOnly, setMeOnly]               = useState(false);
  const [compFilter, setCompFilter]       = useState<string[]>([]);
  const [compOpen, setCompOpen]           = useState(false);
  const [compSearch, setCompSearch]       = useState('');
  const [groupBy, setGroupBy]             = useState<GroupBy>('none');
  const [feTeamMembers, setFETeamMembers] = useState<string[]>([]);
  const [statusFilter, setStatusFilter]   = useState<string[]>([]);
  const [statusOpen, setStatusOpen]       = useState(false);
  const [tableSortCol, setTableSortCol]   = useState<SortCol | null>(null);
  const [tableSortDir, setTableSortDir]   = useState<SortDir>('asc');

  // Todos
  const [todos, setTodos]               = useState<Todo[]>([]);
  const [categories, setCategories]     = useState<TodoCategory[]>([{ id: 'cat-tasks', name: 'Tasks', created_at: '' }]);
  const [todosLoading, setTodosLoading] = useState(false);
  const [todoFilter, setTodoFilter]     = useState('active');
  const [catFilter, setCatFilter]       = useState('all');
  const [showForm, setShowForm]         = useState(false);
  const [editingId, setEditingId]       = useState<string | null>(null);
  const [form, setForm]                 = useState<FormState>(INIT_FORM());
  const [clInput, setClInput]           = useState('');
  const [newCatInput, setNewCatInput]   = useState('');
  const [addingCat, setAddingCat]       = useState(false);
  const [formErr, setFormErr]           = useState<string | null>(null);
  const [expanded, setExpanded]         = useState<Set<string>>(new Set());
  const [asapOpen, setAsapOpen]           = useState(false);
  const [attnOpen, setAttnOpen]           = useState(false);
  const [aiSummaryOpen, setAiSummaryOpen] = useState(false);
  const [aiSummary, setAiSummary] = useState<DailySummary | null>(null);
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false);
  const [aiSummaryError, setAiSummaryError] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [importantOverrides, setImportantOverrides] = useState<Map<string, boolean>>(new Map());

  useEffect(() => {
    jiraApi.getAllFETeamFlags()
      .then(flags => setFETeamMembers(Object.keys(flags).filter(a => flags[a])))
      .catch(() => {});
    loadTodos();
    todosApi.getCategories().then(setCategories).catch(() => {});
  }, []);

  const loadTodos = async () => {
    setTodosLoading(true);
    try { setTodos(await todosApi.getAll()); } catch {} finally { setTodosLoading(false); }
  };

  // Close component dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.comp-dropdown') &&
          !(e.target as HTMLElement).closest('.status-dropdown')) {
        setCompOpen(false); setStatusOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => { setExpandedGroups(new Set()); }, [groupBy]);

  useEffect(() => {
    if (!aiSummaryOpen || aiSummaryLoading) return;
    setAiSummaryLoading(true);
    setAiSummaryError(null);
    dailySummaryApi.getLatest()
      .then(setAiSummary)
      .catch(err => setAiSummaryError(err instanceof Error ? err.message : 'Failed to load summary'))
      .finally(() => setAiSummaryLoading(false));
  }, [aiSummaryOpen]);

  // Open todos + add form when triggered from FAB
  useEffect(() => {
    if (!addTodoTrigger) return;
    setInnerTab('todos');
    setEditingId(null); setForm(INIT_FORM()); setClInput(''); setFormErr(null); setShowForm(true);
  }, [addTodoTrigger]);

  // ── Sprint stats ─────────────────────────────────────────────────────────
  const sprintStats = useMemo(() => {
    const total = sprintIssues.length;
    const done  = sprintIssues.filter(i => i.statusCategory?.toLowerCase() === 'done').length;
    const inProg = sprintIssues.filter(i => {
      const sc = (i.statusCategory ?? '').toLowerCase();
      return sc !== 'done' && sc !== 'to do' && sc !== 'todo';
    }).length;
    const todo = total - done - inProg;
    return { total, done, inProg, todo };
  }, [sprintIssues]);

  // ── Merged issues ────────────────────────────────────────────────────────
  const myIssueKeys = useMemo(() => new Set(myIssues.map(i => i.key)), [myIssues]);

  const allIssues = useMemo(() => {
    const seen = new Set<string>();
    const out: JiraIssue[] = [];
    for (const i of sprintIssues) { seen.add(i.key); out.push({ ...i, source: 'sprint' as const }); }
    for (const i of myIssues)     { if (!seen.has(i.key)) { seen.add(i.key); out.push({ ...i, source: 'me' as const }); } }
    return out;
  }, [sprintIssues, myIssues]);

  const filteredIssues = useMemo(() => {
    let r = allIssues.filter(i => i.statusCategory !== 'Done');
    if (importantOnly) r = r.filter(i => i.important);
    if (feTeamOnly)    r = r.filter(i => feTeamMembers.includes(i.assignee));
    if (meOnly)        r = r.filter(i => myIssueKeys.has(i.key));
    if (compFilter.length > 0) r = r.filter(i => i.components.some(c => compFilter.includes(c)));
    if (statusFilter.length > 0) r = r.filter(i => statusFilter.includes(i.status));
    return r;
  }, [allIssues, importantOnly, feTeamOnly, meOnly, compFilter, statusFilter, feTeamMembers, myIssueKeys]);

  // ── Action sections ──────────────────────────────────────────────────────
  const { asapRows, attentionRows } = useMemo(() => {
    const t  = todayD();
    const t3 = new Date(t); t3.setDate(t3.getDate() + 3);

    const jiraAsap: ActionRow[] = filteredIssues
      .filter(i => isOnOrBefore(i.dueDate, t) || isOnOrBefore(i.plannedUatDate, t) ||
                   (i.releaseDate !== 'NA' && isOnOrBefore(i.releaseDate, t)))
      .map(i => ({ kind: 'jira' as const, issue: i }));

    const todoAsap: ActionRow[] = todos
      .filter(td => td.type === 'task' && td.done === 0 && isOnOrBefore(td.due_date, t) &&
                    (!importantOnly || td.my_day === 1))
      .map(td => ({ kind: 'todo' as const, todo: td }));

    const asapJiraKeys = new Set(jiraAsap.map(r => r.kind === 'jira' ? r.issue.key : '').filter(Boolean));

    const jiraAttn: ActionRow[] = filteredIssues
      .filter(i => !asapJiraKeys.has(i.key) && (
        isAfterAndOnOrBefore(i.dueDate, t, t3) ||
        isAfterAndOnOrBefore(i.plannedUatDate, t, t3) ||
        (i.releaseDate !== 'NA' && isAfterAndOnOrBefore(i.releaseDate, t, t3))
      ))
      .map(i => ({ kind: 'jira' as const, issue: i }));

    const todoAttn: ActionRow[] = todos
      .filter(td => td.type === 'task' && td.done === 0 && isAfterAndOnOrBefore(td.due_date, t, t3) &&
                    (!importantOnly || td.my_day === 1))
      .map(td => ({ kind: 'todo' as const, todo: td }));

    return { asapRows: [...jiraAsap, ...todoAsap], attentionRows: [...jiraAttn, ...todoAttn] };
  }, [filteredIssues, todos, importantOnly]);

  const uniqueComponents = useMemo(() =>
    Array.from(new Set(allIssues.flatMap(i => i.components))).filter(Boolean).sort(),
    [allIssues]);

  const uniqueStatuses = useMemo(() =>
    Array.from(new Set(allIssues.map(i => i.status))).filter(Boolean).sort(),
    [allIssues]);

  // ── Filtered todos ───────────────────────────────────────────────────────
  const filteredTodos = useMemo(() => {
    const t = todayD();
    let r = todos;
    if (todoFilter === 'slack')              return r.filter(td => td.type === 'slack');
    if (todoFilter === 'jira-notification')  return r.filter(td => td.type === 'jira-notification');
    if (todoFilter === 'my-day')   r = r.filter(td => td.my_day === 1 && td.done === 0);
    else if (todoFilter === 'active')   r = r.filter(td => td.done === 0);
    else if (todoFilter === 'today')    r = r.filter(td => { const d=parseLocalDate(td.due_date); return td.done===0&&d?d.getTime()===t.getTime():false; });
    else if (todoFilter === 'overdue')  r = r.filter(td => { const d=parseLocalDate(td.due_date); return td.done===0&&d?d<t:false; });
    else if (todoFilter === 'done')     r = r.filter(td => td.done === 1);
    if (catFilter !== 'all') r = r.filter(td => td.type !== 'task' || td.category === catFilter);
    return r;
  }, [todos, todoFilter, catFilter]);

  const todoStats = useMemo(() => {
    const t = todayD();
    const tasks  = todos.filter(td => td.type === 'task');
    const active = tasks.filter(td => td.done === 0);
    return {
      myDay:   active.filter(td => td.my_day === 1).length,
      active:  active.length,
      today:   active.filter(td => { const d=parseLocalDate(td.due_date); return d?d.getTime()===t.getTime():false; }).length,
      overdue: active.filter(td => { const d=parseLocalDate(td.due_date); return d?d<t:false; }).length,
      done:    tasks.filter(td => td.done === 1).length,
      slack:   todos.filter(td => td.type === 'slack').length,
      jira:    todos.filter(td => td.type === 'jira-notification').length,
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
  const closeForm = () => { setShowForm(false); setEditingId(null); };

  const addCLItem = () => {
    if (!clInput.trim()) return;
    setForm(f => ({ ...f, checklist: [...f.checklist, { text: clInput.trim(), done: false }] }));
    setClInput('');
  };

  const handleSave = async () => {
    if (!form.title.trim()) { setFormErr('Title is required.'); return; }
    try {
      const payload: CreateTodoPayload = {
        title: form.title.trim(), priority: form.priority,
        dueDate: form.dueDate || undefined, myDay: form.myDay,
        category: form.category, brief: form.brief || undefined,
        checklist: form.checklist,
      };
      if (editingId) {
        const updated = await todosApi.update(editingId, { ...payload, done: form.markClosed } as any);
        setTodos(prev => prev.map(t => t.id === editingId ? updated : t));
      } else {
        const created = await todosApi.create(payload);
        if (form.markClosed) {
          const closed = await todosApi.update(created.id, { done: true });
          setTodos(prev => [closed, ...prev]);
        } else {
          setTodos(prev => [created, ...prev]);
        }
      }
      closeForm();
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
  const toggleCheckItem = async (todo: Todo, idx: number) => {
    const cl = todo.checklist.map((c, i) => ({ ...c, done: i === idx ? (c.done === 1 ? false : true) : c.done === 1 }));
    const u = await todosApi.update(todo.id, { checklist: cl } as any);
    setTodos(prev => prev.map(t => t.id === todo.id ? u : t));
  };
  const handleDelete = async (id: string) => {
    if (!confirm('Delete this to-do?')) return;
    await todosApi.delete(id);
    setTodos(prev => prev.filter(t => t.id !== id));
  };

  const getImportant = (key: string, base?: boolean) =>
    importantOverrides.has(key) ? importantOverrides.get(key)! : (base ?? false);
  const toggleImportant = async (issue: JiraIssue) => {
    const newVal = !getImportant(issue.key, issue.important);
    await jiraApi.setIssueImportant(issue.key, newVal);
    setImportantOverrides(prev => new Map(prev).set(issue.key, newVal));
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

  // ── Render: Action Section Table ─────────────────────────────────────────
  const renderActionTable = (rows: ActionRow[], sType: 'asap' | 'attention') => {
    if (rows.length === 0) return (
      <div className="text-center py-8 text-gray-400 text-sm">🎉 Nothing here</div>
    );
    const t  = todayD();
    const t3 = new Date(t); t3.setDate(t3.getDate() + 3);

    const getRowVal = (row: ActionRow, col: SortCol): string => {
      if (row.kind === 'jira') {
        const i = row.issue;
        if (col === 'source')  return i.source || '';
        if (col === 'key')     return i.key || '';
        if (col === 'summary') return i.summary || '';
        if (col === 'status')  return i.status || '';
        if (col === 'assignee') return i.assignee || '';
        if (col === 'dueDate') return i.dueDate || '';
        if (col === 'uat')     return i.plannedUatDate || '';
        if (col === 'release') return (i.releaseDate !== 'NA' ? i.releaseDate : '') || '';
      } else {
        const td = row.todo;
        if (col === 'source')  return 'todo';
        if (col === 'key')     return '';
        if (col === 'summary') return td.title || '';
        if (col === 'status')  return td.done === 1 ? 'CLOSED' : 'TO DO';
        if (col === 'assignee') return 'Me';
        if (col === 'dueDate') return td.due_date || '';
        if (col === 'uat')     return '';
        if (col === 'release') return '';
      }
      return '';
    };

    const toggleSort = (col: SortCol) => {
      setTableSortCol(prev => {
        if (prev === col) { setTableSortDir(d => d === 'asc' ? 'desc' : 'asc'); return col; }
        setTableSortDir('asc'); return col;
      });
    };

    const sortedRows = tableSortCol
      ? [...rows].sort((a, b) => {
          const va = getRowVal(a, tableSortCol);
          const vb = getRowVal(b, tableSortCol);
          const cmp = va.localeCompare(vb);
          return tableSortDir === 'asc' ? cmp : -cmp;
        })
      : rows;

    const grouped = groupRows(sortedRows, groupBy);

    const SortTh = ({ col, label, cls = '' }: { col: SortCol; label: string; cls?: string }) => (
      <th className={`px-3 py-2 text-left cursor-pointer select-none hover:bg-gray-100 whitespace-nowrap ${cls}`}
        onClick={() => toggleSort(col)}>
        {label}
        <span className="ml-1 text-gray-400">
          {tableSortCol === col ? (tableSortDir === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </th>
    );

    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
            <tr>
              <SortTh col="source"  label="Source"        cls="w-20" />
              <SortTh col="key"     label="Key"           cls="w-28" />
              <SortTh col="summary" label="Summary/Title" />
              <SortTh col="status"  label="Status"        cls="w-36" />
              <SortTh col="assignee" label="Assignee"     cls="w-36" />
              <SortTh col="dueDate" label="Due"           cls="w-24" />
              <SortTh col="uat"     label="UAT"           cls="w-24" />
              <SortTh col="release" label="Release"       cls="w-24" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {Array.from(grouped.entries()).map(([grp, grpRows]) => {
              const groupKey = `${sType}-${grp}`;
              const isGrpExpanded = groupBy === 'none' || expandedGroups.has(groupKey);
              return (
              <React.Fragment key={grp}>
                {groupBy !== 'none' && (
                  <tr className="cursor-pointer select-none hover:bg-gray-200"
                    onClick={() => setExpandedGroups(prev => {
                      const n = new Set(prev); n.has(groupKey) ? n.delete(groupKey) : n.add(groupKey); return n;
                    })}>
                    <td colSpan={8} className="px-3 py-1.5 bg-gray-100 text-xs font-semibold text-gray-600 uppercase tracking-wide">
                      <span className="mr-2 text-gray-400">{isGrpExpanded ? '▼' : '▶'}</span>{grp} ({grpRows.length})
                    </td>
                  </tr>
                )}
                {isGrpExpanded && grpRows.map(row => {
                  if (row.kind === 'jira') {
                    const i = row.issue;
                    const checkTrig = sType === 'asap'
                      ? (s: string | null | undefined) => isOnOrBefore(s, t)
                      : (s: string | null | undefined) => isAfterAndOnOrBefore(s, t, t3);
                    const dueTrig = checkTrig(i.dueDate);
                    const uatTrig = checkTrig(i.plannedUatDate);
                    const relTrig = i.releaseDate !== 'NA' && checkTrig(i.releaseDate);
                    return (
                      <tr key={i.key} className="hover:bg-gray-50">
                        <td className="px-3 py-2">{SOURCE_BADGE[i.source || 'sprint']}</td>
                        <td className="px-3 py-2 font-mono text-blue-600 whitespace-nowrap">
                          <a href={i.url} target="_blank" rel="noreferrer" className="hover:underline">{i.key}</a>
                          <button onClick={e => { e.stopPropagation(); void toggleImportant(i); }}
                            className={`ml-1 text-sm ${getImportant(i.key, i.important) ? 'text-yellow-400' : 'text-gray-200 hover:text-yellow-300'}`}>⭐</button>
                        </td>
                        <td className="px-3 py-2 text-gray-800 max-w-xs truncate" title={i.summary}>{i.summary}</td>
                        <td className="px-3 py-2 text-gray-600 truncate">{i.status}</td>
                        <td className="px-3 py-2 text-gray-600 truncate">{i.assignee}</td>
                        <td className={`px-3 py-2 whitespace-nowrap ${dueTrig ? dateTriggerCls(i.dueDate) : 'text-gray-400'}`}>
                          {fmtDate(parseLocalDate(i.dueDate))}
                        </td>
                        <td className={`px-3 py-2 whitespace-nowrap ${uatTrig ? dateTriggerCls(i.plannedUatDate) : 'text-gray-400'}`}>
                          {i.plannedUatDate ? fmtDate(parseLocalDate(i.plannedUatDate)) : '—'}
                        </td>
                        <td className={`px-3 py-2 whitespace-nowrap ${relTrig ? dateTriggerCls(i.releaseDate) : 'text-gray-400'}`}>
                          {i.releaseDate && i.releaseDate !== 'NA' ? fmtDate(parseLocalDate(i.releaseDate)) : '—'}
                        </td>
                      </tr>
                    );
                  } else {
                    const td = row.todo;
                    const checkTrig = sType === 'asap'
                      ? (s: string | null | undefined) => isOnOrBefore(s, t)
                      : (s: string | null | undefined) => isAfterAndOnOrBefore(s, t, t3);
                    const dueTrig = checkTrig(td.due_date);
                    return (
                      <tr key={td.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => { setInnerTab('todos'); openEdit(td); }}>
                        <td className="px-3 py-2">{SOURCE_BADGE.todo}</td>
                        <td className="px-3 py-2 text-gray-400">—</td>
                        <td className="px-3 py-2 text-gray-800 max-w-xs truncate" title={td.title}>{td.title}</td>
                        <td className="px-3 py-2 text-gray-400">{td.done === 1 ? 'CLOSED' : 'TO DO'}</td>
                        <td className="px-3 py-2 text-gray-400">Me</td>
                        <td className={`px-3 py-2 whitespace-nowrap ${dueTrig ? dateTriggerCls(td.due_date) : 'text-gray-400'}`}>
                          {fmtDate(parseLocalDate(td.due_date))}
                        </td>
                        <td className="px-3 py-2 text-gray-400">—</td>
                        <td className="px-3 py-2 text-gray-400">—</td>
                      </tr>
                    );
                  }
                })}
              </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  // ── Main render ───────────────────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col bg-gray-50 relative">
      {/* Shimmer overlay — keeps DOM alive so no destroy/rebuild on refresh */}
      {(sprintLoading || myLoading) && (
        <div className="absolute inset-0 z-20 bg-gray-50">
          <ShimmerLoading />
        </div>
      )}
      {/* Inner tab bar */}
      <div className="bg-white border-b border-gray-200 px-6 pt-3 pb-0 flex gap-1">
        {([
          { id: 'quickview', label: '⚡ Quick View' },
          { id: 'todos',     label: `✅ To-Dos${todoStats.active > 0 ? ` (${todoStats.active})` : ''}` },
        ] as { id: HomeInnerTab; label: string }[]).map(t => (
          <button key={t.id} onClick={() => setInnerTab(t.id)}
            className={`px-5 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
              innerTab === t.id
                ? 'border-blue-600 text-blue-700 bg-blue-50'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}>{t.label}</button>
        ))}
      </div>

      {/* ══ QUICK VIEW ═══════════════════════════════════════════════════════ */}
      {innerTab === 'quickview' && (
        <div className="flex-1 overflow-auto flex flex-col">
          {/* Filters bar */}
          <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-2 flex-wrap">
            {/* Important Only */}
            <button onClick={() => setImportantOnly(!importantOnly)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                importantOnly ? 'bg-yellow-500 text-white' : 'bg-yellow-50 text-yellow-800 hover:bg-yellow-100'
              }`}>⭐ Important Only</button>

            {/* FE Team */}
            <button onClick={() => setFeTeamOnly(!feTeamOnly)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                feTeamOnly ? 'bg-purple-600 text-white' : 'bg-purple-50 text-purple-800 hover:bg-purple-100'
              }`}>👥 FE Team</button>

            {/* Me */}
            <button onClick={() => setMeOnly(!meOnly)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                meOnly ? 'bg-blue-600 text-white' : 'bg-blue-50 text-blue-800 hover:bg-blue-100'
              }`}>🙋 Me</button>

            {/* Component filter */}
            <div className="relative comp-dropdown">
              <button onClick={() => setCompOpen(!compOpen)}
                className={`px-3 py-1.5 border rounded-lg text-sm bg-white hover:bg-gray-50 ${
                  compFilter.length > 0 ? 'border-blue-400 text-blue-700' : 'border-gray-300 text-gray-700'
                }`}>
                Component{compFilter.length > 0 ? ` (${compFilter.length})` : '…'}
              </button>
              {compOpen && (
                <div className="absolute z-40 mt-1 bg-white border border-gray-300 rounded-lg shadow-lg p-2 w-56 max-h-72 overflow-y-auto">
                  <input type="text" placeholder="Search…" value={compSearch}
                    onChange={e => setCompSearch(e.target.value)}
                    className="w-full px-2 py-1 mb-2 border border-gray-300 rounded text-sm" />
                  {uniqueComponents.filter(c => c.toLowerCase().includes(compSearch.toLowerCase())).map(c => (
                    <label key={c} className="flex items-center gap-2 px-2 py-1 rounded cursor-pointer hover:bg-gray-100">
                      <input type="checkbox" checked={compFilter.includes(c)}
                        onChange={() => setCompFilter(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c])}
                        className="w-4 h-4" />
                      <span className="text-sm">{c}</span>
                    </label>
                  ))}
                  {compFilter.length > 0 && (
                    <button onClick={() => setCompFilter([])} className="w-full mt-1 text-xs text-red-500 hover:text-red-700">Clear</button>
                  )}
                </div>
              )}
            </div>

            {/* Status filter */}
            <div className="relative status-dropdown">
              <button onClick={() => setStatusOpen(!statusOpen)}
                className={`px-3 py-1.5 border rounded-lg text-sm bg-white hover:bg-gray-50 ${
                  statusFilter.length > 0 ? 'border-blue-400 text-blue-700' : 'border-gray-300 text-gray-700'
                }`}>
                Status{statusFilter.length > 0 ? ` (${statusFilter.length})` : '…'}
              </button>
              {statusOpen && (
                <div className="absolute z-40 mt-1 bg-white border border-gray-300 rounded-lg shadow-lg p-2 w-52 max-h-72 overflow-y-auto">
                  {uniqueStatuses.map(s => (
                    <label key={s} className="flex items-center gap-2 px-2 py-1 rounded cursor-pointer hover:bg-gray-100">
                      <input type="checkbox" checked={statusFilter.includes(s)}
                        onChange={() => setStatusFilter(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])}
                        className="w-4 h-4" />
                      <span className="text-sm">{s}</span>
                    </label>
                  ))}
                  {statusFilter.length > 0 && (
                    <button onClick={() => setStatusFilter([])} className="w-full mt-1 text-xs text-red-500 hover:text-red-700">Clear</button>
                  )}
                </div>
              )}
            </div>

            {/* Group By */}
            <div className="flex rounded-lg border border-gray-300 overflow-hidden text-sm ml-2">
              {(['none','assignee','client','issueType','status','release'] as GroupBy[]).map(g => (
                <button key={g} onClick={() => setGroupBy(g)}
                  className={`px-3 py-1.5 transition-colors ${
                    groupBy === g ? 'bg-gray-700 text-white' : 'bg-white text-gray-600 hover:bg-gray-100'
                  }`}>
                  {g === 'none' ? 'No Group' : g === 'issueType' ? 'Type' : g === 'release' ? 'Release' : g.charAt(0).toUpperCase() + g.slice(1)}
                </button>
              ))}
            </div>

            <button onClick={() => { onRefresh(); loadTodos(); }}
              className="ml-auto px-3 py-1.5 bg-blue-500 text-white text-sm rounded-lg hover:bg-blue-600">
              🔄 Refresh
            </button>
          </div>

          {/* Stats strip — Sprint State */}
          <div className="bg-white border-b border-gray-100 px-6 py-2 flex items-center gap-6 text-sm">
            <span className="text-gray-500 font-medium">Sprint:</span>
            <span className="text-gray-600">Total <strong className="text-gray-900">{sprintStats.total}</strong></span>
            <span className="text-blue-600">In Progress <strong>{sprintStats.inProg}</strong></span>
            <span className="text-gray-500">To Do <strong>{sprintStats.todo}</strong></span>
            <span className="text-green-600">Done <strong>{sprintStats.done}</strong></span>
            <div className="h-4 w-px bg-gray-200 mx-1" />
            <span className={asapRows.length > 0 ? 'text-red-600' : 'text-gray-400'}>
              🚨 <strong>{asapRows.length}</strong> ASAP
            </span>
            <span className={attentionRows.length > 0 ? 'text-yellow-600' : 'text-gray-400'}>
              ⚠️ <strong>{attentionRows.length}</strong> Attention
            </span>
            {(sprintLoading || myLoading) && <span className="text-gray-400 text-xs ml-auto">⏳ Loading…</span>}
          </div>

          <div className="flex-1 overflow-auto p-4 space-y-4">
            {/* Section 1: AI Summary (top) */}
            <section className="bg-white rounded-xl shadow-sm border border-purple-200 overflow-hidden">
              <div className="px-4 py-3 bg-purple-50 border-b border-purple-200 flex items-center justify-between cursor-pointer select-none"
                onClick={() => setAiSummaryOpen(o => !o)}>
                <h2 className="font-semibold text-purple-800">🤖 AI Summary</h2>
                <span className="text-purple-500 text-sm">{aiSummaryOpen ? '▲' : '▼'}</span>
              </div>
              {aiSummaryOpen && (
                <div className="p-6">
                  {aiSummaryLoading && (
                    <p className="text-sm text-gray-500">Loading latest summary...</p>
                  )}

                  {!aiSummaryLoading && aiSummaryError && (
                    <p className="text-sm text-red-600">{aiSummaryError}</p>
                  )}

                  {!aiSummaryLoading && !aiSummaryError && !aiSummary && (
                    <div className="text-center py-4">
                      <div className="text-4xl mb-2">🤖</div>
                      <p className="font-medium text-gray-500">No daily summary posted yet</p>
                      <p className="text-xs text-gray-400 mt-1">Your scheduled job can POST to /api/daily-summary.</p>
                    </div>
                  )}

                  {!aiSummaryLoading && !aiSummaryError && aiSummary && (
                    <div>
                      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
                        <span className="text-xs text-gray-500">
                          <span className="font-medium">{aiSummary.summaryDate}</span>
                          <span className="mx-2">•</span>
                          <span>{aiSummary.source}</span>
                        </span>
                      </div>
                      <div className="prose prose-sm max-w-none text-gray-700">
                        <ReactMarkdown>{aiSummary.content}</ReactMarkdown>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* Section 2: Needs Action ASAP */}
            <section className="bg-white rounded-xl shadow-sm border border-red-200 overflow-hidden">
              <div className="px-4 py-3 bg-red-50 border-b border-red-200 flex items-center justify-between cursor-pointer select-none"
                onClick={() => setAsapOpen(o => !o)}>
                <h2 className="font-semibold text-red-800 flex items-center gap-2">
                  🚨 Needs Action ASAP
                  <span className="text-xs font-normal bg-red-200 text-red-900 px-2 py-0.5 rounded-full">
                    Due today / Overdue
                  </span>
                </h2>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-bold text-red-700">{asapRows.length} item{asapRows.length !== 1 ? 's' : ''}</span>
                  <span className="text-red-500 text-sm">{asapOpen ? '▲' : '▼'}</span>
                </div>
              </div>
              {asapOpen && renderActionTable(asapRows, 'asap')}
            </section>

            {/* Section 3: Needs Attention */}
            <section className="bg-white rounded-xl shadow-sm border border-yellow-200 overflow-hidden">
              <div className="px-4 py-3 bg-yellow-50 border-b border-yellow-200 flex items-center justify-between cursor-pointer select-none"
                onClick={() => setAttnOpen(o => !o)}>
                <h2 className="font-semibold text-yellow-800 flex items-center gap-2">
                  ⚠️ Needs Attention
                  <span className="text-xs font-normal bg-yellow-200 text-yellow-900 px-2 py-0.5 rounded-full">
                    Due in next 3 days
                  </span>
                </h2>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-bold text-yellow-700">{attentionRows.length} item{attentionRows.length !== 1 ? 's' : ''}</span>
                  <span className="text-yellow-500 text-sm">{attnOpen ? '▲' : '▼'}</span>
                </div>
              </div>
              {attnOpen && renderActionTable(attentionRows, 'attention')}
            </section>
          </div>
        </div>
      )}

      {/* ══ TO-DOS ═══════════════════════════════════════════════════════════ */}
      {innerTab === 'todos' && (
        <div className="flex-1 overflow-auto flex flex-col">
          {/* Toolbar */}
          <div className="bg-white border-b border-gray-200 px-4 py-2 flex items-center gap-2 flex-wrap">
            {/* Filter pills */}
            {[
              { k: 'all',      label: 'All' },
              { k: 'my-day',   label: `⭐ My Day${todoStats.myDay > 0 ? ` (${todoStats.myDay})` : ''}` },
              { k: 'active',   label: `Active (${todoStats.active})` },
              { k: 'today',    label: `Today (${todoStats.today})` },
              { k: 'overdue',  label: `⚠️ Overdue (${todoStats.overdue})` },
              { k: 'done',     label: `Done (${todoStats.done})` },
            ].map(f => (
              <button key={f.k} onClick={() => setTodoFilter(f.k)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  todoFilter === f.k ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}>{f.label}</button>
            ))}

            {/* Category filter */}
            <select value={catFilter} onChange={e => setCatFilter(e.target.value)}
              className="px-2 py-1 border border-gray-300 rounded-lg text-xs bg-white">
              <option value="all">All Categories</option>
              {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>

            <button onClick={openAdd}
              className="ml-auto px-4 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700">
              + Add To-Do
            </button>
          </div>

          {/* List */}
          <div className="flex-1 overflow-auto px-4 py-3 space-y-2">
            {todosLoading && <p className="text-center text-gray-400 py-10">Loading…</p>}
            {!todosLoading && filteredTodos.length === 0 && (
              <div className="text-center py-16 text-gray-400">
                <div className="text-4xl mb-3">📭</div>
                <p className="font-medium">Nothing here</p>
              </div>
            )}
            {filteredTodos.map(todo => {
              const isDone  = todo.done === 1;
              const isMyDay = todo.my_day === 1;
              const hasCL   = todo.checklist?.length > 0;
              const clDone  = todo.checklist?.filter(c => c.done === 1).length || 0;
              const isExpanded = expanded.has(todo.id);
              const srcKey = todo.type === 'slack' ? 'slack' : todo.type === 'jira-notification' ? 'jira' : 'todo';
              const t = todayD();
              const d = parseLocalDate(todo.due_date);
              const overdue = d && !isDone && d < t;
              const dueToday = d && !isDone && d.getTime() === t.getTime();
              const rowCls = isDone ? 'opacity-50 bg-white' : overdue ? 'bg-red-50 border-red-300' : dueToday ? 'bg-orange-50 border-orange-300' : 'bg-white border-gray-200';
              return (
                <div key={todo.id} className={`rounded-lg border shadow-sm overflow-hidden cursor-pointer ${rowCls}`} onClick={() => openEdit(todo)}>
                  <div className="flex items-start gap-3 p-3">
                    {/* Done checkbox */}
                    <button onClick={e => { e.stopPropagation(); void toggleDone(todo); }}
                      className={`mt-0.5 w-5 h-5 rounded border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
                        isDone ? 'bg-green-500 border-green-500' : 'border-gray-400 hover:border-blue-500'
                      }`}>
                      {isDone && <span className="text-white text-xs">✓</span>}
                    </button>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {SOURCE_BADGE[srcKey]}
                        <span className={`text-sm font-medium ${
                          isDone ? 'line-through text-gray-400' : 'text-gray-800'
                        }`}>{todo.title}</span>
                        {isMyDay && !isDone && <span className="text-yellow-500 text-xs">⭐</span>}
                        <span className={`text-xs px-1.5 py-0.5 rounded-full border ${
                          todo.priority === 'high' ? 'bg-red-50 text-red-700 border-red-300' :
                          todo.priority === 'low'  ? 'bg-green-50 text-green-700 border-green-300' :
                          'bg-yellow-50 text-yellow-700 border-yellow-300'
                        }`}>{todo.priority}</span>
                        {todo.category && todo.category !== 'Tasks' && (
                          <span className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">{todo.category}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                        {todo.due_date && (
                          <span className={`text-xs ${
                            overdue ? 'text-red-600 font-semibold' : dueToday ? 'text-orange-600 font-semibold' : 'text-gray-500'
                          }`}>{overdue ? '⚠️ ' : ''}{fmtDate(d)}</span>
                        )}
                        {todo.brief && <span className="text-xs text-gray-400 truncate max-w-xs">{todo.brief}</span>}
                        {hasCL && (
                          <button onClick={e => { e.stopPropagation(); setExpanded(p => { const n=new Set(p); n.has(todo.id)?n.delete(todo.id):n.add(todo.id); return n; }); }}
                            className="text-xs text-blue-500 hover:text-blue-700">
                            {clDone}/{todo.checklist.length} steps {isExpanded ? '▲' : '▼'}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-1 flex-shrink-0">
                      <button onClick={e => { e.stopPropagation(); void toggleMyDay(todo); }} title="My Day"
                        className={`p-1 text-sm ${
                          isMyDay ? 'text-yellow-500' : 'text-gray-300 hover:text-yellow-400'
                        }`}>⭐</button>
                      <button onClick={e => { e.stopPropagation(); openEdit(todo); }} className="p-1 text-gray-400 hover:text-blue-600 text-sm">✏️</button>
                      <button onClick={e => { e.stopPropagation(); void handleDelete(todo.id); }} className="p-1 text-gray-400 hover:text-red-600 text-sm">🗑</button>
                    </div>
                  </div>

                  {/* Checklist (expanded) */}
                  {isExpanded && hasCL && (
                    <div className="border-t border-gray-100 px-10 py-2 space-y-1 bg-gray-50">
                      {todo.checklist.map((item, idx) => (
                        <label key={item.id || idx} className="flex items-center gap-2 cursor-pointer">
                          <input type="checkbox" checked={item.done === 1}
                            onChange={e => { e.stopPropagation(); void toggleCheckItem(todo, idx); }}
                            className="w-4 h-4 rounded" />
                          <span className={`text-sm ${
                            item.done === 1 ? 'line-through text-gray-400' : 'text-gray-700'
                          }`}>{item.text}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ══ ADD / EDIT FORM ══════════════════════════════════════════════════ */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={closeForm}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-800">
                {editingId ? 'Edit To-Do' : 'Add To-Do'}
              </h3>
              <div className="flex gap-2">
                <button onClick={closeForm} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                <button onClick={handleSave} className="px-5 py-2 text-sm bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700">
                  {editingId ? 'Save Changes' : 'Add To-Do'}
                </button>
              </div>
            </div>

            <label className="inline-flex items-center gap-2 mb-3 text-sm text-gray-700 select-none">
              <input
                type="checkbox"
                checked={form.markClosed}
                onChange={e => setForm(f => ({ ...f, markClosed: e.target.checked }))}
                className="w-4 h-4 rounded"
              />
              Mark closed
            </label>

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
                    }`}>⭐ My Day</button>
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
                            onChange={() => setForm(f => ({ ...f, checklist: f.checklist.map((c,i) => i===idx ? {...c,done:!c.done} : c) }))}
                            className="w-4 h-4 rounded" />
                          <span className={`flex-1 text-sm ${item.done ? 'line-through text-gray-400' : 'text-gray-700'}`}>{item.text}</span>
                          <button onClick={() => setForm(f => ({ ...f, checklist: f.checklist.filter((_,i) => i!==idx) }))}
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

export default memo(HomeTab);

