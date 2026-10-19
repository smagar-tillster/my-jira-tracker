import { useState, useEffect, useRef, useCallback } from 'react';
import JiraTasksTracker from './components/JiraTasksTracker';
import QuickAnalysisTracker from './components/QuickAnalysisTracker';
import ReleasePrReports from './components/ReleasePrReports';
import AppDrawer from './components/shell/AppDrawer';
import TabStrip from './components/shell/TabStrip';
import NotificationBell from './components/shell/NotificationBell';
import EmbeddedApp from './components/apps/EmbeddedApp';
import ReportViewer from './components/apps/ReportViewer';
import ComingSoon from './components/apps/ComingSoon';
import { APP_BY_ID, FLEET_URL } from './apps/registry';
import { jiraApi } from './services/api';
import { JiraIssue } from './types';

const OPEN_APPS_KEY = 'mytracker.openApps.v1';

// Open tabs are remembered per browser; fall back to Tasks if nothing valid is stored.
const loadOpenApps = (): { open: string[]; active: string | null } => {
  try {
    const raw = JSON.parse(localStorage.getItem(OPEN_APPS_KEY) || 'null');
    const open: string[] = Array.isArray(raw?.open)
      ? Array.from(new Set<string>(raw.open.filter((id: unknown): id is string => typeof id === 'string' && id in APP_BY_ID)))
      : [];
    if (open.length > 0) {
      return { open, active: open.includes(raw.active) ? raw.active : open[0] };
    }
  } catch {
    // storage unavailable or corrupt: use the default
  }
  return { open: ['tasks'], active: 'tasks' };
};

function App() {
  const [issues, setIssues] = useState<JiraIssue[]>([]);
  const [myIssues, setMyIssues] = useState<JiraIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [myLoading, setMyLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  // Every opened app is a tab; open tabs stay mounted (hidden when inactive) so their state is kept.
  const [openIds, setOpenIds] = useState<string[]>(() => loadOpenApps().open);
  const [activeId, setActiveId] = useState<string | null>(() => loadOpenApps().active);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const [initialLoaded, setInitialLoaded] = useState(false);
  const initialLoadRef = useRef(false);

  const openApp = (id: string) => {
    if (!(id in APP_BY_ID)) return;
    setOpenIds(prev => (prev.includes(id) ? prev : [...prev, id]));
    setActiveId(id);
  };

  const closeApp = (id: string) => {
    const idx = openIds.indexOf(id);
    const next = openIds.filter(x => x !== id);
    setOpenIds(next);
    if (activeId === id) setActiveId(next[idx] ?? next[idx - 1] ?? null);
  };

  useEffect(() => {
    try {
      localStorage.setItem(OPEN_APPS_KEY, JSON.stringify({ open: openIds, active: activeId }));
    } catch {
      // storage unavailable: tabs just won't be remembered
    }
  }, [openIds, activeId]);

  // Ctrl/Cmd+K toggles the apps drawer
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setDrawerOpen(o => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const [filterIds, setFilterIds] = useState<{ sprint: string; me: string }>({
    sprint: '60259',
    me: '47216',
  });
  const initialFetchDone = useRef(false);

  // Fetch filter configuration on mount
  useEffect(() => {
    const loadFilterConfig = async () => {
      try {
        const config = await jiraApi.getFilterConfig();
        setFilterIds(config);
      } catch (err) {
        console.error('Failed to load filter config, using defaults:', err);
      }
    };
    loadFilterConfig();
  }, []);

  const fetchIssues = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      // Use backend JIRA_FILTER_ID from .env (60259 - current sprint)
      const data = await jiraApi.getIssues(false);

      // Fetch tags, important, and my-day flags and merge with issues
      const [tags, importantFlags, myDayFlags] = await Promise.all([
        jiraApi.getAllTags(),
        jiraApi.getAllImportantFlags(),
        jiraApi.getAllMyDayFlags(),
      ]);

      const issuesWithMetadata = data.map(issue => ({
        ...issue,
        tags: tags[issue.key] || [],
        important: importantFlags[issue.key] || false,
        myDay: myDayFlags[issue.key] || false,
        searchText: [
          issue.key,
          issue.summary,
          issue.assignee,
          typeof issue.description === 'string' ? issue.description : JSON.stringify(issue.description || ''),
          issue.client || '',
          (issue.labels || []).join(' '),
          (issue.components || []).join(' '),
        ].join(' ').toLowerCase(),
      }));

      setIssues(issuesWithMetadata);
      setLastRefresh(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch issues');
      console.error('Error fetching issues:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchMyIssues = useCallback(async () => {
    try {
      setMyLoading(true);
      setError(null);
      // Use configurable filter ID for "Me" view (all tickets assigned to current user)
      const data = await jiraApi.getIssuesFromFilter(filterIds.me);

      // Fetch tags, important, and my-day flags and merge with issues
      const [tags, importantFlags, myDayFlags] = await Promise.all([
        jiraApi.getAllTags(),
        jiraApi.getAllImportantFlags(),
        jiraApi.getAllMyDayFlags(),
      ]);

      const issuesWithMetadata = data.map(issue => ({
        ...issue,
        tags: tags[issue.key] || [],
        important: importantFlags[issue.key] || false,
        myDay: myDayFlags[issue.key] || false,
        searchText: [
          issue.key,
          issue.summary,
          issue.assignee,
          typeof issue.description === 'string' ? issue.description : JSON.stringify(issue.description || ''),
          issue.client || '',
          (issue.labels || []).join(' '),
          (issue.components || []).join(' '),
        ].join(' ').toLowerCase(),
      }));

      setMyIssues(issuesWithMetadata);
      setLastRefresh(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch my issues');
      console.error('Error fetching my issues:', err);
    } finally {
      setMyLoading(false);
    }
  }, [filterIds.me]);

  useEffect(() => {
    // Only fetch sprint + me issues once after filter IDs are loaded.
    if (filterIds.sprint && filterIds.me && !initialFetchDone.current) {
      initialFetchDone.current = true;
      fetchIssues();
      fetchMyIssues();
    }
  }, [filterIds]);

  // Mark app as initially loaded once sprint + my issues have both finished their first fetch
  useEffect(() => {
    if (!initialLoadRef.current && !loading && !myLoading) {
      initialLoadRef.current = true;
      setInitialLoaded(true);
    }
  }, [loading, myLoading]);

  const renderApp = (id: string) => {
    const app = APP_BY_ID[id];
    switch (id) {
      case 'tasks':
        return (
          <JiraTasksTracker
            sprintIssues={issues}
            myIssues={myIssues}
            sprintLoading={loading}
            myLoading={myLoading}
            onRefreshSprint={fetchIssues}
            onRefreshMe={fetchMyIssues}
          />
        );
      case 'quickAnalysis':
        return (
          <QuickAnalysisTracker
            sprintIssues={issues}
            myIssues={myIssues}
            sprintLoading={loading}
            myLoading={myLoading}
            onRefreshSprint={fetchIssues}
            onRefreshMe={fetchMyIssues}
          />
        );
      case 'releases':
        return <ReleasePrReports />;
      case 'monitoring':
        return <EmbeddedApp title={app.name} url={FLEET_URL} />;
      case 'mytester':
        return <ReportViewer source="mytester" title={app.name} />;
      case 'defects':
        return <ReportViewer source="defects" title={app.name} />;
      case 'newrelic':
        return <ReportViewer source="newrelic-conditions" title={app.name} />;
      default:
        return app?.comingSoon ? <ComingSoon icon={app.icon} name={app.name} description={app.description} /> : null;
    }
  };

  return (
    <div className="h-screen flex flex-col bg-gray-100 relative">
      {/* Header: open-app tabs on the left, notifications + apps drawer on the right */}
      <header className="relative z-40 bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-md">
        <div className="px-6 py-2 flex items-center gap-4">
          <h1 className="text-xl font-bold whitespace-nowrap">📊 My Tracker</h1>
          <TabStrip openIds={openIds} activeId={activeId} onSelect={setActiveId} onClose={closeApp} />
          <div className="flex gap-2 items-center flex-shrink-0">
            {error && (
              <div className="bg-red-500 text-white px-3 py-1 rounded text-xs max-w-xs truncate" title={error}>
                ❌ {error}
              </div>
            )}
            <NotificationBell />
            <button
              onClick={() => setDrawerOpen(true)}
              title="Apps & tools (Ctrl/Cmd+K)"
              className="flex items-center gap-2 px-3 h-9 rounded-lg bg-white text-blue-700 text-sm font-semibold hover:bg-blue-50">
              <span className="text-base leading-none">⊞</span> Apps
            </button>
          </div>
        </div>
      </header>

      {/* Main content: every open app stays mounted and overlaps via absolute positioning.
           display:none skips browser paint entirely; React state is preserved since components never unmount. */}
      <main className="flex-1 overflow-hidden relative isolate">
        {openIds.map(id => (
          <div key={id} className="absolute inset-0" style={activeId !== id ? { display: 'none' } : undefined}>
            {renderApp(id)}
          </div>
        ))}
        {openIds.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-gray-400">
            <div className="text-center">
              <div className="text-5xl mb-4">⊞</div>
              <p className="text-xl font-medium text-gray-500">No apps open</p>
              <button
                onClick={() => setDrawerOpen(true)}
                className="mt-4 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700">
                Browse apps
              </button>
            </div>
          </div>
        )}
      </main>

      <AppDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} openIds={openIds} onOpenApp={openApp} />

      {/* Footer */}
      <footer className="bg-gray-800 text-gray-300 text-xs px-6 py-2 text-center">
        <p>
          My Tracker v3.0 | Issues:{' '}
          {activeId === 'tasks' ? `${issues.length} sprint + ${myIssues.length} me` : 'loaded in tab'} |{' '}
          Last Refresh: {lastRefresh.toLocaleTimeString()}
        </p>
      </footer>

      {/* ── Full-screen loading screen ─────────────────────────────────────────
          Covers the entire app on first load. All tabs mount and compute behind
          it. Once both sprint + my-issues fetches complete, it fades away and
          everything is instantly ready — no tab-switch or search delays. */}
      {!initialLoaded && (
        <div className="absolute inset-0 bg-gray-50 flex flex-col items-center justify-center z-50">
          <div className="flex flex-col items-center gap-6">
            <h1 className="text-2xl font-bold text-gray-700">📊 My Tracker</h1>
            <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
            <div className="space-y-2 text-center">
              <p className="text-sm text-gray-500 font-medium">Loading your data…</p>
              <div className="flex gap-6 text-xs justify-center">
                <span className={loading ? 'text-yellow-500' : 'text-green-600 font-semibold'}>
                  {loading ? '⏳ Sprint issues' : '✓ Sprint issues'}
                </span>
                <span className={myLoading ? 'text-yellow-500' : 'text-green-600 font-semibold'}>
                  {myLoading ? '⏳ My issues' : '✓ My issues'}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
