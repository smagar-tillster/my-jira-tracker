import { useCallback, useEffect, useRef, useState } from 'react';
import { GenerateJob, ReviewApiError, generateBusy, reviewsApi } from '../../services/api';

export const prId = (p: { repo: string; number: number }) => `${p.repo}#${p.number}`;

/**
 * "Initiate Code Review": starts reviews for one or several PRs and follows their progress.
 * The backend runs a few at a time and saves each result as a draft in the PR Reviews tab; nothing is posted to GitHub.
 * `onDone` runs when a review finishes (so the lists can refresh).
 */
export function useCodeReview(onDone: () => void) {
  const [jobs, setJobs] = useState<Record<string, GenerateJob>>({});
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const stop = () => { if (timer.current !== null) { window.clearInterval(timer.current); timer.current = null; } };

  const poll = useCallback(async () => {
    try {
      const next = await reviewsApi.generateStatus();
      setJobs(prev => {
        if (Object.entries(next).some(([id, j]) => generateBusy(prev[id]) && j.state === 'done')) onDoneRef.current();
        return next;
      });
      if (!Object.values(next).some(generateBusy)) stop();
    } catch { /* backend busy; try again on the next tick */ }
  }, []);

  const follow = useCallback(() => { if (timer.current === null) timer.current = window.setInterval(poll, 3000); }, [poll]);

  // pick up reviews that are already running (the tab was reopened)
  useEffect(() => {
    reviewsApi.generateStatus().then(next => { setJobs(next); if (Object.values(next).some(generateBusy)) follow(); }).catch(() => { /* none yet */ });
    return stop;
  }, [follow]);

  const start = async (prs: { repo: string; number: number }[]) => {
    setError(null);
    try {
      const started = await reviewsApi.generate(prs);
      setJobs(prev => ({ ...prev, ...started }));
      follow();
    } catch (e) {
      setError(e instanceof ReviewApiError ? e.message : String((e as Error)?.message || e));
    }
  };

  return { jobs, start, error, busy: Object.values(jobs).some(generateBusy) };
}

/** How a finished or running job reads on screen. */
export const jobText = (j?: GenerateJob): { text: string; tone: 'info' | 'ok' | 'warn' | 'err' } | null => {
  if (!j) return null;
  switch (j.state) {
    case 'waiting': return { text: 'Waiting for a free slot…', tone: 'info' };
    case 'running': return { text: 'Reviewing…', tone: 'info' };
    case 'done': return { text: 'Draft ready in To review', tone: 'ok' };
    case 'exists': return { text: 'A review for this commit already exists', tone: 'warn' };
    case 'queued': return { text: `Queued for Claude: ${j.message}`, tone: 'warn' };
    default: return { text: `Failed: ${j.message}`, tone: 'err' };
  }
};
