import { useState } from 'react';
import { DeliveryRelease } from '../../services/api';
import { Modal, Section, StatusDot, TicketLink, dayLabel } from './shared';
import TenantGroupList from './TenantGroupList';
import { byCount, byNotReady } from './tenantGrouping';

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

// To Release Today: tenants with something not ready on top (red); Released: the tenant with the most release tickets first.
const notReadyCount = (items: DeliveryRelease[]) => items.filter(r => !r.ready).length;
const notReadyFirst = byNotReady<DeliveryRelease>(notReadyCount);
const mostFirst = byCount<DeliveryRelease>();
const hasNotReady = (items: DeliveryRelease[]) => notReadyCount(items) > 0;

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
  if (rows.length === 0) return <div className="p-8 text-center text-gray-400">{empty}</div>;
  return (
    <>
      <TenantGroupList items={rows} tenantsOf={releaseTenants} unit="release ticket" summary={items => groupSummary(items, showStatus)}
        order={showStatus ? notReadyFirst : mostFirst} orderLabel={showStatus ? 'tenants with tickets not ready first' : 'most release tickets first'}
        alert={showStatus ? hasNotReady : undefined}>
        {items => <ReleaseRows rows={items} showStatus={showStatus} onOpen={setOpen} />}
      </TenantGroupList>
      {open && <ReleaseModal r={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function ReleaseRows({ rows, showStatus, onOpen }: { rows: DeliveryRelease[]; showStatus?: boolean; onOpen: (r: DeliveryRelease) => void }) {
  const setOpen = onOpen;
  return (
    <>
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
          <tr>
            <th className="px-3 py-2">Date</th><th className="px-3 py-2">Env</th>
            <th className="px-3 py-2">Components{showStatus ? '' : ' released'} (version)</th><th className="px-3 py-2">Release ticket</th>
            {showStatus && <th className="px-3 py-2">Status</th>}<th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id} className="border-t border-gray-100 hover:bg-gray-50 align-top">
              <td className="px-3 py-2 whitespace-nowrap text-gray-600">{dayLabel(r.date)}</td>
              <td className="px-3 py-2">{envBadge(r.env)}</td>
              <td className="px-3 py-2">
                <div className="flex flex-wrap gap-1">
                  {r.components.length === 0 && <span className="text-gray-400">—</span>}
                  {r.components.map(c => (
                    <span key={c.name} className="px-2 py-0.5 rounded bg-gray-100 text-gray-800 text-xs">{c.name}{c.version && <b> ({c.version})</b>}</span>
                  ))}
                </div>
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                {r.key ? <><TicketLink k={r.key} url={r.url} /> <span className="text-xs text-gray-500">{r.status}</span></> : <span className="text-xs text-red-600 font-medium">none yet</span>}
              </td>
              {showStatus && (
                <td className="px-3 py-2 whitespace-nowrap">
                  <StatusDot ok={r.ready} label={r.ready ? 'Ready' : `${r.notReady} not ready`} />
                </td>
              )}
              <td className="px-3 py-2 whitespace-nowrap"><button onClick={() => setOpen(r)} className="text-blue-600 hover:underline">Details</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
