import { useState } from 'react';
import EmbeddedApp from './EmbeddedApp';
import ReportViewer from './ReportViewer';
import { FLEET_URL } from '../../apps/registry';

type SubTab = 'fleet' | 'newrelic';

const TABS: { id: SubTab; label: string }[] = [
  { id: 'fleet', label: 'Fleet health' },
  { id: 'newrelic', label: 'New Relic conditions' },
];

/** Monitoring: the hosted fleet page and the New Relic conditions report as tabs. Both stay mounted so a tab keeps its state. */
export default function MonitoringApp() {
  const [tab, setTab] = useState<SubTab>('fleet');
  return (
    <div className="h-full flex flex-col bg-gray-50 overflow-hidden">
      <div className="bg-white border-b border-gray-200 px-4 pt-3 flex items-end gap-2">
        <span className="text-lg font-semibold text-gray-800 mr-3 pb-2">📡 Monitoring</span>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 ${tab === t.id ? 'border-blue-600 text-blue-700 bg-blue-50' : 'border-transparent text-gray-600 hover:bg-gray-100'}`}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0 relative">
        <div className="absolute inset-0" style={tab !== 'fleet' ? { display: 'none' } : undefined}>
          <EmbeddedApp title="Fleet health" url={FLEET_URL} />
        </div>
        <div className="absolute inset-0" style={tab !== 'newrelic' ? { display: 'none' } : undefined}>
          <ReportViewer source="newrelic-conditions" title="New Relic conditions" />
        </div>
      </div>
    </div>
  );
}
