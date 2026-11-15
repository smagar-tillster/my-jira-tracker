import React from 'react';
import FilterIcon from './FilterIcon';
import { BTN, filtersToggleLabel, stateClass } from '../../utils/taskFilters';

/**
 * The accordion beside Full Screen: shows or hides the two toolbar lines of filters and buttons. It is gray when the lines are shown, or hidden with
 * nothing in use, and blue with a count when they are hidden while some filters are in use.
 */
const FiltersToggle: React.FC<{ open: boolean; count: number; onToggle: () => void; controls: string }> = ({ open, count, onToggle, controls }) => (
  <button onClick={onToggle} aria-expanded={open} aria-controls={controls} title={open ? 'Hide the filters' : 'Show the filters'}
    className={`${BTN} inline-flex items-center gap-1.5 whitespace-nowrap ${stateClass(!open && count > 0)}`}>
    <FilterIcon />{filtersToggleLabel(open, count)}<span aria-hidden>{open ? '▴' : '▾'}</span>
  </button>
);

export default FiltersToggle;
