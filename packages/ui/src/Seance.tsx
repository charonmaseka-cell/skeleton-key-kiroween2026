import { DisplayText } from './Runes';
import { useLights } from './ThemeProvider';
import { seanceSentences } from './seance';
import type { SessionView } from './session-core';

/**
 * The séance summary (HU-13): one sentence per response document above the matrix, the plain counts beside it (SummaryBar, drawn by
 * ReviewWorkspace next to this). In Lights off the visible sentence uses the theme names and is hidden from assistive technology;
 * a plain version of the same sentence is always available to it. In Lights on only the plain sentence exists.
 */
/** Digits are data: in the typewriter face a 1 reads as a lowercase l, so every run of digits is drawn in the data font with tabular figures. */
export function Figures({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\d+)/).map((part, i) =>
        i % 2 === 1 ? (
          <span key={i} data-figure="">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}

export function Seance({ view }: { view: SessionView }) {
  const { mode } = useLights();
  const s = seanceSentences(view, mode);
  if (s.docs.length === 0) return null;
  const themed = mode === 'off';
  return (
    <section aria-labelledby="seance-h" data-seance="" data-typewriter="" className="space-y-1 rounded border border-sk-border bg-sk-surface p-3">
      <h3 id="seance-h" data-typewriter="" className="text-lg font-semibold">
        <DisplayText text={themed ? 'The séance' : 'Summary of this review'} />
      </h3>
      <ul className="space-y-1">
        {s.docs.map((d) => (
          <li key={d.docId}>
            {themed && (
              <span data-theme-name="" data-typewriter="" aria-hidden="true">
                <Figures text={d.text} />
              </span>
            )}
            <span className={themed ? 'sr-only' : undefined}>{d.plain}</span>
          </li>
        ))}
      </ul>
      {s.coverage && (
        <p className="text-sm">
          <Figures text={s.coverage} />
        </p>
      )}
    </section>
  );
}
