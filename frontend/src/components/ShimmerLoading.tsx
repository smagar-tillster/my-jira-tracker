import React from 'react';

/** The loading skeleton of the Tasks page. `filtersOpen` is false when the toolbar's two filter lines are folded away, so the skeleton matches. */
const ShimmerLoading: React.FC<{ filtersOpen?: boolean }> = ({ filtersOpen = true }) => {
  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Header Shimmer: one block for every control in the real toolbar, in the same three rows (see JiraTasksTracker) */}
      <div className="bg-white border-b border-gray-200 p-4">
        <div className="flex flex-col gap-3" data-shimmer="toolbar">
          {/* Top row: Search, Jira filter, Refresh, Full Screen, the filters accordion */}
          <div className="flex items-center gap-2" data-shimmer="top">
            <div className="h-10 flex-1 bg-gray-200 rounded-lg animate-pulse"></div>
            <div className="h-9 w-[232px] bg-gray-200 rounded-lg animate-pulse"></div>
            <div className="h-9 w-10 bg-gray-200 rounded-lg animate-pulse"></div>
            <div className="h-9 w-10 bg-gray-200 rounded-lg animate-pulse"></div>
            <div className="h-9 w-24 bg-gray-200 rounded-lg animate-pulse"></div>
          </div>

          {filtersOpen && (
            <>
              {/* Line 1: All / Sprint / Me, In Progress / Done / To Do, List / Board / Region, Group By */}
              <div className="flex flex-wrap gap-1.5 items-center" data-shimmer="line1">
                <div className="h-8 w-20 bg-gray-200 rounded-lg animate-pulse"></div>
                <div className="h-8 w-24 bg-gray-200 rounded-lg animate-pulse"></div>
                <div className="h-8 w-16 bg-gray-200 rounded-lg animate-pulse"></div>
                <div className="h-6 w-px bg-gray-300"></div>
                <div className="h-9 w-36 bg-gray-200 rounded-lg animate-pulse"></div>
                <div className="h-9 w-20 bg-gray-200 rounded-lg animate-pulse"></div>
                <div className="h-9 w-28 bg-gray-200 rounded-lg animate-pulse"></div>
                <div className="h-6 w-px bg-gray-300"></div>
                <div className="h-9 w-20 bg-gray-200 rounded-lg animate-pulse"></div>
                <div className="h-9 w-24 bg-gray-200 rounded-lg animate-pulse"></div>
                <div className="h-9 w-24 bg-gray-200 rounded-lg animate-pulse"></div>
                <div className="h-6 w-px bg-gray-300"></div>
                <div className="h-9 w-28 bg-gray-200 rounded-lg animate-pulse"></div>
              </div>

              {/* Line 2: Type, Status, Assignee, Sprint, Release, Client, Component, Additional Filters, then the count */}
              <div className="flex flex-wrap gap-1.5 items-center" data-shimmer="line2">
                <div className="h-9 w-20 bg-gray-200 rounded-lg animate-pulse"></div>
                <div className="h-9 w-24 bg-gray-200 rounded-lg animate-pulse"></div>
                <div className="h-9 w-28 bg-gray-200 rounded-lg animate-pulse"></div>
                <div className="h-9 w-24 bg-gray-200 rounded-lg animate-pulse"></div>
                <div className="h-9 w-24 bg-gray-200 rounded-lg animate-pulse"></div>
                <div className="h-9 w-20 bg-gray-200 rounded-lg animate-pulse"></div>
                <div className="h-9 w-32 bg-gray-200 rounded-lg animate-pulse"></div>
                <div className="h-6 w-px bg-gray-300"></div>
                <div className="h-9 w-40 bg-gray-200 rounded-lg animate-pulse"></div>
                <div className="ml-auto h-5 w-28 bg-gray-200 rounded animate-pulse"></div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Table Shimmer */}
      <div className="flex-1 overflow-auto bg-white m-4 rounded-lg border border-gray-200">
        <div className="p-6 space-y-4">
          {/* Table Header Shimmer */}
          <div className="flex gap-4 border-b border-gray-200 pb-3">
            <div className="h-6 w-12 bg-gray-200 rounded animate-pulse"></div>
            <div className="h-6 w-24 bg-gray-200 rounded animate-pulse"></div>
            <div className="h-6 w-32 bg-gray-200 rounded animate-pulse"></div>
            <div className="h-6 flex-1 bg-gray-200 rounded animate-pulse"></div>
            <div className="h-6 w-32 bg-gray-200 rounded animate-pulse"></div>
            <div className="h-6 w-32 bg-gray-200 rounded animate-pulse"></div>
            <div className="h-6 w-28 bg-gray-200 rounded animate-pulse"></div>
          </div>

          {/* Table Rows Shimmer */}
          {[...Array(12)].map((_, index) => (
            <div key={index} className="flex gap-4 py-3 border-b border-gray-100">
              <div className="h-5 w-12 bg-gray-200 rounded animate-pulse"></div>
              <div className="h-5 w-24 bg-gray-200 rounded animate-pulse"></div>
              <div className="h-5 w-32 bg-gray-200 rounded animate-pulse"></div>
              <div className="h-5 flex-1 bg-gray-200 rounded animate-pulse"></div>
              <div className="h-5 w-32 bg-gray-200 rounded animate-pulse"></div>
              <div className="h-5 w-32 bg-gray-200 rounded animate-pulse"></div>
              <div className="h-5 w-28 bg-gray-200 rounded animate-pulse"></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ShimmerLoading;
