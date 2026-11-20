import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  quickApi, jiraApi, jiraIcon, QuickReport, QuickStatus, QuickTicket, QuickNewTicket, QuickFeCandidate, QuickGroup, QuickSize,
} from '../services/api';
import { BUCKET_PILL } from '../utils/statusBuckets';
import { parseLocalDate } from '../utils/dateUtils';
import { ListControls } from './delivery/shared';
import { filterRows } from './delivery/search';
import TenantGroupList from './delivery/TenantGroupList';
import { GroupOrder, cleanTenants, groupByTenant } from './delivery/tenantGrouping';

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const dayTime = (iso: string) => {
  const d = new Date(iso);
  const same = d.toDateString() === new Date().toDateString();
  return same ? timeOf(iso) : `${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} ${timeOf(iso)}`;
};
const hour = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`;
const shortDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

const SIZE_PILL: Record<QuickSize, string> = {
  S: 'bg-green-100 text-green-800', M: 'bg-sky-100 text-sky-800', L: 'bg-amber-100 text-amber-800', XL: 'bg-red-100 text-red-800',
};
const SIZE_HINT: Record<QuickSize, string> = { S: 'About a day or less', M: 'Two to three days', L: 'About a week', XL: 'More than a week, or split it first' };
const TicketLink = ({ t }: { t: Pick<QuickTicket, 'key' | 'url'> }) => (
  <a href={t.url} target="_blank" rel="noopener noreferrer" title={`Open ${t.key} in Jira`} className="font-semibold text-blue-700 hover:underline whitespace-nowrap">{t.key}</a>
);
const StatusPill = ({ t }: { t: Pick<QuickTicket, 'status' | 'bucket'> }) => (
  <span className={`px-2 py-0.5 rounded text-xs whitespace-nowrap ${BUCKET_PILL[t.bucket]}`}>{t.status}</span>
);
const Pills = ({ items }: { items: string[] }) => (
  <>{items.map(c => <span key={c} className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800 ring-1 ring-gray-200">{c}</span>)}</>
);

/** The ticket type as Jira draws it: Jira's own icon, with the type's name as the tooltip. No icon, or one that does not load, gives a plain letter tile. */
const TypeIcon = ({ type, icon }: { type: string; icon?: string | null }) => {
  const [failed, setFailed] = useState(false);
  return (
    <span className="inline-flex w-5 justify-center align-text-bottom shrink-0" title={type}>
      {icon && !failed
        ? <img src={jiraIcon(icon)} alt={type} width={16} height={16} className="w-4 h-4" onError={() => setFailed(true)} />
        : <span aria-label={type} className="inline-flex w-4 h-4 items-center justify-center rounded bg-gray-200 text-[10px] font-semibold text-gray-600">{String(type || '?').charAt(0).toUpperCase()}</span>}
    </span>
  );
};

/** The earlier of the due and release dates, labeled, red when before today. */
const DateChip = ({ t }: { t: QuickTicket }) => {
  const due = parseLocalDate(t.dueDate); const rel = parseLocalDate(t.releaseDate);
  const pick = due && rel ? (due <= rel ? { d: due, l: 'Due' } : { d: rel, l: 'Release' }) : due ? { d: due, l: 'Due' } : rel ? { d: rel, l: 'Release' } : null;
  if (!pick) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const late = pick.d < today && t.bucket !== 'done';
  return <span className={`px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap ${late ? 'bg-red-100 text-red-800 ring-1 ring-red-300' : 'bg-gray-100 text-gray-700'}`}>{pick.l} {shortDate(pick.d)}</span>;
};

const Empty = ({ children }: { children: React.ReactNode }) => <div className="p-8 text-center text-sm text-gray-400">{children}</div>;

// ---------------------------------------------------------------- one grouped, searchable list (the same look as the Release & PRs lists)
/** One way to group a list. A spec without `tenantsOf` is "None": the rows are shown as one flat table. */
interface GroupSpec<T> { id: string; label: string; hint?: string; tenantsOf?: (item: T) => string[]; order?: GroupOrder<T>; fallback?: string }

/** Largest group first (ties A to Z). Every grouping on these pages sorts like this. */
const mostFirst = <T,>(): GroupOrder<T> => (a, b) => b.items.length - a.items.length || a.tenant.localeCompare(b.tenant, 'en', { sensitivity: 'base' });

const CountPill = ({ n, label }: { n: number; label: string }) => (
  <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-700 ring-1 ring-gray-200 whitespace-nowrap">{n} {label}{n === 1 ? '' : 's'}</span>
);

function QuickList<T>({ items, unit, groups, summary, alert, textOf, placeholder, extra, before, table, empty }: {
  items: T[]; unit: string; groups: GroupSpec<T>[];
  summary: (items: T[], group: string) => React.ReactNode; alert?: (items: T[], group: string) => boolean;
  textOf: (item: T) => string; placeholder: string; extra?: React.ReactNode; before?: (group: string, items: T[]) => React.ReactNode;
  table: (items: T[]) => React.ReactNode; empty: string;
}) {
  const [groupBy, setGroupBy] = useState(groups[0].id);
  const [query, setQuery] = useState('');
  const [cmd, setCmd] = useState({ open: false, n: 0 });
  const [allOpen, setAllOpen] = useState(false);
  const spec = groups.find(g => g.id === groupBy) || groups[0];
  const shown = useMemo(() => filterRows(items, query, textOf), [items, query, textOf]);
  const tenantsOf = spec.tenantsOf;
  // The group order is worked out when a Group by is picked (or the tab is opened) and then held: marking tickets read, a new run or a search
  // never moves a group while you are looking at it. Switching away and back sorts again. A group that appears later goes to the end.
  const seenBy = useRef(spec.id);
  const frozen = useRef<{ names: string[] } | null>(null);
  if (seenBy.current !== spec.id) { seenBy.current = spec.id; frozen.current = null; }
  if (tenantsOf && (!frozen.current || (frozen.current.names.length === 0 && items.length > 0))) {
    frozen.current = { names: groupByTenant(items, tenantsOf, spec.order, spec.fallback).groups.map(g => g.tenant) };
  }
  const names = tenantsOf ? frozen.current?.names : undefined;
  const heldOrder = useMemo<GroupOrder<T> | undefined>(() => {
    if (!names) return spec.order;
    const rank = new Map(names.map((n, i) => [n.toLowerCase(), i] as const));
    return (a, b) => (rank.get(a.tenant.toLowerCase()) ?? names.length) - (rank.get(b.tenant.toLowerCase()) ?? names.length)
      || b.items.length - a.items.length || a.tenant.localeCompare(b.tenant, 'en', { sensitivity: 'base' });
  }, [names, spec.order]);
  const groupCount = tenantsOf ? new Set(shown.flatMap(i => cleanTenants(tenantsOf(i), spec.fallback))).size : 0;
  return (
    <>
      <ListControls groups={groups.map(g => ({ id: g.id, label: g.label, hint: g.hint }))} groupBy={spec.id} onGroupBy={setGroupBy} query={query} onQuery={setQuery}
        shown={shown.length} total={items.length} unit={unit} allOpen={allOpen} onToggleAll={tenantsOf ? () => setCmd(c => ({ open: !allOpen, n: c.n + 1 })) : undefined} placeholder={placeholder}
        extra={<>{extra}<CountPill n={shown.length} label={unit} />{tenantsOf && <CountPill n={groupCount} label={spec.label.toLowerCase()} />}</>} />
      {items.length === 0 ? <Empty>{empty}</Empty> : shown.length === 0 ? <Empty>Nothing matches &ldquo;{query.trim()}&rdquo;.</Empty> : !tenantsOf ? (
        <div className="rounded-lg border border-gray-200 bg-white overflow-clip">{table(shown)}</div>
      ) : (
        <TenantGroupList command={cmd} onAllOpenChange={setAllOpen} items={shown} tenantsOf={tenantsOf} unit={unit} summary={summary} alert={alert} hideIntro
          groupLabel={spec.label.toLowerCase()} fallback={spec.fallback} order={heldOrder} orderLabel="most first" expandAll={!!query.trim()}>
          {(rows, group) => <>{before?.(group, rows)}{table(rows)}</>}
        </TenantGroupList>
      )}
    </>
  );
}

const TABLE = 'w-full table-fixed text-[14px] leading-[22px] [overflow-wrap:anywhere]';
const THEAD = 'bg-gray-50 text-left text-[13px] font-semibold text-gray-600 border-b border-gray-200';
const TH = 'px-2 py-[7px]';
const TD = 'px-2 py-2 align-top';
const ROW = 'border-t border-gray-100 hover:bg-gray-50';

/** The ticket cell: the type icon, the key as a link and the summary, with the given tags underneath. */
const TicketCell = ({ t, tags }: { t: QuickTicket; tags?: React.ReactNode }) => (
  <div className="min-w-0">
    <div className="text-gray-800"><TypeIcon type={t.type} icon={t.typeIcon} /> <TicketLink t={t} /> {t.summary}</div>
    {tags && <div className="mt-1.5 flex flex-wrap items-center gap-1.5">{tags}</div>}
  </div>
);

// ---------------------------------------------------------------- 1. new tickets
const newTextOf = (t: QuickNewTicket) => [t.key, t.summary, t.assignee, t.status, t.description, ...t.clients].join(' ');
const NEW_GROUPS: GroupSpec<QuickNewTicket>[] = [
  { id: 'none', label: 'None', hint: 'One list, no groups' },
  { id: 'client', label: 'Client', hint: 'One group per client (a ticket for several clients appears under each)', tenantsOf: t => t.clients, order: mostFirst<QuickNewTicket>() },
  { id: 'assignee', label: 'Assignee', hint: 'One group per person', tenantsOf: t => [t.assignee || 'Unassigned'], order: mostFirst<QuickNewTicket>(), fallback: 'Unassigned' },
];

export type QuickFlag = 'important' | 'myDay';
export type QuickFlags = Record<QuickFlag, Record<string, boolean>>;

/** The same two marks as the Tasks list: ⭐ Imp and ☀️ My Day (the follow-up list). Marking here shows there, and the other way round. */
const FlagButtons = ({ k, flags, onFlag }: { k: string; flags: QuickFlags; onFlag: (flag: QuickFlag, key: string) => void }) => {
  const imp = !!flags.important[k]; const day = !!flags.myDay[k];
  const cls = (on: boolean) => `w-6 text-center text-[16px] leading-none cursor-pointer hover:scale-110 transition-all ${on ? 'opacity-100 grayscale-0' : 'opacity-30 grayscale hover:opacity-60'}`;
  return (
    <div className="flex gap-2 items-center">
      <button onClick={() => onFlag('important', k)} className={cls(imp)} title={imp ? 'Remove Imp' : 'Mark Imp'} aria-pressed={imp}>⭐</button>
      <button onClick={() => onFlag('myDay', k)} className={cls(day)} title={day ? 'Remove from My Day (follow up)' : 'Add to My Day (follow up)'} aria-pressed={day}>☀️</button>
    </div>
  );
};

const NewTickets = ({ all, showRead, onToggleRead, onRead, flags, onFlag }: {
  all: QuickNewTicket[]; showRead: boolean; onToggleRead: () => void; onRead: (key: string, read: boolean) => void; flags: QuickFlags; onFlag: (flag: QuickFlag, key: string) => void;
}) => {
  const [onlyImp, setOnlyImp] = useState(false);
  const [onlyDay, setOnlyDay] = useState(false);
  const readCount = all.filter(t => t.read).length;
  const impCount = all.filter(t => flags.important[t.key]).length;
  const dayCount = all.filter(t => flags.myDay[t.key]).length;
  // Filtering by a mark shows every marked ticket, read or not, so a follow-up never hides behind the read mark.
  const items = onlyImp || onlyDay
    ? all.filter(t => (!onlyImp || flags.important[t.key]) && (!onlyDay || flags.myDay[t.key]))
    : showRead ? all : all.filter(t => !t.read);
  const toggle = (on: boolean, set: (v: boolean) => void, label: string, n: number) => (
    <button onClick={() => set(!on)} aria-pressed={on} disabled={!on && n === 0}
      className={`px-3 py-1 rounded-lg text-sm font-medium whitespace-nowrap ring-1 disabled:opacity-40 disabled:cursor-not-allowed ${on ? 'bg-blue-600 text-white ring-blue-600' : 'bg-white text-gray-700 ring-gray-300 hover:bg-gray-100'}`}>{label} ({n})</button>
  );
  return (
    <QuickList items={items} unit="ticket" groups={NEW_GROUPS} textOf={newTextOf} placeholder="Search key, summary, assignee or description…"
      empty={onlyImp || onlyDay ? 'No tickets with these marks.' : 'Nothing new since you last read. New tickets added to the sprint show up here.'}
      extra={<>
        {readCount > 0 && <button onClick={onToggleRead} className="px-3 py-1 rounded-lg text-sm font-medium bg-white ring-1 ring-gray-300 text-gray-700 hover:bg-gray-100 whitespace-nowrap">{showRead ? 'Hide' : 'Show'} read ({readCount})</button>}
        {toggle(onlyImp, setOnlyImp, '⭐ Imp', impCount)}
        {toggle(onlyDay, setOnlyDay, '☀️ My Day', dayCount)}
      </>}
      summary={(rows) => { const unread = rows.filter(t => !t.read).length; const fe = rows.filter(t => t.fe).length; return `${rows.length} ticket${rows.length === 1 ? '' : 's'} · ${unread} unread${fe ? ` · ${fe} FE` : ''}`; }}
      table={(rows) => (
        <table className={TABLE}>
          <thead className={THEAD}><tr>
            <th className={`${TH} w-[64px]`}>Read</th><th className={`${TH} w-[84px]`}>Mark</th><th className={`${TH} w-[32%]`}>Ticket</th><th className={`${TH} w-[150px]`}>Status</th>
            <th className={`${TH} w-[160px]`}>Assignee</th><th className={`${TH} w-[130px]`}>Added</th><th className={TH}>Description</th>
          </tr></thead>
          <tbody>
            {rows.map(t => (
              <tr key={t.key} className={`${ROW} ${t.read ? 'opacity-60' : ''}`}>
                <td className={TD}>
                  <button onClick={() => onRead(t.key, !t.read)} aria-pressed={t.read}
                    title={t.read ? 'Read. Click to mark unread' : 'Mark as read: it is skipped from the next run on'}
                    className={`w-8 h-8 rounded-full ring-1 flex items-center justify-center text-sm ${t.read ? 'bg-green-100 ring-green-300 text-green-700' : 'bg-white ring-gray-300 text-gray-500 hover:bg-blue-50 hover:text-blue-700'}`}>
                    {t.read ? '✓' : '👁'}
                  </button>
                </td>
                <td className={`${TD} pt-[11px]`}><FlagButtons k={t.key} flags={flags} onFlag={onFlag} /></td>
                <td className={TD}><TicketCell t={t} tags={<><Pills items={t.clients} />{t.fe && <span className="px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-800">FE</span>}</>} /></td>
                <td className={TD}><StatusPill t={t} /></td>
                <td className={`${TD} text-gray-700`}>{t.assignee || <span className="text-gray-400">Unassigned</span>}</td>
                <td className={`${TD} text-xs text-gray-500`}>{dayTime(t.firstSeenAt)}</td>
                <td className={TD}>{t.description ? <p className="text-sm text-gray-700 line-clamp-4">{t.description}</p> : <p className="text-sm text-gray-400">No description on the ticket.</p>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )} />
  );
};

// ---------------------------------------------------------------- 2. FE ticket assignment
const feTextOf = (c: QuickFeCandidate) => [c.key, c.summary, c.assignee, c.status, c.analysis, c.suggestion?.name, ...c.clients, ...c.areas].join(' ');
const FE_GROUPS: GroupSpec<QuickFeCandidate>[] = [
  { id: 'none', label: 'None', hint: 'One list, no groups' },
  { id: 'client', label: 'Client', hint: 'One group per client', tenantsOf: c => c.clients, order: mostFirst<QuickFeCandidate>() },
];

const FeTeam = ({ team }: { team: QuickReport['feTeam'] }) => (
  <table className="w-full text-sm">
    <thead><tr className="text-left text-xs text-gray-500"><th className="py-1 pr-3 font-medium">Who</th><th className="py-1 pr-3 font-medium w-20">Aligned</th><th className="py-1 pr-3 font-medium w-20">Blocked</th><th className="py-1 font-medium">Working for</th></tr></thead>
    <tbody>
      {team.map(m => (
        <tr key={m.name} className="border-t border-gray-100 align-top">
          <td className="py-1.5 pr-3 font-medium text-gray-800 whitespace-nowrap">{m.name}</td>
          <td className="py-1.5 pr-3"><span className="px-2 py-0.5 rounded bg-orange-100 text-orange-800 text-xs">{m.aligned}</span></td>
          <td className="py-1.5 pr-3 text-gray-600">{m.blocked || '–'}</td>
          <td className="py-1.5"><div className="flex flex-wrap gap-1">{m.clients.length ? m.clients.map(c => <span key={c.name} className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-800 ring-1 ring-gray-200">{c.name} {c.n}</span>) : <span className="text-gray-400 text-xs">nothing aligned</span>}</div></td>
        </tr>
      ))}
    </tbody>
  </table>
);

const FeAssignment = ({ report, showTeam, onToggleTeam }: { report: QuickReport; showTeam: boolean; onToggleTeam: () => void }) => (
  <>
    {showTeam && report.feTeam.length > 0 && (
      <div className="mb-3 p-3 rounded-lg bg-white border border-gray-200">
        <FeTeam team={report.feTeam} />
        <p className="text-xs text-gray-500 mt-2">Aligned means in progress and not blocked. Suggestions go by this load and by related work, and each one counts the suggestions above it so one person is not offered everything. They are a starting point, you decide.</p>
      </div>
    )}
    <QuickList items={report.feCandidates} unit="ticket" groups={FE_GROUPS} textOf={feTextOf} placeholder="Search key, summary, client, area or person…"
      empty="No FE tickets to place right now."
      extra={report.feTeam.length > 0 ? <button onClick={onToggleTeam} className="px-3 py-1 rounded-lg text-sm font-medium bg-white ring-1 ring-gray-300 text-gray-700 hover:bg-gray-100 whitespace-nowrap">{showTeam ? 'Hide' : 'Show'} who has what</button> : undefined}
      summary={(rows) => {
        const n = rows.filter(c => c.origin === 'new').length; const m = rows.length - n;
        const sizes = ['S', 'M', 'L', 'XL'].map(z => [z, rows.filter(c => c.size === z).length] as const).filter(([, k]) => k > 0).map(([z, k]) => `${z} ${k}`).join(' · ');
        return `${rows.length} ticket${rows.length === 1 ? '' : 's'} · ${n} new · ${m} mine${sizes ? ` · ${sizes}` : ''}`;
      }}
      table={(rows) => (
        <table className={TABLE}>
          <thead className={THEAD}><tr>
            <th className={`${TH} w-[72px]`}>From</th><th className={`${TH} w-[26%]`}>Ticket</th><th className={`${TH} w-[84px]`}>Size</th><th className={`${TH} w-[140px]`}>Status</th>
            <th className={`${TH} w-[130px]`}>Date</th><th className={`${TH} w-[130px]`}>Now with</th><th className={TH}>Analysis</th><th className={`${TH} w-[22%]`}>Suggestion</th>
          </tr></thead>
          <tbody>
            {rows.map(c => (
              <tr key={`${c.origin}-${c.key}`} className={ROW}>
                <td className={TD}><span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${c.origin === 'new' ? 'bg-sky-100 text-sky-800' : 'bg-gray-100 text-gray-700'}`}>{c.origin === 'new' ? 'New' : 'Mine'}</span></td>
                <td className={TD}><TicketCell t={c} tags={<><Pills items={c.clients} />{c.areas.map(a => <span key={a} className="px-1.5 py-0.5 rounded text-xs text-gray-600 bg-white ring-1 ring-gray-200">{a}</span>)}</>} /></td>
                <td className={TD}>{c.size
                  ? <span title={`${SIZE_HINT[c.size]}${c.sizeWhy ? `\n${c.sizeWhy}` : ''}`} className={`px-2 py-0.5 rounded text-xs font-bold ${SIZE_PILL[c.size]}`}>Size {c.size}</span>
                  : <span className="px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-500" title="No size could be written for this ticket">No size</span>}</td>
                <td className={TD}><StatusPill t={c} /></td>
                <td className={TD}><DateChip t={c} /></td>
                <td className={`${TD} text-gray-700`}>{c.assignee || <span className="text-gray-400">unassigned</span>}</td>
                <td className={TD}><p className="text-sm text-gray-700">{c.analysis}</p>{c.sizeWhy && <p className="text-xs text-gray-500 mt-0.5">Size: {c.sizeWhy}</p>}</td>
                <td className={TD}>
                  {c.suggestion ? (
                    <div className="rounded-md bg-indigo-50 border border-indigo-100 px-3 py-1.5 text-sm text-indigo-900">
                      <span className="font-semibold">Suggest {c.suggestion.name}.</span> <span className="text-indigo-800">{c.suggestion.why.replace(`${c.suggestion.name}: `, '')}</span>
                      {c.suggestion.alternatives.length > 0 && <span className="text-indigo-700"> Also: {c.suggestion.alternatives.map(a => `${a.name} (${a.aligned})`).join(', ')}.</span>}
                    </div>
                  ) : <p className="text-xs text-gray-400">No suggestion: no one else on the FE team to offer it to.</p>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )} />
  </>
);

// ---------------------------------------------------------------- 3. my tickets
type MineRow = QuickGroup['tickets'][number] & { groupTitle: string };
const PRIORITY_LABEL: Record<QuickGroup['priority'], string> = { high: 'High', medium: 'Medium', low: 'Low' };
const PRIORITY_CHIP: Record<QuickGroup['priority'], string> = { high: 'bg-red-100 text-red-800', medium: 'bg-amber-100 text-amber-800', low: 'bg-gray-100 text-gray-700' };
const mineTextOf = (t: MineRow) => [t.key, t.summary, t.status, t.groupTitle, ...t.clients].join(' ');

const MyTickets = ({ mine, source }: { mine: QuickGroup[]; source: 'ai' | 'rules' }) => {
  const rows = useMemo<MineRow[]>(() => mine.flatMap(g => g.tickets.map(t => ({ ...t, groupTitle: g.title }))), [mine]);
  const byTitle = useMemo(() => new Map(mine.map((g, i) => [g.title, { g, i }])), [mine]);
  const groups = useMemo<GroupSpec<MineRow>[]>(() => [{
    id: 'meaning', label: source === 'ai' ? 'Meaning' : 'Client and date', hint: source === 'ai' ? 'Grouped by meaning (AI-assisted); priority is never lower than the dates say' : 'Grouped by client and date',
    tenantsOf: t => [t.groupTitle], order: (a, b) => (byTitle.get(a.tenant)?.i ?? 0) - (byTitle.get(b.tenant)?.i ?? 0),
  }], [byTitle, source]);
  return (
    <QuickList items={rows} unit="ticket" groups={groups} textOf={mineTextOf} placeholder="Search key, summary, client or group…" empty="Nothing open on your list."
      alert={(_, title) => byTitle.get(title)?.g.priority === 'high'}
      summary={(items, title) => { const g = byTitle.get(title)?.g; return `${g ? `${PRIORITY_LABEL[g.priority]} priority · ` : ''}${items.length} ticket${items.length === 1 ? '' : 's'}`; }}
      before={(title) => {
        const g = byTitle.get(title)?.g;
        if (!g || (!g.why && !g.action)) return null;
        return (
          <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 text-sm">
            <span className={`mr-2 px-2 py-0.5 rounded-full text-xs font-medium ${PRIORITY_CHIP[g.priority]}`}>{PRIORITY_LABEL[g.priority]}</span>
            {g.why && <span className="text-gray-600">{g.why}</span>}
            {g.action && <p className="mt-1 text-gray-900"><span className="font-semibold">Next:</span> {g.action}</p>}
          </div>
        );
      }}
      table={(items) => (
        <table className={TABLE}>
          <thead className={THEAD}><tr>
            <th className={`${TH} w-[46%]`}>Ticket</th><th className={`${TH} w-[160px]`}>Status</th><th className={TH}>Client</th><th className={`${TH} w-[160px]`}>Date</th>
          </tr></thead>
          <tbody>
            {items.map(t => (
              <tr key={t.key} className={ROW}>
                <td className={TD}><TicketCell t={t} /></td>
                <td className={TD}><StatusPill t={t} /></td>
                <td className={TD}><div className="flex flex-wrap gap-1.5"><Pills items={t.clients} /></div></td>
                <td className={TD}><DateChip t={t} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )} />
  );
};

// ---------------------------------------------------------------- the page
/** Notes about a failed model call (sign-in expired, no size or grouping written) say nothing the person can act on here, so they are not shown. */
const isUsefulNote = (n: string) => !/Failed to authenticate|OAuth|model could not be used|could not be written/i.test(n);
/** The note about FE team members with no sprint ticket, said briefly. Any other note is shown as it is. */
const tidyNote = (n: string) => {
  const m = n.match(/^(\d+) FE [Tt]eam members? (?:have|has) no ticket in this sprint and (?:are|is) not offered work \((.+)\)\.?$/);
  return m ? `${m[1]} FE team member${m[1] === '1' ? '' : 's'} with no sprint ticket (not offered work): ${m[2]}` : n;
};

export type QuickTab = 'new' | 'fe' | 'mine';

export interface QuickViewProps {
  report: QuickReport | null; status: QuickStatus | null; error: string | null; loading: boolean;
  tab: QuickTab; onTab: (t: QuickTab) => void;
  showRead: boolean; showTeam: boolean;
  flags: QuickFlags; onFlag: (flag: QuickFlag, key: string) => void;
  onToggleRead: () => void; onToggleTeam: () => void; onRun: () => void; onSetRead: (key: string, read: boolean) => void;
}

/** What the page looks like for a given report and state. No data loading here, so it can be rendered on its own. */
export const QuickAnalysisView: React.FC<QuickViewProps> = ({ report, status, error, loading, tab, onTab, showRead, showTeam, flags, onFlag, onToggleRead, onToggleTeam, onRun, onSetRead }) => {
  const sched = status?.schedule;
  const unread = report?.newTickets.filter(t => !t.read) ?? [];
  const read = report?.newTickets.filter(t => t.read) ?? [];
  const notes = (report?.notes ?? []).filter(isUsefulNote).map(tidyNote);
  const tabs: { id: QuickTab; label: string; count?: number }[] = [
    { id: 'new', label: '🆕 New tickets', count: report ? unread.length : undefined },
    { id: 'fe', label: '🧩 FE ticket assignment', count: report?.feCandidates.length },
    { id: 'mine', label: '🎯 My tickets', count: report?.counts.myOpen },
  ];

  return (
    <div className="h-full flex flex-col bg-gray-50 overflow-hidden">
      <div className="bg-white border-b border-gray-200 px-4 py-2.5 flex items-center gap-2 flex-wrap">
        <span className="text-lg font-semibold text-gray-800 mr-3">🔍 Quick Analysis</span>
        {tabs.map(t => (
          <button key={t.id} onClick={() => onTab(t.id)} aria-current={tab === t.id ? 'page' : undefined}
            className={`inline-flex items-center gap-2 px-4 py-1.5 text-sm font-medium rounded-full border transition-colors ${tab === t.id ? 'bg-blue-600 border-blue-600 text-white shadow-sm' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-100 hover:border-gray-400'}`}>
            {t.label}{t.count !== undefined && <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${tab === t.id ? 'bg-white/25 text-white' : 'bg-gray-200 text-gray-700'}`}>{t.count}</span>}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-gray-500">
            {status?.running ? '⏳ Running now…'
              : status?.lastRunAt ? `Last run ${dayTime(status.lastRunAt)}${status.lastDurationMs ? ` (${Math.round(status.lastDurationMs / 1000)}s)` : ''}` : 'Not run yet'}
            {!status?.running && !status?.disabled && status?.nextRunAt && ` · next about ${dayTime(status.nextRunAt)}`}
            {status?.disabled && ' · automatic runs are off'}
          </span>
          {sched && <span className="text-xs text-gray-400" title="Set in backend/delivery/config.json, quickAnalysis">Every {sched.intervalMinutes} min, {hour(sched.startHour)} to {hour(sched.endHour)}{sched.weekdaysOnly ? ', Mon to Fri' : ''}</span>}
          <button onClick={onRun} disabled={!!status?.running}
            className="px-3 py-1.5 rounded-lg text-sm font-medium bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-60 disabled:cursor-not-allowed">
            {status?.running ? '⏳ Running…' : '🔄 Run now'}
          </button>
        </div>
      </div>

      {(error || status?.lastStatus === 'failed') && (
        <div className="px-4 py-2 text-sm bg-red-50 text-red-800 border-b border-red-200">
          ❌ {error || `The last run failed: ${status?.lastError || 'unknown error'}`}{report ? ' The report below is from the last good run.' : ''}
        </div>
      )}
      {notes.length > 0 && (
        <ul className="text-[15px] font-semibold text-gray-800 bg-white border-b border-gray-200 px-4 py-2.5 list-disc pl-9 space-y-1">{notes.map(n => <li key={n}>{n}</li>)}</ul>
      )}

      <div className="flex-1 overflow-auto p-4">
        {loading && !report && <p className="text-sm text-gray-500">Loading…</p>}
        {!loading && !report && !error && (
          <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-500">
            <div className="text-3xl mb-2">🔍</div>
            No report yet. It builds by itself during working hours, or press <b>Run now</b> to build the first one.
          </div>
        )}
        {report && tab === 'new' && <NewTickets all={[...unread, ...read]} showRead={showRead} onToggleRead={onToggleRead} onRead={onSetRead} flags={flags} onFlag={onFlag} />}
        {report && tab === 'fe' && <FeAssignment report={report} showTeam={showTeam} onToggleTeam={onToggleTeam} />}
        {report && tab === 'mine' && <MyTickets mine={report.myTickets.groups} source={report.myTickets.source} />}
      </div>
    </div>
  );
};

/** Quick Analysis: loads the report, follows a run in progress, and handles Run now and the read marks. */
const QuickAnalysis: React.FC<{ active?: boolean }> = ({ active = true }) => {
  const [report, setReport] = useState<QuickReport | null>(null);
  const [status, setStatus] = useState<QuickStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showRead, setShowRead] = useState(false);
  const [showTeam, setShowTeam] = useState(false);
  const [tab, setTab] = useState<QuickTab>('new');
  const [flags, setFlags] = useState<QuickFlags>({ important: {}, myDay: {} });
  const seen = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await quickApi.report();
      setReport(r.report); setStatus(r.status); seen.current = r.report?.generatedAt ?? null; setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load the report'); }
    finally { setLoading(false); }
  }, []);

  const markViewed = useCallback(() => {
    quickApi.viewed().then(s => { setStatus(s); window.dispatchEvent(new Event('quick-changed')); }).catch(() => { /* the bell just keeps its count */ });
  }, []);

  useEffect(() => { load(); }, [load]);

  // the Imp and My Day marks are the Tasks list's own, so they are read from the same place
  useEffect(() => {
    let alive = true;
    const loadFlags = () => Promise.all([jiraApi.getAllImportantFlags(), jiraApi.getAllMyDayFlags()])
      .then(([important, myDay]) => { if (alive) setFlags({ important, myDay }); }).catch(() => { /* the icons just show unmarked */ });
    loadFlags();
    window.addEventListener('focus', loadFlags); // marks changed on the Tasks page show up when you come back
    return () => { alive = false; window.removeEventListener('focus', loadFlags); };
  }, []);

  const toggleFlag = async (flag: QuickFlag, key: string) => {
    const next = !flags[flag][key];
    setFlags(f => ({ ...f, [flag]: { ...f[flag], [key]: next } }));
    try { await (flag === 'important' ? jiraApi.setIssueImportant(key, next) : jiraApi.setIssueMyDay(key, next)); }
    catch { setFlags(f => ({ ...f, [flag]: { ...f[flag], [key]: !next } })); } // not saved: put the icon back
  };

  // opening the page clears the bell
  useEffect(() => { if (active) markViewed(); }, [active, markViewed]);

  // follow the run: quickly while one is going, slowly otherwise; reload the report when a newer one is ready
  const running = status?.running;
  useEffect(() => {
    const tick = async () => {
      try {
        const s = await quickApi.status();
        setStatus(s);
        if (s.generatedAt && s.generatedAt !== seen.current) { await load(); if (active) markViewed(); }
      } catch { /* the backend may be restarting; try again on the next tick */ }
    };
    const t = window.setInterval(tick, running ? 3000 : 60000);
    return () => window.clearInterval(t);
  }, [running, active, load, markViewed]);

  const runNow = async () => {
    try { setStatus(await quickApi.run()); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not start a run'); }
  };

  const setRead = async (key: string, read: boolean) => {
    setReport(r => r && ({
      ...r,
      newTickets: r.newTickets.map(t => (t.key === key ? { ...t, read } : t)),
      feCandidates: read ? r.feCandidates.filter(c => !(c.origin === 'new' && c.key === key)) : r.feCandidates,
      counts: { ...r.counts, newUnread: r.counts.newUnread + (read ? -1 : 1) },
    }));
    try { await quickApi.markRead(key, read); window.dispatchEvent(new Event('quick-changed')); } catch { /* reloaded below */ }
    load();
  };

  return (
    <QuickAnalysisView report={report} status={status} error={error} loading={loading} tab={tab} onTab={setTab} showRead={showRead} showTeam={showTeam} flags={flags} onFlag={toggleFlag}
      onToggleRead={() => setShowRead(s => !s)} onToggleTeam={() => setShowTeam(s => !s)} onRun={runNow} onSetRead={setRead} />
  );
};

export default QuickAnalysis;
