import React from 'react';
import { BTN, STATUS_ICONS, orderedStatuses, stateClass } from '../../utils/taskFilters';

/** The status buttons (In Progress, Done, To Do with their counts and an icon each), the same size as the other buttons. Blue when selected, gray when not. */
const StatusFilterGroup: React.FC<{ counts: Record<string, number>; active: readonly string[]; onToggle: (category: string) => void }> = ({ counts, active, onToggle }) => (
  <div className="flex items-center gap-1.5" role="group" aria-label="Status">
    {orderedStatuses(counts).map(([cat, count]) => {
      const on = active.includes(cat);
      return (
        <button key={cat} onClick={() => onToggle(cat)} aria-pressed={on} className={`${BTN} whitespace-nowrap ${stateClass(on)}`}>
          {STATUS_ICONS[cat] ? `${STATUS_ICONS[cat]} ` : ''}{cat}: {count}
        </button>
      );
    })}
  </div>
);

export default StatusFilterGroup;
