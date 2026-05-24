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
  parentSummary?: string | null;
  timeSpent?: number;
  originalEstimate?: number;
  defectCausedBy?: string | null;
  qaNotes?: string | null;
  statusCategoryChangeDate?: string | null;
  plannedUatDate?: string | null;
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
