import { useState } from 'react';
import { download, type SessionView } from '@skeleton-key/ui';
import { clarificationLists } from './clarification';

// One clarification list per supplier, under the matrix and totals' sibling sections: preview, copy, download. Text only.
export function ClarificationPanel({ view, baseName }: { view: SessionView; baseName: string }) {
  const [note, setNote] = useState('');
  const lists = clarificationLists(view);
  if (lists.length === 0) return null;
  const copy = async (text: string, supplier: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setNote(`Copied the clarification list for ${supplier}.`);
    } catch {
      setNote(`Could not copy automatically. Open the preview for ${supplier}, select the text and copy it.`);
    }
  };
  return (
    <section aria-labelledby="clar-h" className="space-y-2">
      <h3 id="clar-h" className="text-xl font-semibold">
        Clarification lists
      </h3>
      <p className="text-sm">
        One plain-text list per supplier, from the confirmed findings and the unresolved items about that supplier&apos;s quotation, each marked CONFIRMED or TO CHECK, ready to paste into an email. Items you dismissed are left out. A list names only its own supplier and does not rank or recommend anyone.
      </p>
      <ul className="space-y-2">
        {lists.map((l) => (
          <li key={l.docId} className="rounded border border-sk-border bg-sk-surface p-3">
            <p className="font-medium">
              {l.supplier}: {l.confirmed} confirmed, {l.toCheck} to check
            </p>
            <div className="no-print mt-1 flex flex-wrap gap-2">
              <button type="button" onClick={() => void copy(l.text, l.supplier)} aria-label={`Copy to clipboard: clarification list for ${l.supplier}`} className="rounded bg-sk-text px-3 py-1 text-sk-bg">
                Copy to clipboard
              </button>
              <button type="button" onClick={() => download(`${baseName}-${l.docId}-clarification.txt`, 'text/plain', l.text)} aria-label={`Download text: clarification list for ${l.supplier}`} className="rounded border-2 border-sk-border px-3 py-1">
                Download text
              </button>
            </div>
            <details className="mt-1">
              <summary className="cursor-pointer">Preview: {l.supplier}</summary>
              <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded bg-sk-bg p-3 text-sm">{l.text}</pre>
            </details>
          </li>
        ))}
      </ul>
      <p aria-live="polite" className="text-sm">
        {note}
      </p>
    </section>
  );
}
