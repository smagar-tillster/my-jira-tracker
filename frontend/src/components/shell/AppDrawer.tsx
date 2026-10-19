import React, { useEffect, useMemo, useRef, useState } from 'react';
import { APPS, AppDef, AppSection, SECTION_LABELS, matchesQuery } from '../../apps/registry';

interface AppDrawerProps {
  open: boolean;
  onClose: () => void;
  openIds: string[];
  onOpenApp: (id: string) => void;
}

const SECTIONS: AppSection[] = ['apps', 'tools'];

/** Right-hand drawer listing every app and tool, with search. Picking one opens it in its own tab. */
const AppDrawer: React.FC<AppDrawerProps> = ({ open, onClose, openIds, onOpenApp }) => {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => APPS.filter(a => matchesQuery(a, query)), [query]);

  useEffect(() => {
    if (open) {
      // Wait for the slide-in to start so focus doesn't jump the panel
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
    setQuery('');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const choose = (app: AppDef) => { onOpenApp(app.id); onClose(); };

  return (
    <>
      <div
        onClick={onClose}
        className={`fixed inset-0 z-[55] bg-black/30 transition-opacity duration-200 ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      />
      <aside
        role="dialog"
        aria-label="Apps and tools"
        aria-hidden={!open}
        className={`fixed top-0 right-0 bottom-0 z-[60] w-full max-w-sm bg-white shadow-2xl flex flex-col transition-transform duration-200 ${open ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="px-5 pt-5 pb-3 border-b border-gray-200">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-gray-800">Apps &amp; tools</h2>
            <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
          </div>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && results[0]) choose(results[0]); }}
            placeholder="Search apps and tools…"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-3">
          {results.length === 0 && (
            <p className="text-sm text-gray-400 text-center mt-10">Nothing matches “{query}”.</p>
          )}
          {SECTIONS.map(section => {
            const items = results.filter(a => a.section === section);
            if (items.length === 0) return null;
            return (
              <div key={section} className="mb-4">
                <h3 className="px-2 mb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">{SECTION_LABELS[section]}</h3>
                {items.map(app => {
                  const isOpen = openIds.includes(app.id);
                  return (
                    <button
                      key={app.id}
                      onClick={() => choose(app)}
                      className="w-full flex items-center gap-3 px-2 py-2 rounded-lg text-left hover:bg-blue-50 focus:bg-blue-50 focus:outline-none">
                      <span className="w-10 h-10 flex-shrink-0 rounded-lg bg-gray-100 flex items-center justify-center text-xl">{app.icon}</span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-medium text-gray-800 truncate">{app.name}</span>
                        <span className="block text-xs text-gray-500 truncate">{app.description}</span>
                      </span>
                      {app.comingSoon && (
                        <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Soon</span>
                      )}
                      {isOpen && !app.comingSoon && (
                        <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-green-100 text-green-700">Open</span>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </aside>
    </>
  );
};

export default AppDrawer;
