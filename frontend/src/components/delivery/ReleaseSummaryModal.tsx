import { useMemo } from 'react';
import { DeliveryRelease } from '../../services/api';
import { Modal, dayLabel } from './shared';
import { CONTENT_GROUPS, ComponentLine, buildReleaseSummary } from './releaseSummary';

const chips = (list: ComponentLine[]) => list.map(c => `${c.name}${c.version ? ` (${c.version})` : ''}`).join(', ');

/** Short report of what was deployed, by tenant and day. Software is listed apart from content (menu, assets, configs). */
export default function ReleaseSummaryModal({ rows, range, onClose }: { rows: DeliveryRelease[]; range: { from: string; to: string } | null; onClose: () => void }) {
  const tenants = useMemo(() => buildReleaseSummary(rows), [rows]);
  const span = range ? (range.from === range.to ? dayLabel(range.from) : `${dayLabel(range.from)} – ${dayLabel(range.to)}`) : '';
  return (
    <Modal title="Release summary" subtitle={`${span} · ${tenants.length} tenant${tenants.length === 1 ? '' : 's'} · ${rows.length} release ticket${rows.length === 1 ? '' : 's'}`} onClose={onClose}>
      {tenants.length === 0 && <p className="text-gray-500">No releases for these dates and filters.</p>}
      {tenants.map(t => (
        <section key={t.tenant} className="border border-gray-200 rounded-lg overflow-hidden">
          <h4 className="px-3 py-1.5 bg-gray-50 border-b border-gray-200 font-semibold text-gray-800">{t.tenant}</h4>
          <ul className="divide-y divide-gray-100">
            {t.entries.map(e => {
              const content = CONTENT_GROUPS.filter(g => e.content[g].length > 0);
              return (
                <li key={`${e.date}|${e.env}`} className="px-3 py-2 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{dayLabel(e.date)}</span>
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${/PROD/i.test(e.env) ? 'bg-orange-100 text-orange-800' : 'bg-sky-100 text-sky-800'}`}>{e.env || '—'}</span>
                    <span className={`text-xs ${e.released ? 'text-green-700' : 'text-red-600 font-medium'}`}>{e.released ? 'Released' : 'Not released yet'}</span>
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
        </section>
      ))}
    </Modal>
  );
}
