import axios from 'axios';
import { JiraIssue, Todo, TodoCategory, CreateTodoPayload, Accomplishment, CreateAccomplishmentPayload, DailySummary } from '../types';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3050/api';

const apiClient = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

export const jiraApi = {
  /**
   * Fetch all issues
   * @param useMock - Use mock data if true
   */
  getIssues: async (useMock: boolean = false): Promise<JiraIssue[]> => {
    try {
      const response = await apiClient.get('/issues', {
        params: { 
          useMock: useMock ? 'true' : 'false',
        },
      });
      return response.data.data || [];
    } catch (error) {
      console.error('Error fetching issues:', error);
      throw error;
    }
  },

  /**
   * Fetch issues from a specific filter
   */
  getIssuesFromFilter: async (filterId: string): Promise<JiraIssue[]> => {
    try {
      const response = await apiClient.get(`/issues/filter/${filterId}`);
      return response.data.data || [];
    } catch (error) {
      console.error('Error fetching filter issues:', error);
      throw error;
    }
  },

  /**
   * Fetch defects from filter 57474 (last 8 weeks of Done FE tasks)
   */
  getDefects: async (): Promise<JiraIssue[]> => {
    try {
      const response = await apiClient.get('/issues/filter/57474');
      return response.data.data || [];
    } catch (error) {
      console.error('Error fetching defects:', error);
      throw error;
    }
  },

  /**
   * Get filter IDs configuration
   */
  getFilterConfig: async (): Promise<{ sprint: string; me: string; defects: string; archive: string }> => {
    try {
      const response = await apiClient.get('/config/filters');
      return response.data.data || { sprint: '', me: '', defects: '', archive: '' };
    } catch (error) {
      console.error('Error fetching filter config:', error);
      return { sprint: '60259', me: '47216', defects: '57474', archive: '56341' };
    }
  },

  /**
   * Health check
   */
  checkHealth: async (): Promise<boolean> => {
    try {
      const response = await apiClient.get('/health');
      return response.data.success;
    } catch (error) {
      console.error('Health check failed:', error);
      return false;
    }
  },

  /**
   * Get all tags
   */
  getAllTags: async (): Promise<Record<string, string[]>> => {
    try {
      const response = await apiClient.get('/tags');
      return response.data.data || {};
    } catch (error) {
      console.error('Error fetching tags:', error);
      throw error;
    }
  },

  /**
   * Get all unique tags
   */
  getUniqueTags: async (): Promise<string[]> => {
    try {
      const response = await apiClient.get('/tags/unique');
      return response.data.data || [];
    } catch (error) {
      console.error('Error fetching unique tags:', error);
      throw error;
    }
  },

  /**
   * Set tags for an issue
   */
  setIssueTags: async (issueKey: string, tags: string[]): Promise<void> => {
    try {
      await apiClient.put(`/tags/${issueKey}`, { tags });
    } catch (error) {
      console.error('Error setting tags:', error);
      throw error;
    }
  },

  /**
   * Get all important flags
   */
  getAllImportantFlags: async (): Promise<Record<string, boolean>> => {
    try {
      const response = await apiClient.get('/important');
      return response.data.data || {};
    } catch (error) {
      console.error('Error fetching important flags:', error);
      throw error;
    }
  },

  /**
   * Set important flag for an issue
   */
  setIssueImportant: async (issueKey: string, important: boolean): Promise<void> => {
    try {
      await apiClient.put(`/important/${issueKey}`, { important });
    } catch (error) {
      console.error('Error setting important flag:', error);
      throw error;
    }
  },

  /**
   * Get all FE Team membership flags
   */
  getAllFETeamFlags: async (): Promise<Record<string, boolean>> => {
    try {
      const response = await apiClient.get('/feteam');
      return response.data.data || {};
    } catch (error) {
      console.error('Error fetching FE team flags:', error);
      throw error;
    }
  },

  /**
   * Set FE Team membership for an assignee
   */
  setFETeamMember: async (assignee: string, isMember: boolean): Promise<void> => {
    try {
      await apiClient.put(`/feteam/${encodeURIComponent(assignee)}`, { isMember });
    } catch (error) {
      console.error('Error setting FE team membership:', error);
      throw error;
    }
  },

  /**
   * Get pre-computed archive (cached daily on backend)
   */
  getArchive: async (): Promise<{ issues: JiraIssue[]; fetchedAt: string; issueCount: number }> => {
    try {
      const response = await apiClient.get('/archive');
      return {
        issues: response.data.data || [],
        fetchedAt: response.data.fetchedAt || '',
        issueCount: response.data.issueCount || 0,
      };
    } catch (error) {
      console.error('Error fetching archive:', error);
      throw error;
    }
  },
};

// ── Todos API ────────────────────────────────────────────────────────────────
export const todosApi = {
  getAll: async (type?: string): Promise<Todo[]> => {
    const response = await apiClient.get('/todos', { params: type ? { type } : {} });
    return response.data.data || [];
  },

  getToday: async (): Promise<Todo[]> => {
    const response = await apiClient.get('/todos/today');
    return response.data.data || [];
  },

  create: async (payload: CreateTodoPayload): Promise<Todo> => {
    const response = await apiClient.post('/todos', payload);
    return response.data.data;
  },

  update: async (id: string, updates: Partial<CreateTodoPayload> & { done?: boolean; myDay?: boolean }): Promise<Todo> => {
    const response = await apiClient.put(`/todos/${id}`, updates);
    return response.data.data;
  },

  delete: async (id: string): Promise<void> => {
    await apiClient.delete(`/todos/${id}`);
  },

  getCategories: async (): Promise<TodoCategory[]> => {
    const response = await apiClient.get('/todos/categories');
    return response.data.data || [];
  },

  createCategory: async (name: string): Promise<TodoCategory> => {
    const response = await apiClient.post('/todos/categories', { name });
    return response.data.data;
  },

  deleteCategory: async (id: string): Promise<void> => {
    await apiClient.delete(`/todos/categories/${id}`);
  },
};

// ── Accomplishments API ───────────────────────────────────────────────────────
export const accomplishmentsApi = {
  getAll: async (filters?: { sprint?: string; category?: string; type?: string }): Promise<Accomplishment[]> => {
    const response = await apiClient.get('/accomplishments', { params: filters || {} });
    return response.data.data || [];
  },

  getSprints: async (): Promise<string[]> => {
    const response = await apiClient.get('/accomplishments/sprints');
    return response.data.data || [];
  },

  create: async (payload: CreateAccomplishmentPayload): Promise<Accomplishment> => {
    const response = await apiClient.post('/accomplishments', payload);
    return response.data.data;
  },

  update: async (id: string, updates: Partial<CreateAccomplishmentPayload>): Promise<Accomplishment> => {
    const response = await apiClient.put(`/accomplishments/${id}`, updates);
    return response.data.data;
  },

  delete: async (id: string): Promise<void> => {
    await apiClient.delete(`/accomplishments/${id}`);
  },
};

export const dailySummaryApi = {
  getLatest: async (): Promise<DailySummary | null> => {
    const response = await apiClient.get('/daily-summary/latest');
    return response.data.data || null;
  },
};
