import { useMemo, useState } from 'react';
import { DeliveryRelease } from '../../services/api';
import { ListControls, Modal, Section, StatusDot, TicketLink, dayLabel } from './shared';
import { filterRows } from './search';
import TenantGroupList from './TenantGroupList';
import { byCount, byNotReady, groupByTenant } from './tenantGrouping';
import { useRefresh } from './RefreshContext';

const envBadge = (env: string) => (
  <span className={`px-2 py-0.5 rounded text-xs font-medium ${/PROD/i.test(env) ? 'bg-orange-100 text-orange-800' : 'bg-sky-100 text-sky-800'}`}>{env || '—'}</span>
);

function ReleaseModal({ r, onClose }: { r: DeliveryRelease; onClose: () => void }) {
  return (
    <Modal title={`${r.tenant} · ${dayLabel(r.date)}${r.env ? ` · ${r.env}` : ''}`}
      subtitle={<>{r.key ? <TicketLink k={r.key} url={r.url} /> : 'No release ticket yet'} · {r.status}</>} onClose={onClose}>
      <Section title="Summary"><p>{r.summary}</p></Section>
      {r.components.length > 0 && (
        <Section title="Components">
          <div className="flex flex-wrap gap-1.5">
            {r.components.map(c => (
              <span key={c.name} className="px-2 py-0.5 rounded bg-gray-100 text-gray-800 text-xs">{c.name}{c.version && <b> ({c.version})</b>}</span>
            ))}
          </div>
        </Section>
      )}
      <Section title={`Tickets (${r.tickets.length}${r.notReady ? `, ${r.notReady} not ready` : ''})`}>
        {r.tickets.length === 0 ? <p className="text-gray-500">The release description lists no tickets.</p> : (
          <table className="w-full text-left text-xs border border-gray-200 rounded overflow-hidden">
            <thead className="bg-gray-50 text-gray-600">
              <tr><th className="px-2 py-1.5">Ticket</th><th className="px-2 py-1.5">Summary</th><th className="px-2 py-1.5">Component</th><th className="px-2 py-1.5">Version</th><th className="px-2 py-1.5">Status</th><th className="px-2 py-1.5">Assignee</th></tr>
            </thead>
            <tbody>
              {r.tickets.map((t, i) => (
                <tr key={`${t.key || t.label}-${i}`} className={`border-t border-gray-100 align-top ${t.ready ? '' : 'bg-red-50'}`}>
                  <td className="px-2 py-1.5 whitespace-nowrap">{t.key ? <TicketLink k={t.key} url={t.url} /> : '—'}</td>
                  <td className={`px-2 py-1.5 ${t.ready ? '' : 'text-red-700 font-medium'}`}>{t.summary || t.label}</td>
                  <td className="px-2 py-1.5">{t.component}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{t.version}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    {t.key ? <span className={`px-1.5 py-0.5 rounded ${t.ready ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800 font-semibold'}`}>{t.status || '—'}</span> : '—'}
                  </td>
                  <td className="px-2 py-1.5">{t.assignee}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
      {r.notes && <Section title="Notes"><p className="whitespace-pre-wrap">{r.notes}</p></Section>}
    </Modal>
  );
}

const releaseTenants = (r: DeliveryRelease) => [r.tenant];
// A release ticket lists the components it ships, so "component" is the second way to group (a ticket shows under each of its components).
const releaseComponents = (r: DeliveryRelease) => r.components.map(c => c.name);
const GROUPS = [
  { id: 'client' as const, label: 'Client', hint: 'One group per tenant' },
  { id: 'component' as const, label: 'Component', hint: 'One group per component shipped (a ticket appears under each of its components)' },
];
type GroupBy = typeof GROUPS[number]['id'];

// To Release Today: tenants with something not ready on top (red); Released: the tenant with the most release tickets first.
const notReadyCount = (items: DeliveryRelease[]) => items.filter(r => !r.ready).length;
const notReadyFirst = byNotReady<DeliveryRelease>(notReadyCount);
const mostFirst = byCount<DeliveryRelease>();
const hasNotReady = (items: DeliveryRelease[]) => notReadyCount(items) > 0;

/** "Refresh releases": re-reads Jira only (no GitHub), so it is quicker than the full report; the PR lists are left as they are. */
function RefreshReleasesButton({ counts }: { counts: string }) {
  const r = useRefresh();
  if (!r) return null;
  const mine = r.running && r.job?.kind === 'releases';
  const at = r.releasesAt ? new Date(r.releasesAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null;
  return (
    <>
      <button onClick={r.refreshReleases} disabled={r.running}
        title={r.running && !mine ? 'A report is running; releases refresh with it' : 'Re-reads Jira only: refreshes Released and To Release Today. Quicker than the full report; PR lists are not refreshed.'}
        className="px-3 py-1 bg-blue-500 text-white rounded-lg text-sm hover:bg-blue-600 disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap">
        {mine ? '⏳ Refreshing releases…' : '⟳ Refresh releases'}
      </button>
      <span className="text-sm text-gray-500" title={at ? `Releases as of ${at}` : undefined}>{counts}</span>
    </>
  );
}

/** What a collapsed tenant group says about its releases, across every day in the filter. */
const groupSummary = (rows: DeliveryRelease[], showStatus?: boolean) => {
  const notReady = rows.filter(r => !r.ready).length;
  if (showStatus) return `${rows.length} to release · ${notReady} not ready · ${rows.length - notReady} ready`;
  const days = [...new Set(rows.map(r => r.date))].sort();
  const span = days.length > 1 ? `${dayLabel(days[0])} – ${dayLabel(days[days.length - 1])}` : days.length === 1 ? dayLabel(days[0]) : '';
  return `${rows.filter(r => r.released).length} released of ${rows.length} release ticket${rows.length === 1 ? '' : 's'} · ${days.length} day${days.length === 1 ? '' : 's'}${span ? ` (${span})` : ''}`;
};

export default function ReleaseTable({ rows, showStatus, empty }: { rows: DeliveryRelease[]; showStatus?: boolean; empty: string }) {
  const [open, setOpen] = useState<DeliveryRelease | null>(null);
  const [groupBy, setGroupBy] = useState<GroupBy>('client');
  const [query, setQuery] = useState('');
  const [cmd, setCmd] = useState({ open: false, n: 0 });
  const [allOpen, setAllOpen] = useState(false);
  const toggleAll = () => setCmd(c => ({ open: !allOpen, n: c.n + 1 }));
  const shown = useMemo(() => filterRows(rows, query), [rows, query]);
  if (rows.length === 0) return <div className="p-8 text-center text-gray-400">{empty}</div>;
  const byClient = groupBy === 'client';
  const groupLabel = byClient ? 'tenant' : 'component';
  const groupCount = groupByTenant(shown, byClient ? releaseTenants : releaseComponents, undefined, byClient ? undefined : '(no component)').groups.length;
  const counts = `${groupCount} ${groupLabel}${groupCount === 1 ? '' : 's'} · ${shown.length} release ticket${shown.length === 1 ? '' : 's'}`;
  return (
    <>
      <ListControls groups={GROUPS} groupBy={groupBy} onGroupBy={setGroupBy} query={query} onQuery={setQuery} shown={shown.length} total={rows.length} unit="release ticket" allOpen={allOpen} onToggleAll={toggleAll} extra={<RefreshReleasesButton counts={counts} />} />
      {shown.length === 0 ? <div className="p-8 text-center text-gray-400">Nothing matches &ldquo;{query.trim()}&rdquo;.</div> : (
        <TenantGroupList command={cmd} onAllOpenChange={setAllOpen} items={shown} tenantsOf={byClient ? releaseTenants : releaseComponents} unit="release ticket" summary={items => groupSummary(items, showStatus)} hideIntro
          groupLabel={groupLabel} fallback={byClient ? undefined : '(no component)'} expandAll={!!query.trim()}
          order={byClient ? (showStatus ? notReadyFirst : mostFirst) : mostFirst}
          orderLabel={byClient && showStatus ? 'tenants with tickets not ready first' : 'most release tickets first'}
          alert={showStatus ? hasNotReady : undefined}>
          {items => <ReleaseRows rows={items} showStatus={showStatus} showTenant={!byClient} onOpen={setOpen} />}
        </TenantGroupList>
      )}
      {open && <ReleaseModal r={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function ReleaseRows({ rows, showStatus, showTenant, onOpen }: { rows: DeliveryRelease[]; showStatus?: boolean; showTenant?: boolean; onOpen: (r: DeliveryRelease) => void }) {
  const detailsPill = (r: DeliveryRelease) => (
    <button onClick={() => onOpen(r)} className="inline-block px-3 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100">Details</button>
  );
  return (
    <>
      <table className="w-full table-fixed text-[14px] leading-[22px] [overflow-wrap:anywhere]">
        <thead className="bg-gray-50 text-left text-[13px] font-semibold text-gray-600 border-b border-gray-200">
          <tr>
            {showTenant && <th className="px-2 py-[7px] w-[110px]">Tenant</th>}
            <th className="px-2 py-[7px] w-[110px]">Date</th><th className="px-2 py-[7px] w-[130px]">Env</th>
            <th className="px-2 py-[7px] w-[200px]">Release ticket</th>
            <th className="px-2 py-[7px] w-[140px]">Status</th>
            <th className="px-2 py-[7px] w-[26%]">Description</th>
            <th className="px-2 py-[7px]">Components{showStatus ? '' : ' released'} (version)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id} className="border-t border-gray-100 hover:bg-gray-50 align-top">
              {showTenant && <td className="px-2 py-2 font-medium text-gray-800" title={r.tenant}>{r.tenant}</td>}
              <td className="px-2 py-2 whitespace-nowrap text-gray-600">{dayLabel(r.date)}</td>
              <td className="px-2 py-2">{envBadge(r.env)}</td>
              <td className="px-2 py-2 whitespace-nowrap">
                {r.key ? <><TicketLink k={r.key} url={r.url} /> <span className="text-xs text-gray-500">{r.status}</span></> : <span className="text-xs text-red-600 font-medium">none yet</span>}
              </td>
              <td className="px-2 py-2 whitespace-nowrap">
                {showStatus
                  ? <StatusDot ok={r.ready} label={r.ready ? 'Ready' : `${r.notReady} not ready`} />
                  : <StatusDot ok={r.released} label={r.released ? 'Released' : 'Not released'} />}
                <div className="mt-1.5">{detailsPill(r)}</div>
              </td>
              <td className="px-2 py-2" title={r.summary}>
                <div className="line-clamp-2 text-gray-800">{r.noReleaseTicket ? r.summary : (r.what || r.title)}</div>
              </td>
              <td className="px-2 py-2">
                <div className="flex flex-wrap gap-1">
                  {r.components.length === 0 && <span className="text-gray-400">—</span>}
                  {r.components.map(c => (
                    <span key={c.name} className="px-2 py-0.5 rounded bg-gray-100 text-gray-800 text-xs">{c.name}{c.version && <b> ({c.version})</b>}</span>
                  ))}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
