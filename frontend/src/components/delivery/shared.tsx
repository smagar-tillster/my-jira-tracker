import { ReactNode, useEffect, useRef, useState } from 'react';

export const dayLabel = (day: string) =>
  new Date(`${day}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

/** Checkbox dropdown in the Quick Analysis filter style; empty selection means "all". */
export function MultiSelect({ label, options, value, onChange, tone = 'purple' }: {
  label: string; options: string[]; value: string[]; onChange: (v: string[]) => void; tone?: 'purple' | 'indigo';
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  const toggle = (o: string) => onChange(value.includes(o) ? value.filter(x => x !== o) : [...value, o]);
  const cls = tone === 'purple' ? 'bg-purple-100 text-purple-800 hover:bg-purple-200' : 'bg-indigo-100 text-indigo-800 hover:bg-indigo-200';
  const shown = options.filter(o => o.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(o => !o)} className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium ${cls}`}>
        <span>{label}: {value.length ? (value.length <= 2 ? value.join(', ') : `${value.length} selected`) : 'All'}</span>
        {value.length > 0 && (
          <span onClick={e => { e.stopPropagation(); onChange([]); }} title="Clear" className="ml-1 hover:opacity-70">✕</span>
        )}
      </button>
      {open && (
        <div className="absolute z-40 mt-1 bg-white border border-gray-300 rounded-lg shadow-lg py-1 min-w-[200px] max-h-72 overflow-auto">
          {options.length > 8 && (
            <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search…"
              className="mx-2 mb-1 mt-1 px-2 py-1 border border-gray-300 rounded text-sm w-[calc(100%-1rem)]" />
          )}
          {shown.map(o => (
            <label key={o} className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-gray-100">
              <input type="checkbox" checked={value.includes(o)} onChange={() => toggle(o)} className="w-4 h-4" />
              <span className={value.includes(o) ? 'font-semibold text-purple-700' : 'text-gray-700'}>{o}</span>
            </label>
          ))}
          {shown.length === 0 && <div className="px-3 py-2 text-sm text-gray-400">No match</div>}
        </div>
      )}
    </div>
  );
}

export function Modal({ title, subtitle, onClose, children }: { title: string; subtitle?: ReactNode; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-6 overflow-auto" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl my-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-start gap-3 px-5 py-3 border-b border-gray-200 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-t-lg">
          <div className="flex-1">
            <h3 className="text-base font-semibold">{title}</h3>
            {subtitle && <div className="text-xs text-blue-100 mt-0.5">{subtitle}</div>}
          </div>
          <button onClick={onClose} className="text-blue-100 hover:text-white text-lg leading-none" title="Close (Esc)">✕</button>
        </div>
        <div className="p-5 space-y-4 text-sm text-gray-800">{children}</div>
      </div>
    </div>
  );
}

export const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <div><h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">{title}</h4>{children}</div>
);

export function StatusDot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${ok ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
      <span className={`w-2 h-2 rounded-full ${ok ? 'bg-green-500' : 'bg-red-500'}`} />{label}
    </span>
  );
}

export const TicketLink = ({ k, url }: { k: string | null; url: string | null }) =>
  k && url ? <a href={url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline font-medium">{k}</a> : <span className="text-gray-400">—</span>;
