import React, { useMemo, useState } from 'react';
import { JiraIssue, Column, SortConfig } from '../../types';
import { splitClients } from '../../services/dataProcessor';
import ListView from './ListView';

interface RegionViewProps {
  issues: JiraIssue[];
  regions: Record<string, string>;
  visibleColumns: Column[];
  sortConfig: SortConfig;
  onSort: (column: keyof JiraIssue) => void;
  onToggleFilterValue: (column: string, value: string) => void;
  feTeamMembers: string[];
  onToggleFETeam: (assignee: string) => void;
}

const OTHER_REGION = 'Other';

const RegionView: React.FC<RegionViewProps> = ({
  issues, regions, visibleColumns, sortConfig, onSort, onToggleFilterValue, feTeamMembers, onToggleFETeam,
}) => {
  const [expandedRegions, setExpandedRegions] = useState<Set<string>>(new Set());

  const nested = useMemo(() => {
    const byRegion = new Map<string, Map<string, JiraIssue[]>>();
    for (const issue of issues) {
      const clients = splitClients(issue.client);
      const keys = clients.length > 0 ? clients : ['No Client'];
      for (const client of keys) {
        const region = regions[client] || OTHER_REGION;
        if (!byRegion.has(region)) byRegion.set(region, new Map());
        const byClient = byRegion.get(region)!;
        if (!byClient.has(client)) byClient.set(client, []);
        byClient.get(client)!.push(issue);
      }
    }
    // Sort regions alphabetically but push 'Other' last; sort clients alphabetically within each region
    const sortedRegions = [...byRegion.entries()].sort(([a], [b]) => {
      if (a === OTHER_REGION) return 1;
      if (b === OTHER_REGION) return -1;
      return a.localeCompare(b);
    });
    return sortedRegions.map(([region, byClient]) => ({
      region,
      count: [...byClient.values()].reduce((sum, arr) => sum + arr.length, 0),
      clients: [...byClient.entries()].sort(([a], [b]) => a.localeCompare(b)),
    }));
  }, [issues, regions]);

  const toggleRegion = (region: string) =>
    setExpandedRegions(prev => {
      const next = new Set(prev);
      next.has(region) ? next.delete(region) : next.add(region);
      return next;
    });

  return (
    <div className="bg-white">
      {nested.map(({ region, count, clients }) => {
        const isExpanded = expandedRegions.has(region);
        return (
          <div key={region} className="border-b border-gray-200">
            <div
              onClick={() => toggleRegion(region)}
              className="bg-gray-100 px-6 py-2 cursor-pointer hover:bg-gray-200 transition-colors flex items-center gap-3 sticky top-0 z-30"
            >
              <span className="text-gray-500 text-sm">{isExpanded ? '▼' : '▶'}</span>
              <span className="font-bold text-gray-800 text-sm">🌎 {region}</span>
              <span className="text-xs text-gray-500">({count})</span>
            </div>

            {isExpanded && clients.map(([client, clientIssues]) => (
              <ListView
                key={client}
                groupedIssues={new Map([[client, clientIssues]])}
                defaultExpandFirst={false}
                visibleColumns={visibleColumns}
                sortConfig={sortConfig}
                onSort={onSort}
                onToggleFilterValue={onToggleFilterValue}
                feTeamMembers={feTeamMembers}
                onToggleFETeam={onToggleFETeam}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
};

export default RegionView;
