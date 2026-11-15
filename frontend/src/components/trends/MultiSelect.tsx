import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { matchOptions, selectionLabel } from '../../utils/trendsChart';

/**
 * A dropdown with a search box and a checkbox per option. Nothing selected means no filter (all). Picking applies at once.
 * "Select shown" ticks every option the search still shows, which makes "all the BK clients" two clicks; "Clear" empties the selection.
 */
const MultiSelect: React.FC<{ label: string; options: readonly string[]; value: readonly string[]; onChange: (v: string[]) => void }> = ({ label, options, value, onChange }) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const searchBox = useRef<HTMLInputElement>(null);
  const listId = useId();

  const shown = useMemo(() => matchOptions(options, search), [options, search]);
  const chosen = useMemo(() => new Set(value), [value]);

  useEffect(() => {
    if (!open) return undefined;
    searchBox.current?.focus();
    const down = (e: MouseEvent) => { if (root.current && !root.current.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [open]);

  const toggle = (o: string) => onChange(chosen.has(o) ? value.filter(v => v !== o) : [...value, o]);
  const selectShown = () => onChange([...new Set([...value, ...shown])]);
  const active = value.length > 0;

  return (
    <div ref={root} className="relative inline-block">
      <button type="button" onClick={() => { setOpen(o => !o); setSearch(''); }} aria-haspopup="listbox" aria-expanded={open} aria-controls={listId}
        className={`inline-flex items-center gap-1.5 rounded-lg ring-1 px-2.5 py-1.5 text-sm bg-white max-w-[220px] ${active ? 'ring-indigo-600 text-indigo-700 font-medium' : 'ring-gray-300 text-gray-700'}`}>
        <span className="truncate">{selectionLabel(label, value)}</span>
        <span aria-hidden className="text-xs text-gray-400">▾</span>
      </button>
      {open && (
        <div id={listId} role="group" aria-label={`${label} filter`} className="absolute z-20 mt-1 w-64 rounded-lg bg-white shadow-lg border border-gray-200">
          <div className="p-2 border-b border-gray-100">
            <input ref={searchBox} value={search} onChange={e => setSearch(e.target.value)} placeholder={`Search ${label.toLowerCase()}`} aria-label={`Search ${label.toLowerCase()}`}
              className="w-full rounded-md ring-1 ring-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-indigo-500" />
            <div className="flex items-center justify-between mt-1.5 text-xs">
              <button type="button" onClick={selectShown} disabled={shown.length === 0} className="text-blue-600 hover:underline disabled:text-gray-300 disabled:no-underline">Select {search.trim() ? 'shown' : 'all'} ({shown.length})</button>
              <button type="button" onClick={() => onChange([])} disabled={!active} className="text-blue-600 hover:underline disabled:text-gray-300 disabled:no-underline">Clear</button>
            </div>
          </div>
          <ul className="max-h-64 overflow-auto py-1" role="listbox" aria-multiselectable="true" aria-label={label}>
            {shown.length === 0 && <li className="px-3 py-2 text-sm text-gray-400">No match</li>}
            {shown.map(o => (
              <li key={o} role="option" aria-selected={chosen.has(o)}>
                <label className="flex items-center gap-2 px-3 py-1 text-sm text-gray-800 hover:bg-gray-50 cursor-pointer">
                  <input type="checkbox" checked={chosen.has(o)} onChange={() => toggle(o)} className="rounded border-gray-300" />
                  <span className="truncate" title={o}>{o}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default MultiSelect;
