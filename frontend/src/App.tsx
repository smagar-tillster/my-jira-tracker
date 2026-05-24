import { useState, useEffect, useRef } from 'react';
import IssueTracker from './components/IssueTracker';
import MyIssuesTracker from './components/MyIssuesTracker';
import DefectsTracker from './components/DefectsTracker';
import { jiraApi } from './services/api';
import { JiraIssue } from './types';

function App() {
  const [issues, setIssues] = useState<JiraIssue[]>([]);
  const [myIssues, setMyIssues] = useState<JiraIssue[]>([]);
  const [defects, setDefects] = useState<JiraIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [myLoading, setMyLoading] = useState(true);
  const [defectsLoading, setDefectsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<'sprint' | 'me' | 'defects'>('sprint');
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [filterIds, setFilterIds] = useState<{ sprint: string; me: string; defects: string }>({
    sprint: '60259',
    me: '47216',
    defects: '57474',
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

  const fetchIssues = async () => {
    try {
      setLoading(true);
      setError(null);
      // Use backend JIRA_FILTER_ID from .env (60259 - current sprint)
      const data = await jiraApi.getIssues(false);
      
      // Fetch tags and important flags and merge with issues
      const [tags, importantFlags] = await Promise.all([
        jiraApi.getAllTags(),
        jiraApi.getAllImportantFlags(),
      ]);
      
      const issuesWithMetadata = data.map(issue => ({
        ...issue,
        tags: tags[issue.key] || [],
        important: importantFlags[issue.key] || false,
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
  };

  const fetchMyIssues = async () => {
    try {
      setMyLoading(true);
      setError(null);
      // Use configurable filter ID for "Me" view (all tickets assigned to current user)
      const data = await jiraApi.getIssuesFromFilter(filterIds.me);
      
      // Fetch tags and important flags and merge with issues
      const [tags, importantFlags] = await Promise.all([
        jiraApi.getAllTags(),
        jiraApi.getAllImportantFlags(),
      ]);
      
      const issuesWithMetadata = data.map(issue => ({
        ...issue,
        tags: tags[issue.key] || [],
        important: importantFlags[issue.key] || false,
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
  };

  const fetchDefects = async () => {
    try {
      setDefectsLoading(true);
      setError(null);
      // Use configurable filter ID for "Defects" view
      const data = await jiraApi.getIssuesFromFilter(filterIds.defects);
      
      // Fetch tags and important flags and merge with issues
      const [tags, importantFlags] = await Promise.all([
        jiraApi.getAllTags(),
        jiraApi.getAllImportantFlags(),
      ]);
      
      const issuesWithMetadata = data.map(issue => ({
        ...issue,
        tags: tags[issue.key] || [],
        important: importantFlags[issue.key] || false,
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
  };

  useEffect(() => {
    // Only fetch issues once after filter IDs are loaded
    if (filterIds.sprint && filterIds.me && filterIds.defects && !initialFetchDone.current) {
      initialFetchDone.current = true;
      fetchIssues();
      fetchMyIssues();
      fetchDefects();
    }
  }, [filterIds]);

  return (
    <div className="h-screen flex flex-col bg-gray-100">
      {/* Header */}
      <header className="bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-md relative">
        <div className="px-6 py-2 flex items-center justify-between">
          <h1 className="text-xl font-bold">📊 Jira Task Tracker</h1>
          <div className="flex gap-2 items-center">
            {/* Error Message - Top Right */}
            {error && (
              <div className="bg-red-500 text-white px-3 py-1 rounded text-xs max-w-md truncate" title={error}>
                ❌ {error}
              </div>
            )}
            <button
              onClick={() => setActiveView('sprint')}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                activeView === 'sprint'
                  ? 'bg-white text-blue-700'
                  : 'bg-blue-500 text-white hover:bg-blue-400'
              }`}
            >
              Current Sprint
            </button>
            <button
              onClick={() => setActiveView('me')}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                activeView === 'me'
                  ? 'bg-white text-blue-700'
                  : 'bg-blue-500 text-white hover:bg-blue-400'
              }`}
            >
              Me
            </button>
            <button
              onClick={() => setActiveView('defects')}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                activeView === 'defects'
                  ? 'bg-white text-blue-700'
                  : 'bg-blue-500 text-white hover:bg-blue-400'
              }`}
            >
              Defects
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-hidden">
        {activeView === 'sprint' ? (
          <IssueTracker issues={issues} loading={loading} onRefresh={fetchIssues} />
        ) : activeView === 'me' ? (
          <MyIssuesTracker issues={myIssues} loading={myLoading} onRefresh={fetchMyIssues} />
        ) : (
          <DefectsTracker issues={defects} loading={defectsLoading} onRefresh={fetchDefects} />
        )}
      </main>

      {/* Footer */}
      <footer className="bg-gray-800 text-gray-300 text-xs px-6 py-2 text-center">
        <p>
          Jira Tracker v2.0 | Total Issues: {activeView === 'sprint' ? issues.length : activeView === 'me' ? myIssues.length : defects.length} | 
          Last Refresh: {lastRefresh.toLocaleTimeString()}
        </p>
      </footer>
    </div>
  );
}

export default App;
