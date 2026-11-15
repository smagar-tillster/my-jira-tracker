import React from 'react';
import { BOARD_DATES, BTN, BoardDate, stateClass } from '../../utils/taskFilters';

/** The Board's popover: which date the columns are built on. One choice, blue when selected. */
export const BoardDatePicker: React.FC<{ value: BoardDate; onPick: (d: BoardDate) => void }> = ({ value, onPick }) => (
  <div className="flex gap-1.5">
    {BOARD_DATES.map(d => (
      <button key={d.key} onClick={() => onPick(d.key)} aria-pressed={value === d.key} className={`${BTN} whitespace-nowrap ${stateClass(value === d.key)}`}>{d.label}</button>
    ))}
  </div>
);

/** The Region popover: Manage Regions, which opens the region manager. */
export const RegionOptions: React.FC<{ onManage: () => void }> = ({ onManage }) => (
  <button onClick={onManage} className={`${BTN} whitespace-nowrap ${stateClass(false)}`}>⚙ Manage Regions</button>
);
