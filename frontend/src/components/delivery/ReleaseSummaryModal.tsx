import { useMemo } from 'react';
import { DeliveryRelease } from '../../services/api';
import { Modal, TicketLink, dayLabel } from './shared';
import { CONTENT_GROUPS, ComponentLine, TenantSummary, buildReleaseSummary } from './releaseSummary';

const chips = (list: ComponentLine[]) => list.map(c => `${c.name}${c.version ? ` (${c.version})` : ''}`).join(', ');

/** The collapsed line of a tenant: how many deployments, and the days. */
const headline = (t: TenantSummary) => {
  const days = [...new Set(t.entries.map(e => e.date))];
  const released = t.entries.filter(e => e.released).length;
  return `${t.entries.length} deployment${t.entries.length === 1 ? '' : 's'} · ${released} released · ${days.map(dayLabel).join(', ')}`;
};

/** Short report of what was deployed, by tenant and day. Tenants start collapsed; open one to see its release tickets, software and content. */
export default function ReleaseSummaryModal({ rows, range, onClose }: { rows: DeliveryRelease[]; range: { from: string; to: string } | null; onClose: () => void }) {
  const tenants = useMemo(() => buildReleaseSummary(rows), [rows]);
  const span = range ? (range.from === range.to ? dayLabel(range.from) : `${dayLabel(range.from)} – ${dayLabel(range.to)}`) : '';
  return (
    <Modal title="Release summary" subtitle={`${span} · ${tenants.length} tenant${tenants.length === 1 ? '' : 's'} · ${rows.length} release ticket${rows.length === 1 ? '' : 's'}`} onClose={onClose}>
      {tenants.length === 0 && <p className="text-gray-500">No releases for these dates and filters.</p>}
      {tenants.map(t => (
        <details key={t.tenant} className="group border border-gray-200 rounded-lg overflow-hidden">
          <summary className="px-3 py-2 bg-gray-50 cursor-pointer select-none flex items-center gap-2 hover:bg-gray-100 [&::-webkit-details-marker]:hidden">
            <span className="text-gray-500 transition-transform group-open:rotate-90">▶</span>
            <span className="font-semibold text-gray-800">{t.tenant}</span>
            <span className="text-xs text-gray-500">{headline(t)}</span>
          </summary>
          <ul className="divide-y divide-gray-100 border-t border-gray-200">
            {t.entries.map(e => {
              const content = CONTENT_GROUPS.filter(g => e.content[g].length > 0);
              return (
                <li key={`${e.date}|${e.env}`} className="px-3 py-2 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{dayLabel(e.date)}</span>
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${/PROD/i.test(e.env) ? 'bg-orange-100 text-orange-800' : 'bg-sky-100 text-sky-800'}`}>{e.env || '—'}</span>
                    <span className={`text-xs ${e.released ? 'text-green-700' : 'text-red-600 font-medium'}`}>{e.released ? 'Released' : 'Not released yet'}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Release ticket: </span>
                    {e.tickets.length === 0 ? <span className="text-red-600">none yet</span>
                      : e.tickets.map((k, i) => <span key={k.key}>{i > 0 && ', '}<TicketLink k={k.key} url={k.url} />{k.status && <span className="text-xs text-gray-500"> {k.status}</span>}</span>)}
                  </div>
                  <div><span className="text-gray-500">Software: </span>{e.software.length ? chips(e.software) : <span className="text-gray-400">none</span>}</div>
                  <div>
                    <span className="text-gray-500">Content: </span>
                    {content.length === 0 ? <span className="text-gray-400">none</span>
                      : content.map((g, i) => <span key={g}>{i > 0 && ' · '}<b>{g}</b> {chips(e.content[g])}</span>)}
                  </div>
                </li>
              );
            })}
          </ul>
        </details>
      ))}
    </Modal>
  );
}
