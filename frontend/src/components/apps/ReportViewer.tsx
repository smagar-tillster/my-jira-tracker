import React, { useCallback, useEffect, useState } from 'react';
import { hubApi, HubReportFile } from '../../services/api';

interface ReportViewerProps {
  source: string;
  title: string;
}

const formatWhen = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

/** Lists the HTML reports in a backend folder and renders the selected one in a sandboxed iframe. */
const ReportViewer: React.FC<ReportViewerProps> = ({ source, title }) => {
  const [files, setFiles] = useState<HubReportFile[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await hubApi.getFiles(source);
      setFiles(list);
      // Keep the current selection if it still exists, otherwise show the newest report
      setSelected(prev => (prev && list.some(f => f.path === prev) ? prev : list[0]?.path ?? null));
      setReloadKey(k => k + 1);
    } catch (err: any) {
      setError(
        err?.response?.status === 404
          ? 'The backend does not have the report routes yet. Restart the backend after updating.'
          : err?.response?.data?.error || err?.message || 'Failed to load reports'
      );
    } finally {
      setLoading(false);
    }
  }, [source]);

  useEffect(() => { load(); }, [load]);

  const current = files.find(f => f.path === selected) || null;
  const url = current ? hubApi.fileUrl(source, current.path) : null;

  return (
    <div className="h-full flex flex-col bg-white">
      <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-200 text-sm">
        <span className="font-semibold text-gray-700">{title}</span>
        {files.length > 1 && (
          <select
            value={selected ?? ''}
            onChange={e => setSelected(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1 text-gray-700 max-w-xs">
            {files.map(f => <option key={f.path} value={f.path}>{f.path}</option>)}
          </select>
        )}
        {current && (
          <span className="text-gray-400 truncate">
            {files.length === 1 ? `${current.name} · ` : ''}updated {formatWhen(current.modifiedAt)}
          </span>
        )}
        <div className="ml-auto flex gap-2">
          <button onClick={load} disabled={loading}
            className="px-3 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-700 disabled:opacity-50">
            ↻ Refresh
          </button>
          {url && (
            <a href={url} target="_blank" rel="noopener noreferrer"
              className="px-3 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-700">
              ↗ Open in new window
            </a>
          )}
        </div>
      </div>

      <div className="flex-1 relative">
        {loading && !current && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-400">Loading reports…</div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center p-8">
            <div className="max-w-md text-center text-gray-500">
              <div className="text-4xl mb-3">⚠️</div>
              <p className="font-medium text-gray-700">{title} reports can't be loaded</p>
              <p className="text-sm mt-2">{error}</p>
            </div>
          </div>
        )}
        {!loading && !error && files.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center p-8">
            <div className="max-w-md text-center text-gray-500">
              <div className="text-4xl mb-3">📄</div>
              <p className="font-medium text-gray-700">No {title} reports yet</p>
              <p className="text-sm mt-2">Add an .html report to this app's folder, then press Refresh.</p>
            </div>
          </div>
        )}
        {url && (
          <iframe
            key={`${url}-${reloadKey}`}
            src={url}
            title={`${title} report`}
            className="absolute inset-0 w-full h-full border-0"
            sandbox="allow-scripts allow-popups allow-downloads allow-modals"
          />
        )}
      </div>
    </div>
  );
};

export default ReportViewer;
