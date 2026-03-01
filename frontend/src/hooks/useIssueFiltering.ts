import { useState, useCallback } from 'react';
import { JiraIssue, FilterState } from '../types';

export const useIssueFiltering = (_issues: JiraIssue[]) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filters, setFilters] = useState<FilterState>({});

  const addFilter = useCallback((column: string, value: string | string[]) => {
    setFilters((prev) => ({
      ...prev,
      [column]: value,
    }));
  }, []);

  const removeFilter = useCallback((column: string) => {
    setFilters((prev) => {
      const newFilters = { ...prev };
      delete newFilters[column];
      return newFilters;
    });
  }, []);

  const clearAllFilters = useCallback(() => {
    setFilters({});
    setSearchTerm('');
  }, []);

  const toggleFilterValue = useCallback(
    (column: string, value: string) => {
      setFilters((prev) => {
        const currentValue = prev[column];
        if (Array.isArray(currentValue)) {
          const newArray = currentValue.includes(value)
            ? currentValue.filter((v) => v !== value)
            : [...currentValue, value];
          return {
            ...prev,
            [column]: newArray.length > 0 ? newArray : null,
          };
        } else if (currentValue === value) {
          const newFilters = { ...prev };
          delete newFilters[column];
          return newFilters;
        } else {
          return {
            ...prev,
            [column]: [value],
          };
        }
      });
    },
    []
  );

  return {
    searchTerm,
    setSearchTerm,
    filters,
    addFilter,
    removeFilter,
    toggleFilterValue,
    clearAllFilters,
  };
};
