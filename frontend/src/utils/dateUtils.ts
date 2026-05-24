/**
 * Parse a date string in YYYY-MM-DD format as a local date
 * This prevents timezone shifting that occurs when parsing ISO dates without time
 * @param dateString - Date string in format YYYY-MM-DD
 * @returns Date object representing the date at midnight in local timezone
 */
export const parseLocalDate = (dateString: string | null | undefined): Date | null => {
  if (!dateString) return null;

  // Normalize separators (accept YYYY-MM-DD, YYYY.MM.DD, YYYY/MM/DD, ISO strings)
  const s = String(dateString).trim();

  // Try to extract YYYY-MM-DD or YYYY.MM.DD or YYYY/MM/DD
  const match = s.match(/(\d{4})[\.-/](\d{1,2})[\.-/](\d{1,2})/);
  if (match) {
    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10) - 1;
    const day = parseInt(match[3], 10);
    return new Date(year, month, day);
  }

  // Fallback: try ISO date (YYYY-MM-DDTHH:MM:SSZ)
  const isoMatch = s.match(/(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) {
    const parts = isoMatch[1].split('-');
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);
    return new Date(year, month, day);
  }

  return null;
};

/**
 * Format a date for display
 * @param date - Date object or date string
 * @param options - Intl.DateTimeFormat options
 * @returns Formatted date string
 */
export const formatDate = (
  date: Date | string | null | undefined,
  options?: Intl.DateTimeFormatOptions
): string => {
  if (!date) return '—';
  
  const dateObj = typeof date === 'string' ? parseLocalDate(date) : date;
  if (!dateObj) return '—';
  
  return dateObj.toLocaleDateString('en-US', options || {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
};
