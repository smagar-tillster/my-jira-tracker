import { useEffect, useState } from 'react';
import { deliveryApi, Digest, DigestPrRef, DigestSummary, DeliveryMeta } from '../../services/api';

const shiftDay = (day: string, n: number) => { const d = new Date(`${day}T12:00:00`); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

const Tile = ({ label, value, tone = 'text-gray-800', hint }: { label: string; value: number | string; tone?: string; hint?: string }) => (
  <div className="bg-white rounded-lg shadow-sm px-3 py-2 min-w-[110px]" title={hint}>
    <div className={`text-2xl font-semibold ${tone}`}>{value}</div>
    <div className="text-xs text-gray-500">{label}</div>
  </div>
);

const Bars = ({ rows, empty }: { rows: { name: string; count: number }[]; empty: string }) => {
  const max = Math.max(1, ...rows.map(r => r.count));
  if (!rows.length) return <p className="text-sm text-gray-400">{empty}</p>;
  return (
    <div className="space-y-1">
      {rows.slice(0, 12).map(r => (
        <div key={r.name} className="flex items-center gap-2 text-sm">
          <span className="w-44 truncate text-gray-700" title={r.name}>{r.name}</span>
          <div className="flex-1 h-2 bg-gray-100 rounded"><div className="h-2 rounded bg-indigo-400" style={{ width: `${(r.count / max) * 100}%` }} /></div>
          <span className="w-6 text-right text-gray-600">{r.count}</span>
        </div>
      ))}
    </div>
  );
};

const PrChips = ({ prs }: { prs: DigestPrRef[] }) => (
  <div className="flex flex-wrap gap-1 mt-1">
    {prs.slice(0, 10).map(p => (
      <a key={p.id} href={p.url} target="_blank" rel="noreferrer" title={p.line1}
        className="text-xs px-1.5 py-0.5 rounded bg-white ring-1 ring-gray-200 text-blue-700 hover:bg-blue-50">{p.repo} #{p.number}</a>
    ))}
    {prs.length > 10 && <span className="text-xs text-gray-500 self-center">+{prs.length - 10} more</span>}
  </div>
);

/** Weekly digest: what is happening in the stack, by rules. An optional written note restates it (one model call, kept until the facts change). */
export default function DigestTab({ meta, refreshKey }: { meta: DeliveryMeta; refreshKey: number }) {
  const [from, setFrom] = useState(shiftDay(meta.day, -6));
  const [to, setTo] = useState(meta.day);
  const [d, setD] = useState<Digest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<DigestSummary | null>(null);
  const [writing, setWriting] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setNote(null); setNoteError(null);
    deliveryApi.digest(from, to).then(r => { if (!cancelled) { setD(r); setError(null); } })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not build the digest'); });
    return () => { cancelled = true; };
  }, [from, to, refreshKey]);

  const write = async (refresh = false) => {
    setWriting(true); setNoteError(null);
    try { setNote(await deliveryApi.digestSummary(from, to, refresh)); }
    catch (e: unknown) { setNoteError((e as { response?: { data?: { error?: string } } })?.response?.data?.error || (e instanceof Error ? e.message : 'Could not write the note')); }
    finally { setWriting(false); }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 flex-wrap">
        <label className="flex items-center gap-1 text-sm text-gray-600">From
          <input type="date" value={from} max={to} onChange={e => e.target.value && setFrom(e.target.value)} className="px-2 py-1 border border-gray-300 rounded-lg text-sm" /></label>
        <label className="flex items-center gap-1 text-sm text-gray-600">To
          <input type="date" value={to} min={from} onChange={e => e.target.value && setTo(e.target.value)} className="px-2 py-1 border border-gray-300 rounded-lg text-sm" /></label>
        <button onClick={() => { setFrom(shiftDay(meta.day, -6)); setTo(meta.day); }} className="px-3 py-1.5 rounded-lg text-sm bg-gray-100 text-gray-700 hover:bg-gray-200">Last 7 days</button>
        <span className="text-xs text-gray-500 ml-auto">Built by rules from the PR data{meta.prsGeneratedAt ? ` as of ${new Date(meta.prsGeneratedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}. Use Fetch latest PRs on the PR tabs to refresh it.</span>
      </div>
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {error && <div className="px-3 py-2 text-sm bg-red-50 text-red-700 border border-red-200 rounded">❌ {error}</div>}
        {!d && !error && <p className="text-sm text-gray-500">Building…</p>}
        {d && (
          <>
            <p className="text-sm text-gray-800 font-medium">{d.headline}</p>
            <div className="flex flex-wrap gap-3">
              <Tile label="PRs merged" value={d.merged.total} />
              <Tile label="defect fixes" value={d.merged.defectFixes.length} tone="text-rose-700" />
              <Tile label="reached PROD" value={d.merged.shipped.prod} tone="text-green-700" />
              <Tile label="reached UAT" value={d.merged.shipped.uat} tone="text-sky-700" />
              <Tile label="planned" value={d.merged.shipped.planned} tone="text-amber-700" hint="In a release ticket that is not done yet" />
              <Tile label="not in a release" value={d.merged.shipped.none} tone="text-gray-700" hint="No release dated on or after the merge lists the PR's ticket" />
              <Tile label="open now" value={d.open.total} hint={`${d.open.drafts} drafts`} />
              <Tile label="waiting for review" value={d.open.waitingForReview} tone="text-amber-700" />
              <Tile label="older than 14 days" value={d.open.stale.length} tone="text-red-700" />
            </div>

            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">Worth a look</h3>
              {d.attention.length === 0 ? <p className="text-sm text-gray-500">Nothing stands out.</p> : (
                <div className="space-y-2">
                  {d.attention.map(a => (
                    <div key={a.text} className={`rounded-lg px-3 py-2 text-sm border-l-4 ${a.level === 'warn' ? 'bg-amber-50 border-amber-400' : 'bg-white border-gray-300'}`}>
                      <div className="text-gray-800">{a.text}</div>
                      <PrChips prs={a.prs} />
                    </div>
                  ))}
                </div>
              )}
            </section>

            <div className="grid md:grid-cols-2 gap-4">
              <section className="bg-white rounded-lg shadow-sm p-3"><h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Merged by repo</h3><Bars rows={d.merged.byRepo} empty="Nothing merged in this range." /></section>
              <section className="bg-white rounded-lg shadow-sm p-3"><h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Merged by tenant</h3><Bars rows={d.merged.byTenant} empty="Nothing merged in this range." /></section>
            </div>

            <section className="bg-white rounded-lg shadow-sm p-3">
              <div className="flex items-center gap-3 mb-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Written note</h3>
                <button onClick={() => write(false)} disabled={writing} title="One model call. It only restates the numbers above, and is kept until they change."
                  className="px-3 py-1 rounded-lg text-sm bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-60">{writing ? '⏳ Writing…' : note ? 'Show again' : 'Write a short note'}</button>
                {note && !writing && <button onClick={() => write(true)} className="text-xs text-gray-500 hover:text-gray-800">↻ write again</button>}
                {note && <span className="text-xs text-gray-400">{note.cached ? 'kept from earlier' : 'just written'} · AI-assisted ({note.model}); it restates the facts above</span>}
              </div>
              {noteError && <p className="text-sm text-red-600">{noteError}</p>}
              {note ? <p className="text-sm text-gray-800 whitespace-pre-wrap">{note.text}</p> : !writing && <p className="text-sm text-gray-400">Not written. The digest above does not need it.</p>}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
