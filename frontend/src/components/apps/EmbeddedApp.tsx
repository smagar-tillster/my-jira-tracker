import React, { useState } from 'react';

interface EmbeddedAppProps {
  title: string;
  url: string;
}

/** Renders an externally hosted page inside the tab, with a reload / open-in-window toolbar. */
const EmbeddedApp: React.FC<EmbeddedAppProps> = ({ title, url }) => {
  const [reloadKey, setReloadKey] = useState(0);
  const [loaded, setLoaded] = useState(false);

  return (
    <div className="h-full flex flex-col bg-white">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-200 text-sm">
        <span className="font-semibold text-gray-700">{title}</span>
        <span className="text-gray-400 truncate">{url}</span>
        <div className="ml-auto flex gap-2">
          <button
            onClick={() => { setLoaded(false); setReloadKey(k => k + 1); }}
            className="px-3 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-700">
            ↻ Reload
          </button>
          <a href={url} target="_blank" rel="noopener noreferrer"
            className="px-3 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-700">
            ↗ Open in new window
          </a>
        </div>
      </div>
      <div className="flex-1 relative">
        {!loaded && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-400">Loading {title}…</div>
        )}
        <iframe
          key={reloadKey}
          src={url}
          title={title}
          onLoad={() => setLoaded(true)}
          className="absolute inset-0 w-full h-full border-0"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-modals"
        />
      </div>
    </div>
  );
};

export default EmbeddedApp;
