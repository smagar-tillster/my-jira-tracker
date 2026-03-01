import axios from 'axios';
import { JiraIssue } from '../types';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

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
  getFilterConfig: async (): Promise<{ sprint: string; me: string; defects: string }> => {
    try {
      const response = await apiClient.get('/config/filters');
      return response.data.data || { sprint: '', me: '', defects: '' };
    } catch (error) {
      console.error('Error fetching filter config:', error);
      // Return defaults if config fetch fails
      return { sprint: '60259', me: '47216', defects: '57474' };
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
};
