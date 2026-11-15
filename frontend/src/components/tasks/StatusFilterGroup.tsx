import React from 'react';
import { stateClass } from '../../utils/taskFilters';

/** The status buttons (To Do, In Progress, Done with their counts), compact so they fit beside Additional Filters. Blue when selected, gray when not. */
const StatusFilterGroup: React.FC<{ counts: Record<string, number>; active: readonly string[]; onToggle: (category: string) => void }> = ({ counts, active, onToggle }) => (
  <div className="flex items-center gap-1" role="group" aria-label="Status">
    {Object.entries(counts).map(([cat, count]) => {
      const on = active.includes(cat);
      return (
        <button key={cat} onClick={() => onToggle(cat)} aria-pressed={on} className={`px-2 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${stateClass(on)}`}>
          {cat}: {count}
        </button>
      );
    })}
  </div>
);

export default StatusFilterGroup;
