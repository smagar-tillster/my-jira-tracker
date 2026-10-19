import { JiraIssue, SortConfig, FilterState } from '../types';

/**
 * Merge sprint + "me" issue lists into one deduped list, keyed by issue key.
 * Sprint fields win on overlap; 'source' reflects whichever set(s) an issue appears in.
 */
export const mergeIssueSources = (sprintIssues: JiraIssue[], myIssues: JiraIssue[]): JiraIssue[] => {
  const map = new Map<string, JiraIssue>();
  for (const issue of sprintIssues) {
    map.set(issue.key, { ...issue, source: 'sprint' });
  }
  for (const issue of myIssues) {
    if (map.has(issue.key)) {
      map.set(issue.key, { ...map.get(issue.key)!, source: 'me' });
    } else {
      map.set(issue.key, { ...issue, source: 'me' });
    }
  }
  return Array.from(map.values());
};

/**
 * Split a comma-separated client field into individual, trimmed client names.
 */
export const splitClients = (client: string | null | undefined): string[] =>
  (client || '').split(',').map(c => c.trim()).filter(Boolean);

/**
 * Group issues by client, exploding multi-client (comma-separated) issues into each client's group.
 * Issues with no client land in 'No Client'.
 */
export const groupByClient = (issues: JiraIssue[]): Map<string, JiraIssue[]> => {
  const grouped = new Map<string, JiraIssue[]>();
  for (const issue of issues) {
    const clients = splitClients(issue.client);
    const keys = clients.length > 0 ? clients : ['No Client'];
    for (const key of keys) {
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(issue);
    }
  }
  return new Map([...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0])));
};

export type QuickGroupField = 'client' | 'status' | 'issueType' | 'assignee' | 'none';

/**
 * General-purpose grouping used by dashboard-style views that let the user swap the
 * "Group By" field. 'client' explodes comma-separated clients; 'none' returns a single bucket.
 */
export const groupIssuesByField = (issues: JiraIssue[], field: QuickGroupField): Map<string, JiraIssue[]> => {
  if (field === 'none') return new Map([['All Issues', issues]]);
  if (field === 'client') return groupByClient(issues);

  const fieldGetters: Record<Exclude<QuickGroupField, 'client' | 'none'>, (i: JiraIssue) => string> = {
    status: i => i.status,
    issueType: i => i.issueType,
    assignee: i => i.assignee || 'Unassigned',
  };
  const getValue = fieldGetters[field as Exclude<QuickGroupField, 'client' | 'none'>];

  const grouped = new Map<string, JiraIssue[]>();
  for (const issue of issues) {
    const value = getValue(issue) || 'Unknown';
    if (!grouped.has(value)) grouped.set(value, []);
    grouped.get(value)!.push(issue);
  }
  return new Map([...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0])));
};

/**
 * Sort issues by a specific column
 */
export const sortIssues = (
  issues: JiraIssue[],
  sortConfig: SortConfig
): JiraIssue[] => {
  if (!sortConfig.column) return issues;

  const sorted = [...issues].sort((a, b) => {
    const aValue = a[sortConfig.column!];
    const bValue = b[sortConfig.column!];

    // Handle null/undefined values
    if (aValue == null && bValue == null) return 0;
    if (aValue == null) return sortConfig.direction === 'asc' ? 1 : -1;
    if (bValue == null) return sortConfig.direction === 'asc' ? -1 : 1;

    // Compare values
    let comparison = 0;
    if (typeof aValue === 'string' && typeof bValue === 'string') {
      comparison = aValue.localeCompare(bValue);
    } else if (typeof aValue === 'number' && typeof bValue === 'number') {
      comparison = aValue - bValue;
    } else if (aValue instanceof Date && bValue instanceof Date) {
      comparison = aValue.getTime() - bValue.getTime();
    } else {
      comparison = String(aValue).localeCompare(String(bValue));
    }

    return sortConfig.direction === 'asc' ? comparison : -comparison;
  });

  return sorted;
};

/**
 * Filter issues based on multiple filter conditions
 */
export const filterIssues = (
  issues: JiraIssue[],
  filters: FilterState,
  searchTerm: string = ''
): JiraIssue[] => {
  return issues.filter((issue) => {
    // Search filter
    if (searchTerm.trim()) {
      const searchLower = searchTerm.toLowerCase();
      // Use precomputed searchText when available to avoid repeated JSON.stringify and concat cost
      const hay = (issue.searchText || (
        [issue.key, issue.summary, issue.assignee, String(issue.description || ''), String(issue.client || '')]
          .join(' ') 
      )).toLowerCase();

      const matches = hay.includes(searchLower);

      if (!matches) return false;
    }

    // Column filters
    for (const [column, value] of Object.entries(filters)) {
      if (!value) continue;

      const issueValue = issue[column as keyof JiraIssue];

      if (Array.isArray(value)) {
        // Multi-value filter
        if (Array.isArray(issueValue)) {
          const hasMatch = (issueValue as string[]).some((v) =>
            value.includes(v)
          );
          if (!hasMatch) return false;
        } else {
          if (!value.includes(String(issueValue))) return false;
        }
      } else {
        // Single value filter
        if (Array.isArray(issueValue)) {
          if (!issueValue.includes(value)) return false;
        } else {
          if (String(issueValue) !== value) return false;
        }
      }
    }

    return true;
  });
};

/**
 * Group issues by a specific column
 */
export const groupIssues = (
  issues: JiraIssue[],
  groupByColumn: keyof JiraIssue | null
): Map<string, JiraIssue[]> => {
  const grouped = new Map<string, JiraIssue[]>();

  if (!groupByColumn) {
    grouped.set('All Issues', issues);
    return grouped;
  }

  issues.forEach((issue) => {
    const groupValue = issue[groupByColumn];
    let groupKey = String(groupValue) || 'Unset';

    if (Array.isArray(groupValue)) {
      groupValue.forEach((val) => {
        const key = String(val) || 'Unset';
        if (!grouped.has(key)) {
          grouped.set(key, []);
        }
        grouped.get(key)!.push(issue);
      });
      return;
    }

    if (!grouped.has(groupKey)) {
      grouped.set(groupKey, []);
    }
    grouped.get(groupKey)!.push(issue);
  });

  return grouped;
};

/**
 * Get unique values for a column
 */
export const getColumnUniqueValues = (
  issues: JiraIssue[],
  column: keyof JiraIssue
): string[] => {
  const values = new Set<string>();

  issues.forEach((issue) => {
    const value = issue[column];
    if (Array.isArray(value)) {
      value.forEach((v) => values.add(String(v)));
    } else if (value != null) {
      values.add(String(value));
    }
  });

  return Array.from(values).sort();
};
