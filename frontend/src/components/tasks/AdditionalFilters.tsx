import React, { useEffect } from 'react';
import { QUICK_FILTERS, QUICK_ROWS, QuickKey, QuickState, BTN, additionalLabel, quickCount, stateClass } from '../../utils/taskFilters';

/**
 * The Additional Filters button and the small popover under it that holds the quick filters, two to a line. The button is blue with a count when any
 * of them is on, gray otherwise. The popover stays open while you toggle; Escape closes it, and the parent closes it on a click outside
 * (the wrapper carries the filter-dropdown class the Tasks page uses for that).
 */
const AdditionalFilters: React.FC<{ state: QuickState; open: boolean; onToggleOpen: () => void; onClose: () => void; onToggle: (key: QuickKey) => void }> = ({ state, open, onToggleOpen, onClose, onToggle }) => {
  const count = quickCount(state);

  useEffect(() => {
    if (!open) return undefined;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [open, onClose]);

  return (
    <div className="relative filter-dropdown">
      <button onClick={onToggleOpen} aria-haspopup="true" aria-expanded={open} className={`${BTN} whitespace-nowrap ${stateClass(count > 0)}`}>
        {additionalLabel(count)}
      </button>
      {open && (
        <div role="group" aria-label="Additional filters" className="absolute z-50 mt-1 left-0 bg-white border border-gray-300 rounded-xl shadow-lg p-3 space-y-2 w-max">
          {QUICK_ROWS.map(row => (
            <div key={row.join('-')} className="flex gap-1.5">
              {row.map(k => {
                const q = QUICK_FILTERS[k];
                return (
                  <button key={k} onClick={() => onToggle(k)} aria-pressed={state[k]} title={q.title} className={`${BTN} whitespace-nowrap ${stateClass(state[k])}`}>
                    {q.icon} {q.label}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AdditionalFilters;
