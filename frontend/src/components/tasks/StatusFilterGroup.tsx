import React from 'react';
import { StatusDensity, orderedStatuses, statusButtonClass, statusText } from '../../utils/taskFilters';

/**
 * The status buttons (In Progress, Done, To Do with their counts and an icon each). Blue when selected, gray when not. `density` is chosen by the
 * page so the group fits on the first line: full size, then smaller, then icon and count only (the label stays in the tooltip and for screen readers).
 */
const StatusFilterGroup = React.forwardRef<HTMLDivElement, { counts: Record<string, number>; active: readonly string[]; onToggle: (category: string) => void; density?: StatusDensity }>(
  ({ counts, active, onToggle, density = 0 }, ref) => (
    <div ref={ref} className="flex items-center gap-1.5" role="group" aria-label="Status">
      {orderedStatuses(counts).map(([cat, count]) => {
        const on = active.includes(cat);
        return (
          <button key={cat} onClick={() => onToggle(cat)} aria-pressed={on} aria-label={`${cat}: ${count}`} title={`${cat}: ${count}`} className={statusButtonClass(on, density)}>
            {statusText(cat, count, density)}
          </button>
        );
      })}
    </div>
  ),
);
StatusFilterGroup.displayName = 'StatusFilterGroup';

export default StatusFilterGroup;
