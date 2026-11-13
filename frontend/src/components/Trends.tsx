import React, { useState } from 'react';
import SprintTicketsTrend from './trends/SprintTicketsTrend';

interface TrendDef { id: string; title: string; blurb: string; render: () => React.ReactNode }

// The trends on offer. A new one is an entry here and a component; the page around it does not change.
const TRENDS: TrendDef[] = [
  { id: 'sprint-tickets', title: 'Sprint tickets by month', blurb: 'All NGK tickets that were in a sprint, by month and type', render: () => <SprintTicketsTrend /> },
];

/** Trends: pick a trend on the left, see it on the right. */
const Trends: React.FC = () => {
  const [id, setId] = useState(TRENDS[0].id);
  const current = TRENDS.find(t => t.id === id) || TRENDS[0];
  return (
    <div className="h-full flex bg-gray-100">
      <nav aria-label="Trends" className="w-60 shrink-0 border-r border-gray-200 bg-white p-3 overflow-auto">
        <h1 className="text-lg font-semibold text-gray-800 px-2 pb-2">📈 Trends</h1>
        <ul className="space-y-1">
          {TRENDS.map(t => (
            <li key={t.id}>
              <button onClick={() => setId(t.id)} aria-current={t.id === id ? 'page' : undefined}
                className={`w-full text-left px-3 py-2 rounded-lg ${t.id === id ? 'bg-indigo-50 ring-1 ring-indigo-200' : 'hover:bg-gray-50'}`}>
                <div className={`text-sm font-medium ${t.id === id ? 'text-indigo-800' : 'text-gray-800'}`}>{t.title}</div>
                <div className="text-xs text-gray-500 mt-0.5">{t.blurb}</div>
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <main className="flex-1 min-w-0 overflow-auto p-4">
        <div className="max-w-6xl mx-auto">{current.render()}</div>
      </main>
    </div>
  );
};

export default Trends;
