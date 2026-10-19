import axios from 'axios';
import { JiraIssue, Todo, TodoCategory, CreateTodoPayload, Accomplishment, CreateAccomplishmentPayload, DailySummary, JiraSprint } from '../types';

// Default to the backend on whatever host served this page, so the app works from any IP/hostname.
const API_URL =
  import.meta.env.VITE_API_URL || `${window.location.protocol}//${window.location.hostname}:3050/api`;

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

  getAllMyDayFlags: async (): Promise<Record<string, boolean>> => {
    try {
      const response = await apiClient.get('/myday');
      return response.data.data || {};
    } catch (error) {
      console.error('Error fetching my day flags:', error);
      throw error;
    }
  },

  setIssueMyDay: async (issueKey: string, myDay: boolean): Promise<void> => {
    try {
      await apiClient.put(`/myday/${issueKey}`, { myDay });
    } catch (error) {
      console.error('Error setting my day flag:', error);
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
   * List active + future sprints (numbered "NGK Sprint ..." track) for the Jira Filter dropdown
   */
  getSprints: async (): Promise<JiraSprint[]> => {
    try {
      const response = await apiClient.get('/sprints');
      return response.data.data || [];
    } catch (error) {
      console.error('Error fetching sprints:', error);
      throw error;
    }
  },

  /**
   * Fetch issues for one or more specific sprints (replaces the default current-sprint filter)
   */
  getIssuesBySprints: async (sprintNames: string[]): Promise<JiraIssue[]> => {
    try {
      const response = await apiClient.get('/issues/by-sprints', {
        params: { sprints: sprintNames.join(',') },
      });
      return response.data.data || [];
    } catch (error) {
      console.error('Error fetching issues by sprints:', error);
      throw error;
    }
  },

  /**
   * Get the client -> region mapping (unmapped clients default to 'Other' on the frontend)
   */
  getClientRegions: async (): Promise<Record<string, string>> => {
    try {
      const response = await apiClient.get('/regions');
      return response.data.data || {};
    } catch (error) {
      console.error('Error fetching client regions:', error);
      throw error;
    }
  },

  /**
   * Set (or clear, with an empty string) the region for a client
   */
  setClientRegion: async (client: string, region: string): Promise<void> => {
    try {
      await apiClient.put(`/regions/${encodeURIComponent(client)}`, { region });
    } catch (error) {
      console.error('Error setting client region:', error);
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

// ── Release & PRs reports API ────────────────────────────────────────────────
export interface DeliveryTicket {
  key: string | null; url: string | null; label: string | null; summary: string; status: string; statusCategory: string;
  ready: boolean; assignee: string; component: string; version: string; notes: string;
}
export interface DeliveryRelease {
  id: string; key: string | null; url: string | null; title: string; tenant: string; tenants: string[]; date: string; env: string; envFlags: string[];
  status: string; statusCategory: string; released: boolean; assignee: string; what: string; summary: string;
  components: { name: string; version: string }[]; tickets: DeliveryTicket[]; notes: string; notReady: number; ready: boolean; noReleaseTicket?: boolean;
}
export interface DeliveryDependency { type: string; tone: 'ok' | 'warn' | 'info'; text: string; url?: string }
export interface DeliveryPr {
  id: string; repo: string; component: string; number: number; url: string; title: string; line1: string; line2: string; author: string; mergedAt: string | null; day: string | null;
  keys: string[]; tickets: { key: string; summary: string; url: string }[]; tenants: string[]; risk: 'low' | 'medium' | 'high' | null;
  analysis: { summary: string; how: string[]; dependencies: string[]; confirm: string[]; risk: string; basis: string; generatedAt: string; ai?: boolean } | null;
  dependsOn: DeliveryDependency[]; files: { name: string; add: number; del: number }[];
  rulesOnly: boolean; aiRecommended: boolean; tier: 'simple' | 'standard' | 'complex' | null; tierWhy: string;
  open: boolean; isDraft: boolean; createdAt: string | null; updatedAt: string | null; reviewDecision: string;
}
export interface AnalyzeJob { id: string; state: 'running' | 'done' | 'queued' | 'failed'; startedAt: string; finishedAt: string | null; message: string }
export interface DeliveryMeta {
  generatedAt: string; day: string; lastReleasedDay: string | null; tenants: string[]; envs: string[];
  window?: { sinceLabel: string; untilLabel: string };
  counts: { releases: number; toRelease: number; prsToday: number; prsPendingAi: number; openPrs: number };
  timing: { totalSec: number; stages: Record<string, number> } | null;
}
export interface RefreshJob { state: 'idle' | 'running' | 'done' | 'failed'; startedAt: string | null; finishedAt: string | null; log: string[] }

const csv = (a?: string[]) => (a && a.length ? a.join(',') : undefined);

export const deliveryApi = {
  meta: async (): Promise<DeliveryMeta> => (await apiClient.get('/delivery/meta')).data.data,
  released: async (f: { from?: string; to?: string; tenants?: string[]; envs?: string[] }): Promise<{ from: string; to: string; lastReleasedDay: string | null; rows: DeliveryRelease[] }> =>
    (await apiClient.get('/delivery/released', { params: { from: f.from || undefined, to: f.to || undefined, tenant: csv(f.tenants), env: csv(f.envs) } })).data.data,
  toRelease: async (f: { tenants?: string[]; envs?: string[] }): Promise<{ day: string; rows: DeliveryRelease[] }> =>
    (await apiClient.get('/delivery/to-release', { params: { tenant: csv(f.tenants), env: csv(f.envs) } })).data.data,
  prs: async (f: { from?: string; to?: string }): Promise<{ from: string; to: string; rows: DeliveryPr[] }> =>
    (await apiClient.get('/delivery/prs', { params: { from: f.from || undefined, to: f.to || undefined } })).data.data,
  openPrs: async (): Promise<{ rows: DeliveryPr[] }> => (await apiClient.get('/delivery/open-prs')).data.data,
  analyzePr: async (repo: string, number: number): Promise<AnalyzeJob> => (await apiClient.post(`/delivery/prs/${repo}/${number}/analyze`)).data.data,
  analyzeStatus: async (): Promise<Record<string, AnalyzeJob>> => (await apiClient.get('/delivery/prs/analyze/status')).data.data,
  refresh: async (): Promise<RefreshJob> => (await apiClient.post('/delivery/refresh')).data.data,
  refreshStatus: async (): Promise<RefreshJob> => (await apiClient.get('/delivery/refresh/status')).data.data,
};

export const dailySummaryApi = {
  getLatest: async (): Promise<DailySummary | null> => {
    const response = await apiClient.get('/daily-summary/latest');
    return response.data.data || null;
  },
};
