import React from 'react';
import { APP_BY_ID } from '../../apps/registry';

interface TabStripProps {
  openIds: string[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
}

/** One tab per open app. Middle-click or × closes a tab. */
const TabStrip: React.FC<TabStripProps> = ({ openIds, activeId, onSelect, onClose }) => (
  <div className="flex gap-1 items-center overflow-x-auto min-w-0 flex-1 py-0.5">
    {openIds.map(id => {
      const app = APP_BY_ID[id];
      if (!app) return null;
      const active = id === activeId;
      return (
        <div
          key={id}
          onMouseDown={e => { if (e.button === 1) { e.preventDefault(); onClose(id); } }}
          className={`group flex items-center gap-1 pl-3 pr-1.5 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors cursor-pointer ${
            active ? 'bg-white text-blue-700' : 'bg-blue-500 text-white hover:bg-blue-400'
          }`}
          onClick={() => onSelect(id)}
          role="tab"
          aria-selected={active}>
          <span>{app.icon} {app.name}</span>
          <button
            onClick={e => { e.stopPropagation(); onClose(id); }}
            aria-label={`Close ${app.name}`}
            className={`w-5 h-5 rounded flex items-center justify-center text-base leading-none ${
              active ? 'text-blue-400 hover:bg-blue-100 hover:text-blue-700' : 'text-blue-200 hover:bg-blue-600 hover:text-white'
            }`}>
            ×
          </button>
        </div>
      );
    })}
  </div>
);

export default TabStrip;
