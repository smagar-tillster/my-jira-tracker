import { createContext, useContext } from 'react';
import { RefreshJob } from '../../services/api';

/** What the PR lists need from the Release & PRs page to fetch fresh PRs: start it, and whether a run (of any kind) is in progress. */
export interface RefreshState {
  fetchPrs: () => void;
  job: RefreshJob | null;
  running: boolean;
  /** When the PR lists were last fetched (the PRs-only run, else the full report), ISO. */
  prsAt: string | null;
}

export const RefreshContext = createContext<RefreshState | null>(null);
export const useRefresh = () => useContext(RefreshContext);
