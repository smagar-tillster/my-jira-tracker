import { JiraIssue, SortConfig, FilterState } from '../types';

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
      const descriptionText = typeof issue.description === 'string' 
        ? issue.description 
        : JSON.stringify(issue.description || '');
      
      const matches =
        issue.key.toLowerCase().includes(searchLower) ||
        issue.summary.toLowerCase().includes(searchLower) ||
        issue.assignee.toLowerCase().includes(searchLower) ||
        descriptionText.toLowerCase().includes(searchLower);

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
