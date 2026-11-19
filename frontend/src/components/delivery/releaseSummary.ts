// Release summary: what was deployed, by tenant and day, with software kept apart from content (menu, assets, configs).
// Pure functions (no React), so node --test can run them from backend/delivery/test.

export type ContentGroup = 'Menu' | 'Assets' | 'Configs';
export type ComponentKind = { kind: 'software' } | { kind: 'content'; group: ContentGroup };
export const CONTENT_GROUPS: ContentGroup[] = ['Menu', 'Assets', 'Configs'];

// Order matters: software names win ("Kiosk Menu Service" is software, not menu), assets win over configs ("media/layout/images" is an asset).
const SOFTWARE = /service|client|^(fe|sw|ws)\b/i;
const CONFIG_FILE = /\.(json|properties|xsl|xml|html)$/i;
const MENU =/menu|sku|nutrition/i;
const ASSETS = /image|media[\\/]|asset|theme|style|banner|attract|screensaver|campaign[\\/]/i;
const CONFIGS = /^(occ|lpid)$|config|\.json|\.properties|\.xsl|\.html|translation|language|receipt|coupon|promotion|profanity|layout|localization|metadata/i;

/** Software unless the name looks like menu, asset or config content. A name nobody recognizes counts as software. */
export const classifyComponent = (name: string): ComponentKind => {
  if (SOFTWARE.test(name)) return { kind: 'software' };
  if (CONFIG_FILE.test(name)) return { kind: 'content', group: 'Configs' }; // a config file, whatever its name says ("attract-loop.properties")
  if (MENU.test(name)) return { kind: 'content', group: 'Menu' };
  if (ASSETS.test(name)) return { kind: 'content', group: 'Assets' };
  if (CONFIGS.test(name)) return { kind: 'content', group: 'Configs' };
  return { kind: 'software' };
};

export interface SummaryInput {
  tenant: string; date: string; env: string; released: boolean;
  key?: string | null; url?: string | null; status?: string;
  components: { name: string; version: string }[];
}
export interface ComponentLine { name: string; version: string }
export interface SummaryTicket { key: string; url: string | null; status: string }
export interface SummaryEntry {
  date: string; env: string; released: boolean;
  /** The release tickets behind this entry (one per ticket key). */
  tickets: SummaryTicket[];
  software: ComponentLine[];
  content: Record<ContentGroup, ComponentLine[]>;
}
export interface TenantSummary { tenant: string; entries: SummaryEntry[] }

const addUnique = (list: ComponentLine[], c: ComponentLine) => {
  const hit = list.find(x => x.name === c.name);
  if (!hit) list.push({ ...c });
  else if (!hit.version && c.version) hit.version = c.version;
};

/** One entry per tenant, day and env (release tickets of the same release merge). Tenants A to Z; entries newest day first, PROD before UAT/LAB. */
export const buildReleaseSummary = (rows: SummaryInput[]): TenantSummary[] => {
  const tenants = new Map<string, Map<string, SummaryEntry>>();
  for (const r of rows) {
    const entries = tenants.get(r.tenant) ?? new Map<string, SummaryEntry>();
    tenants.set(r.tenant, entries);
    const k = `${r.date}|${r.env}`;
    const e = entries.get(k) ?? { date: r.date, env: r.env, released: true, tickets: [], software: [], content: { Menu: [], Assets: [], Configs: [] } };
    entries.set(k, e);
    e.released = e.released && r.released;
    if (r.key && !e.tickets.some(t => t.key === r.key)) e.tickets.push({ key: r.key, url: r.url ?? null, status: r.status ?? '' });
    for (const c of r.components) {
      const kind = classifyComponent(c.name);
      addUnique(kind.kind === 'software' ? e.software : e.content[kind.group], c);
    }
  }
  const prodFirst = (a: string, b: string) => Number(/PROD/i.test(b)) - Number(/PROD/i.test(a));
  return [...tenants.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'en', { sensitivity: 'base' }))
    .map(([tenant, entries]) => ({
      tenant,
      entries: [...entries.values()].sort((a, b) => b.date.localeCompare(a.date) || prodFirst(a.env, b.env)),
    }));
};

export type ReleaseType = 'Software' | ContentGroup;
export const RELEASE_TYPES: ReleaseType[] = ['Software', ...CONTENT_GROUPS];
export const typeOfComponent = (name: string): ReleaseType => { const k = classifyComponent(name); return k.kind === 'software' ? 'Software' : k.group; };

/** Keep only the components of the chosen types, and drop releases left with none. No types chosen = everything. */
export const filterByType = <R extends { components: { name: string; version: string }[] }>(rows: R[], types: string[]): R[] => {
  if (types.length === 0) return rows;
  return rows
    .map(r => ({ ...r, components: r.components.filter(c => types.includes(typeOfComponent(c.name))) }))
    .filter(r => r.components.length > 0);
};
