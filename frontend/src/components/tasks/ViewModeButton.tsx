import React, { useEffect } from 'react';
import { BTN, stateClass } from '../../utils/taskFilters';

/**
 * A view button (List, Board, Region). Clicking it switches to that view. For a view with options (Board, Region), clicking it again while it is
 * the current view opens a small popover under it, the same style as Additional Filters. The wrapper carries the filter-dropdown class the Tasks
 * page uses to close popovers on an outside click; Escape closes it too.
 */
const ViewModeButton: React.FC<{
  label: string; suffix?: string; active: boolean; hasOptions: boolean; open: boolean;
  onSelect: () => void; onToggleOpen: () => void; onClose: () => void; children?: React.ReactNode;
}> = ({ label, suffix, active, hasOptions, open, onSelect, onToggleOpen, onClose, children }) => {
  const withOptions = active && hasOptions;
  const showing = withOptions && open;

  useEffect(() => {
    if (!showing) return undefined;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [showing, onClose]);

  return (
    <div className="relative filter-dropdown">
      <button onClick={() => (withOptions ? onToggleOpen() : onSelect())} aria-pressed={active} aria-haspopup={withOptions ? 'true' : undefined} aria-expanded={withOptions ? open : undefined}
        title={withOptions ? 'Click again for options' : undefined} className={`${BTN} whitespace-nowrap ${stateClass(active)}`}>
        {label}{suffix ? ` · ${suffix}` : ''}{withOptions ? ' ▾' : ''}
      </button>
      {showing && (
        <div role="group" aria-label={`${label} options`} className="absolute z-50 mt-1 left-0 bg-white border border-gray-300 rounded-xl shadow-lg p-3 w-max">
          {children}
        </div>
      )}
    </div>
  );
};

export default ViewModeButton;
