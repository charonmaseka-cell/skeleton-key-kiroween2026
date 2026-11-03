import { useLights } from './ThemeProvider';
import { seanceSentences } from './seance';
import type { SessionView } from './session-core';

/**
 * The séance summary (HU-13): one sentence per response document above the matrix, the plain counts beside it (SummaryBar, drawn by
 * ReviewWorkspace next to this). In Lights off the visible sentence uses the theme names and is hidden from assistive technology;
 * a plain version of the same sentence is always available to it. In Lights on only the plain sentence exists.
 */
export function Seance({ view }: { view: SessionView }) {
  const { mode } = useLights();
  const s = seanceSentences(view, mode);
  if (s.docs.length === 0) return null;
  const themed = mode === 'off';
  return (
    <section aria-labelledby="seance-h" data-seance="" className="space-y-1 rounded border border-sk-border bg-sk-surface p-3">
      <h3 id="seance-h" data-display="" className="text-lg font-semibold">
        {themed ? 'The séance' : 'Summary of this review'}
      </h3>
      <ul className="space-y-1">
        {s.docs.map((d) => (
          <li key={d.docId}>
            {themed && (
              <span data-theme-name="" aria-hidden="true">
                {d.text}
              </span>
            )}
            <span className={themed ? 'sr-only' : undefined}>{d.plain}</span>
          </li>
        ))}
      </ul>
      {s.coverage && <p className="text-sm">{s.coverage}</p>}
    </section>
  );
}
