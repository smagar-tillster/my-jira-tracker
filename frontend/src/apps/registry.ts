export type AppSection = 'apps' | 'tools';

export interface AppDef {
  id: string;
  name: string;
  description: string;
  icon: string;
  section: AppSection;
  /** Extra search terms beyond name/description. */
  keywords?: string[];
  /** Not built yet: opens a placeholder tab. */
  comingSoon?: boolean;
}

// Fleet monitoring page. Defaults to the same host as this page so it follows the Mac's IP.
export const FLEET_URL =
  import.meta.env.VITE_FLEET_URL || `${window.location.protocol}//${window.location.hostname}:8080/fleet`;

// Order here is the order shown in the drawer.
export const APPS: AppDef[] = [
  { id: 'tasks',         name: 'Tasks',                 icon: '📋', section: 'apps', description: 'Sprint and personal Jira tasks', keywords: ['jira', 'sprint', 'issues'] },
  { id: 'quickAnalysis', name: 'Quick Analysis',        icon: '🔍', section: 'apps', description: 'Concerns across releases and sprints', keywords: ['concerns', 'risk', 'overdue'] },
  { id: 'releases',      name: 'Release & PRs',         icon: '📦', section: 'apps', description: 'What was released, what is next, and PRs', keywords: ['release', 'pull request', 'delivery'] },
  { id: 'prReviews',     name: 'PR Reviews',            icon: '📝', section: 'apps', description: 'Code review drafts for open PRs: read, then post', keywords: ['review', 'pull request', 'github', 'comments', 'drafts'] },
  { id: 'monitoring',    name: 'Monitoring',            icon: '📡', section: 'apps', description: 'Fleet health and New Relic conditions', keywords: ['fleet', 'kiosk', 'health', 'newrelic', 'new relic', 'alerts', 'conditions', 'nr'] },
  { id: 'mytester',      name: 'MyTester',              icon: '🧪', section: 'apps', description: 'Test reports', keywords: ['test', 'qa', 'report'] },
  { id: 'defects',       name: 'Defects',               icon: '🐞', section: 'apps', description: 'Defect reports', keywords: ['bugs', 'report'] },
  { id: 'accomplishments', name: 'Accomplishments',     icon: '🏆', section: 'apps', description: 'Sprint highlights and manual entries', comingSoon: true, keywords: ['wins', 'highlights'] },

  { id: 'configViewer',  name: 'Config Viewer',         icon: '⚙️', section: 'tools', description: 'Browse tenant configuration', comingSoon: true, keywords: ['tenant', 'json'] },
  { id: 'menuCompare',   name: 'Menu Compare',          icon: '🍔', section: 'tools', description: 'Compare menus between environments', comingSoon: true, keywords: ['diff', 'menu'] },
];

export const APP_BY_ID: Record<string, AppDef> = Object.fromEntries(APPS.map(a => [a.id, a]));

export const SECTION_LABELS: Record<AppSection, string> = { apps: 'Apps', tools: 'Tools' };

export const matchesQuery = (app: AppDef, query: string): boolean => {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [app.name, app.description, ...(app.keywords || [])].join(' ').toLowerCase().includes(q);
};
