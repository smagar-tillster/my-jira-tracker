export interface JiraIssue {
  id: string;
  key: string;
  summary: string;
  status: string;
  statusCategory: string;
  assignee: string;
  assigneeAvatar: string | null;
  priority: string;
  dueDate: string | null;
  fixVersions: string[];
  releaseDate: string;
  created: string;
  updated: string;
  issueType: string;
  labels: string[];
  components: string[];
  description: string;
  url: string;
  sprint: string | null;
  sprintStartDate: string | null;
  sprintEndDate: string | null;
  client: string | null;
  tags?: string[];
  important?: boolean;
  myDay?: boolean;
  parentSummary?: string | null;
  timeSpent?: number;
  originalEstimate?: number;
  defectCausedBy?: string | null;
  qaNotes?: string | null;
  statusCategoryChangeDate?: string | null;
  plannedUatDate?: string | null;
  // Which filter source this issue came from (used in merged Jira Tasks tab)
  source?: 'sprint' | 'me' | 'defects' | 'archive';
  // Precomputed lowercased searchable text to speed up client-side search
  searchText?: string;
}

export interface Column {
  key: keyof JiraIssue;
  label: string;
  sortable: boolean;
  filterable: boolean;
  type: 'text' | 'date' | 'status' | 'priority' | 'assignee' | 'array' | 'url' | 'boolean';
  width?: number;
}

export interface FilterState {
  [key: string]: string | string[] | null;
}

export interface GroupConfig {
  column: keyof JiraIssue | null;
  direction: 'asc' | 'desc';
}

export interface SortConfig {
  column: keyof JiraIssue | null;
  direction: 'asc' | 'desc';
}

// ── Todo ─────────────────────────────────────────────────────────────────────
// 'task' = manual entry | 'slack' = Slack DM | 'jira-notification' = Jira notif
export type TodoType = 'task' | 'slack' | 'jira-notification';
export type TodoPriority = 'high' | 'medium' | 'low';

export interface ChecklistItem {
  id: string;
  text: string;
  done: number; // 0 | 1
  sort_order: number;
}

export interface TodoCategory {
  id: string;
  name: string;
  created_at: string;
}

export interface Todo {
  id: string;
  type: TodoType;
  title: string;
  brief: string | null;
  url: string | null;
  issue_key: string | null;
  due_date: string | null;
  done: number; // 0 | 1 (SQLite boolean)
  priority: TodoPriority;
  my_day: number;   // 0 | 1
  category: string; // default 'Tasks'
  checklist: ChecklistItem[];
  created_at: string;
}

export interface CreateTodoPayload {
  title: string;
  brief?: string;
  dueDate?: string;
  priority?: TodoPriority;
  myDay?: boolean;
  category?: string;
  checklist?: Array<{ id?: string; text: string; done?: boolean }>;
}

// ── Accomplishment ────────────────────────────────────────────────────────────
export type AccomplishmentType     = 'auto' | 'manual';
export type AccomplishmentCategory = 'feature' | 'bug' | 'process' | 'other';
export type AccomplishmentImpact   = 'high' | 'medium' | 'low';

export interface Accomplishment {
  id: string;
  type: AccomplishmentType;
  title: string;
  detail: string | null;
  issue_key: string | null;
  sprint: string | null;
  date: string;
  category: AccomplishmentCategory;
  impact: AccomplishmentImpact;
  created_at: string;
}

export interface CreateAccomplishmentPayload {
  title: string;
  type?: AccomplishmentType;
  detail?: string;
  issueKey?: string;
  sprint?: string;
  date?: string;
  category?: AccomplishmentCategory;
  impact?: AccomplishmentImpact;
}

export interface DailySummary {
  id: string;
  summaryDate: string;
  source: string;
  title: string | null;
  content: string;
  createdAt: string;
  updatedAt: string;
}
