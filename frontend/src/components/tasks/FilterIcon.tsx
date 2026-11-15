import React from 'react';

/** A small funnel for the filter buttons. It is drawn in the button's own text color, so it is gray on a gray button and white on a blue one. */
const FilterIcon: React.FC<{ className?: string }> = ({ className = 'w-3.5 h-3.5' }) => (
  <svg aria-hidden="true" data-icon="filter" viewBox="0 0 20 20" fill="currentColor" className={`${className} shrink-0`}>
    <path d="M3 3a1 1 0 011-1h12a1 1 0 011 1v3a1 1 0 01-.293.707L12 11.414V15a1 1 0 01-.293.707l-2 2A1 1 0 018 17v-5.586L3.293 6.707A1 1 0 013 6V3z" />
  </svg>
);

export default FilterIcon;
