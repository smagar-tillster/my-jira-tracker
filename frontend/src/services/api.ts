import axios from 'axios';
import { JiraIssue, Accomplishment, CreateAccomplishmentPayload, JiraSprint } from '../types';

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
   * Get filter IDs configuration
   */
  getFilterConfig: async (): Promise<{ sprint: string; me: string }> => {
    try {
      const response = await apiClient.get('/config/filters');
      return response.data.data || { sprint: '', me: '' };
    } catch (error) {
      console.error('Error fetching filter config:', error);
      return { sprint: '60259', me: '47216' };
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

// ── Report hub (HTML reports from folders on the backend host) ─────────────
export interface HubSource { id: string; label: string; available: boolean }
export interface HubReportFile { path: string; name: string; size: number; modifiedAt: string }

export const hubApi = {
  getSources: async (): Promise<HubSource[]> => (await apiClient.get('/hub/sources')).data.data,
  getFiles: async (source: string): Promise<HubReportFile[]> => (await apiClient.get(`/hub/${source}/files`)).data.data,
  /** URL the iframe loads; relative links inside the report resolve under the same prefix. */
  fileUrl: (source: string, filePath: string): string =>
    `${API_URL}/hub/${source}/file/${filePath.split('/').map(encodeURIComponent).join('/')}`,
};

// ── PR review drafts (Claude writes them; the user reviews and presses Post) ──
export type PrReviewStatus = 'draft' | 'posted' | 'skipped' | 'stale';
export interface DiffContextLine { n: number; type: 'add' | 'del' | 'ctx'; text: string; anchor: boolean }
export interface PrReviewComment {
  path: string; line: number; startLine?: number; side: 'LEFT' | 'RIGHT'; body: string;
  severity: 'issue' | 'suggestion' | 'question' | 'nit' | 'note';
  include: boolean; edited?: boolean; diffContext?: DiffContextLine[];
}
export interface PrReview {
  repo: string; slug: string; number: number; headSha: string; baseRef: string; title: string; url: string; author: string;
  generatedAt: string; model: string; status: PrReviewStatus; event: 'COMMENT'; marker: string; body: string;
  inline: PrReviewComment[];
  summary: { changes: string; impact: string; risks: string; tests: string };
  risk: 'low' | 'medium' | 'high' | null; components: string[]; files: string[]; tickets: string[];
  flags: { touchesPaymentPaths: boolean; possibleSecrets: boolean; redacted: string[]; confidence: string };
  related: { id: string; kind: 'pr' | 'defect'; why: string }[];
  /** For the user only (never posted): knowledge gaps, docs that may need an update, which checks could not run. */
  internalNotes?: string[];
  edited?: boolean; postedAt?: string; reviewUrl?: string | null; staleReason?: string; alreadyOnGitHub?: boolean; inlineMovedToBody?: boolean;
  /** Is the PR still open at the same head commit? null when unknown (only meaningful for drafts). */
  current: boolean | null;
}
export class ReviewApiError extends Error {
  constructor(message: string, public needsAcknowledge = false) { super(message); }
}
const reviewErr = (e: any): never => {
  throw new ReviewApiError(e?.response?.data?.error || e?.message || 'Request failed', !!e?.response?.data?.needsAcknowledge);
};
const rvPath = (r: Pick<PrReview, 'repo' | 'number' | 'headSha'>) => `/reviews/${r.repo}/${r.number}/${r.headSha.slice(0, 7)}`;

/** An open PR that has no review saved for its current head commit. */
export interface ReviewQueueItem {
  repo: string; number: number; title: string; url: string; headSha: string; baseRef: string; author: string; updatedAt: string;
  tier: 'skip' | 'light' | 'deep'; tierWhy: string;
}
/** One "Initiate Code Review" job. exists = a review for this commit is already saved; queued = the claude CLI is unusable, run /pr-review in Claude. */
export interface GenerateJob {
  id: string; state: 'waiting' | 'running' | 'done' | 'exists' | 'queued' | 'failed'; message: string;
  queuedAt: string; startedAt: string | null; finishedAt: string | null;
}
export const generateBusy = (j?: GenerateJob) => j?.state === 'waiting' || j?.state === 'running';

export const reviewsApi = {
  /** Open PRs without a review for their current commit, including ones the rules would skip (their tier says so). */
  queue: async (): Promise<ReviewQueueItem[]> => (await apiClient.get('/reviews/queue', { params: { all: 1 } })).data.data,
  /** Initiate Code Review for several PRs at once; the backend runs a few at a time and keeps the rest waiting. */
  generate: async (prs: { repo: string; number: number }[]): Promise<Record<string, GenerateJob>> => {
    try { return (await apiClient.post('/reviews/generate', { prs })).data.data; } catch (e) { return reviewErr(e); }
  },
  generateStatus: async (): Promise<Record<string, GenerateJob>> => (await apiClient.get('/reviews/generate/status')).data.data,
  list: async (): Promise<PrReview[]> => (await apiClient.get('/reviews')).data.data,
  summary: async (): Promise<Record<PrReviewStatus, number>> => (await apiClient.get('/reviews/summary')).data.data,
  /** Edits the overview text and/or, per line comment (matched by position), its text and whether it is included. */
  edit: async (r: PrReview, patch: { body?: string; inline?: { body?: string; include?: boolean }[] }): Promise<PrReview> => {
    try { return (await apiClient.put(rvPath(r), patch)).data.data; } catch (e) { return reviewErr(e); }
  },
  skip: async (r: PrReview): Promise<PrReview> => {
    try { return (await apiClient.post(`${rvPath(r)}/skip`, {})).data.data; } catch (e) { return reviewErr(e); }
  },
  /** Posts to GitHub. Only call from a button the user pressed; sends the explicit confirmation the backend requires. */
  post: async (r: PrReview, opts: { acknowledgeSecrets?: boolean } = {}): Promise<PrReview> => {
    try { return (await apiClient.post(`${rvPath(r)}/post`, { confirm: true, acknowledgeSecrets: !!opts.acknowledgeSecrets })).data.data; } catch (e) { return reviewErr(e); }
  },
};
