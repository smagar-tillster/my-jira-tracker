import { useState } from 'react';
import { DefectRowProposal, DeliveryPr, ReviewApiError, reviewsApi } from '../../services/api';
import { Modal, Section } from './shared';

const FIELD_LABEL: Record<string, string> = {
  title: 'Title', status: 'Status', repo: 'Repo', tenant_scope: 'Tenants', tags: 'Tags', symptom: 'Symptom', root_cause: 'Root cause',
  fingerprint_files: 'Files', fingerprint_functions_config: 'Functions / config', repro_steps: 'Repro steps', test_case: 'Test case',
  fix_summary: 'Fix', related_tickets: 'Related tickets', date_logged: 'Logged',
};
const SKIP = new Set(['jira_id']);

/** The defect ticket of a PR: the first ticket whose Jira type is a defect type. */
export const defectKey = (p: DeliveryPr) => p.tickets.find(t => /^(defect|bug|incident)$/i.test(t.type || ''))?.key;

function RowModal({ d, onClose }: { d: DefectRowProposal; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(d.csvLine); setCopied(true); window.setTimeout(() => setCopied(false), 2000); } catch { /* the line is selectable below */ }
  };
  if (d.existing) {
    return (
      <Modal title={`${d.existing.jira_id} is already in the defects feed`} subtitle="Nothing was drafted." onClose={onClose}>
        <Section title="Existing row"><p className="font-medium">{d.existing.title}</p><p className="text-gray-600">Tags: {d.existing.tags || '—'}</p><p className="text-gray-600 whitespace-pre-wrap">{d.existing.fix_summary}</p></Section>
      </Modal>
    );
  }
  return (
    <Modal title={`Proposed defects row · ${d.key}`} subtitle={<>{d.repo}#{d.number} · AI-assisted draft ({d.model}); check the root cause before you use it</>} onClose={onClose}>
      {d.possibleRepeat.length > 0 && (
        <div className="px-3 py-2 rounded bg-amber-50 border border-amber-200 text-amber-900">
          <p className="font-medium">Possible repeat of an earlier defect</p>
          <ul className="list-disc pl-5 mt-1">
            {d.possibleRepeat.map(r => (
              <li key={r.jira_id}><b>{r.jira_id}</b> {r.title}
                <span className="text-xs text-amber-800"> — {[r.sharedFiles.length ? `same file: ${r.sharedFiles.slice(0, 2).join(', ')}` : '', r.sharedTags.length ? `same tag: ${r.sharedTags.join(', ')}` : ''].filter(Boolean).join('; ')}</span></li>
            ))}
          </ul>
        </div>
      )}
      {(d.unsure.length > 0 || d.newTags.length > 0 || d.redacted.length > 0 || !d.feedFound) && (
        <ul className="text-xs text-gray-600 list-disc pl-5 space-y-0.5">
          {d.unsure.length > 0 && <li>Not established from the ticket or the diff: {d.unsure.map(f => FIELD_LABEL[f] || f).join(', ')}. Fill these in by hand.</li>}
          {d.newTags.length > 0 && <li>New tags (not yet in the feed): {d.newTags.join(', ')}. Reuse an existing tag if one fits.</li>}
          {d.redacted.length > 0 && <li>Something secret-like was found and removed: {d.redacted.join(', ')}.</li>}
          {!d.feedFound && <li>The defects feed file was not found on this machine, so the default columns were used and no repeat check was possible.</li>}
        </ul>
      )}
      <Section title="Row">
        <table className="w-full text-sm border border-gray-200 rounded overflow-hidden"><tbody>
          {d.columns.filter(c => !SKIP.has(c)).map(c => (
            <tr key={c} className="border-t border-gray-100 first:border-t-0 align-top">
              <td className="px-2 py-1.5 w-40 text-gray-500 whitespace-nowrap">{FIELD_LABEL[c] || c}</td>
              <td className={`px-2 py-1.5 whitespace-pre-wrap break-words ${d.unsure.includes(c) ? 'text-amber-800 bg-amber-50' : ''}`}>{d.row[c] || <span className="text-gray-400">—</span>}</td>
            </tr>
          ))}
        </tbody></table>
      </Section>
      <Section title="CSV line">
        <textarea readOnly value={d.csvLine} rows={4} onFocus={e => e.currentTarget.select()} className="w-full font-mono text-xs p-2 border border-gray-300 rounded bg-gray-50" />
        <div className="flex items-center gap-3 mt-1.5">
          <button onClick={copy} className="px-3 py-1.5 rounded bg-blue-600 text-white text-sm hover:bg-blue-700">{copied ? 'Copied ✓' : 'Copy CSV line'}</button>
          <span className="text-xs text-gray-500">Append it to <code>datafeeds/defects.csv</code> in my-rag, then run <code>ingest.py</code> once. Nothing is written for you, and it does not belong in the fix PR.</span>
        </div>
      </Section>
    </Modal>
  );
}

/** "Defect row" on a merged defect-fix PR: proposes a row for the defects feed (one model call) and shows it to copy. */
export default function DefectRowButton({ p }: { p: DeliveryPr }) {
  const key = defectKey(p);
  const [state, setState] = useState<'idle' | 'working'>('idle');
  const [shown, setShown] = useState<DefectRowProposal | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (p.open || !p.defectFix || !key) return null;

  const run = async () => {
    setErr(null); setState('working');
    try {
      const saved = await reviewsApi.savedDefectRow(p.repo, p.number);
      setShown(saved ?? (await reviewsApi.defectRow(p.repo, p.number, key)).data);
    } catch (e) { setErr(e instanceof ReviewApiError ? e.message : String((e as Error)?.message || e)); }
    finally { setState('idle'); }
  };

  return (
    <span className="inline-flex flex-col">
      <button onClick={run} disabled={state === 'working'} title={`Propose a row for the defects feed from ${key} and this PR. One model call; nothing is saved to the feed.`}
        className="text-xs px-2 py-1 rounded bg-rose-100 text-rose-800 hover:bg-rose-200 whitespace-nowrap disabled:opacity-60">
        {state === 'working' ? '⏳ Drafting row…' : 'Defect row'}
      </button>
      {err && <span className="text-[11px] text-red-600 max-w-[170px]" title={err}>{err.slice(0, 80)}</span>}
      {shown && <RowModal d={shown} onClose={() => setShown(null)} />}
    </span>
  );
}
