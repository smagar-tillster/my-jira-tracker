import { useState, useEffect, useRef, useCallback } from 'react';
import DefectsTracker from './components/DefectsTracker';
import JiraTasksTracker from './components/JiraTasksTracker';
import ArchiveTracker from './components/ArchiveTracker';
import TodoPage from './components/TodoPage';
import { jiraApi } from './services/api';
import { JiraIssue } from './types';

type MainTab = 'tasks' | 'todo' | 'archive' | 'accomplishments' | 'defects';

function App() {
  const [issues, setIssues] = useState<JiraIssue[]>([]);
  const [myIssues, setMyIssues] = useState<JiraIssue[]>([]);
  const [defects, setDefects] = useState<JiraIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [myLoading, setMyLoading] = useState(true);
  const [defectsLoading, setDefectsLoading] = useState(false);
  const defectsFetched = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<MainTab>('tasks');
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [addTodoTrigger, setAddTodoTrigger] = useState(0);
  // Pre-mount tasks + todo immediately so data is ready before first visit
  const [visitedTabs, setVisitedTabs] = useState<Set<MainTab>>(new Set<MainTab>(['tasks', 'todo']));

  const [initialLoaded, setInitialLoaded] = useState(false);
  const initialLoadRef = useRef(false);

  const switchTab = (tab: MainTab) => {
    setActiveTab(tab);
    if (!visitedTabs.has(tab)) {
      setVisitedTabs(prev => { const s = new Set(prev); s.add(tab); return s; });
    }
    // Lazily fetch defects when the Defects tab is first visited
    if (tab === 'defects' && !defectsFetched.current) {
      defectsFetched.current = true;
      fetchDefects();
    }
  };
  const [filterIds, setFilterIds] = useState<{ sprint: string; me: string; defects: string; archive: string }>({
    sprint: '60259',
    me: '47216',
    defects: '57474',
    archive: '56341',
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

  const fetchDefects = useCallback(async () => {
    try {
      setDefectsLoading(true);
      setError(null);
      // Use configurable filter ID for "Defects" view
      const data = await jiraApi.getIssuesFromFilter(filterIds.defects);

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

      setDefects(issuesWithMetadata);
      setLastRefresh(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch defects');
      console.error('Error fetching defects:', err);
    } finally {
      setDefectsLoading(false);
    }
  }, [filterIds.defects]);

  useEffect(() => {
    // Only fetch sprint + me issues once after filter IDs are loaded.
    // Defects are loaded lazily on first Defects tab visit.
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

  return (
    <div className="h-screen flex flex-col bg-gray-100 relative">
      {/* Header */}
      <header className="bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-md">
        <div className="px-6 py-2 flex items-center justify-between">
          <h1 className="text-xl font-bold">📊 My Tracker</h1>
          <div className="flex gap-1 items-center">
            {/* Error */}
            {error && (
              <div className="bg-red-500 text-white px-3 py-1 rounded text-xs max-w-md truncate mr-2" title={error}>
                ❌ {error}
              </div>
            )}

            {/* Primary tabs */}
            {([
              { id: 'tasks',           label: '📋 Tasks' },
              { id: 'todo',            label: '✅ Todo' },
              { id: 'archive',         label: '🗃 Archive' },
              { id: 'accomplishments', label: '🏆 Accomplishments' },
              { id: 'defects',         label: '🐞 Defects' },
            ] as { id: MainTab; label: string }[]).map(tab => (
              <button key={tab.id} onClick={() => switchTab(tab.id)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === tab.id ? 'bg-white text-blue-700' : 'bg-blue-500 text-white hover:bg-blue-400'
                }`}>
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Main Content — all visited tabs stay mounted and overlap via absolute positioning.
           display:none skips browser paint entirely; React state is preserved since components never unmount. */}
      <main className="flex-1 overflow-hidden relative">
        {visitedTabs.has('tasks') && (
          <div className="absolute inset-0" style={activeTab !== 'tasks' ? { display: 'none' } : undefined}>
            <JiraTasksTracker
              sprintIssues={issues}
              myIssues={myIssues}
              sprintLoading={loading}
              myLoading={myLoading}
              onRefreshSprint={fetchIssues}
              onRefreshMe={fetchMyIssues}
            />
          </div>
        )}
        {visitedTabs.has('todo') && (
          <div className="absolute inset-0" style={activeTab !== 'todo' ? { display: 'none' } : undefined}>
            <TodoPage addTodoTrigger={addTodoTrigger} />
          </div>
        )}
        {visitedTabs.has('archive') && (
          <div className="absolute inset-0" style={activeTab !== 'archive' ? { display: 'none' } : undefined}>
            <ArchiveTracker filterId={filterIds.archive} />
          </div>
        )}
        {visitedTabs.has('accomplishments') && (
          <div className="absolute inset-0 flex items-center justify-center text-gray-400" style={activeTab !== 'accomplishments' ? { display: 'none' } : undefined}>
            <div className="text-center">
              <div className="text-5xl mb-4">🏆</div>
              <p className="text-xl font-medium">Accomplishments — Coming Soon</p>
              <p className="text-sm mt-2">Sprint highlights &amp; manual entries</p>
            </div>
          </div>
        )}
        {visitedTabs.has('defects') && (
          <div className="absolute inset-0" style={activeTab !== 'defects' ? { display: 'none' } : undefined}>
            <DefectsTracker issues={defects} loading={defectsLoading} onRefresh={fetchDefects} />
          </div>
        )}
      </main>

      {/* Floating Add To-Do button */}
      <button
        onClick={() => { switchTab('todo'); setAddTodoTrigger(t => t + 1); }}
        title="Add To-Do"
        className="fixed bottom-6 right-6 z-50 w-14 h-14 bg-blue-600 hover:bg-blue-700 text-white text-2xl font-light rounded-full shadow-xl flex items-center justify-center transition-transform hover:scale-110 active:scale-95">
        +
      </button>

      {/* Footer */}
      <footer className="bg-gray-800 text-gray-300 text-xs px-6 py-2 text-center">
        <p>
          My Tracker v3.0 | Issues:{' '}
          {activeTab === 'tasks'   ? `${issues.length} sprint + ${myIssues.length} me` :
           activeTab === 'defects' ? defects.length :
           activeTab === 'archive' ? 'loaded in tab' : 'loaded in tab'} |{' '}
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
