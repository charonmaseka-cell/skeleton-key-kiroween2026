import { createContext, useContext } from 'react';

// Runes for the "trick" half of trick or treat (haunted-ui HU-35): for three seconds the app title and the séance heading are drawn in
// runes. The runes are 24 hand-drawn strokes (original; no font), chosen by arithmetic from the letter's place and the step, never at
// random. The real text stays in the page, transparent and in place, so assistive technology and layout are unchanged; the runes are an
// aria-hidden overlay. Only DisplayText can show them, and only the title and the séance heading use DisplayText: data text never does.

export const RUNE_STEP_MS = 100;
export const RUNE_MS = 3_000;

export type RuneState = { on: boolean; step: number };
export const RuneContext = createContext<RuneState>({ on: false, step: 0 });

/** Elder-Futhark-style strokes in a 10 by 14 box. */
export const RUNES: string[] = [
  'M2 14V1M2 5L8 1M2 9L8 5',
  'M2 14V1L8 5V14',
  'M2 14V1M2 4L8 7L2 10',
  'M2 14V1L8 4M2 6L8 9',
  'M2 14V1L7 4L2 8L8 14',
  'M7 2L2 7L7 12',
  'M1 2L9 12M9 2L1 12',
  'M2 14V1L7 4L2 7',
  'M2 1V14M8 1V14M2 5L8 9',
  'M5 1V14M2 5L8 9',
  'M5 1V14',
  'M7 2L3 5L7 8L3 12',
  'M5 1V14M5 1L2 4M5 14L8 11',
  'M2 14V1L8 4V8L2 11',
  'M5 14V1M5 7L1 2M5 7L9 2',
  'M7 1L3 6L7 9L3 14',
  'M5 14V1M1 5L5 1L9 5',
  'M2 1V14M2 1L7 4L2 7L7 10L2 14',
  'M2 14V1M8 14V1M2 1L5 5L8 1',
  'M2 14V1M8 14V1M2 1L8 8M8 1L2 8',
  'M2 14V1L7 5',
  'M5 1L1 7L5 13L9 7z',
  'M2 1V14M8 1V14M2 1L8 14M8 1L2 14',
  'M5 1L1 6L9 6zM3 8L1 13M7 8L9 13',
];

/** Which rune stands for the letter at `index`, at animation `step`: arithmetic, not chance. */
export const runeFor = (ch: string, index: number, step: number): number => (ch.charCodeAt(0) * 7 + index * 5 + step * 3) % RUNES.length;

function Rune({ i }: { i: number }) {
  return (
    <svg viewBox="0 0 10 14" width="0.62em" height="0.9em" aria-hidden="true" focusable="false" className="inline-block shrink-0">
      <path d={RUNES[i]} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Text that can be drawn in runes for a moment. Use it only for the app title and the séance heading. */
export function DisplayText({ text }: { text: string }) {
  const r = useContext(RuneContext);
  if (!r.on) return <>{text}</>;
  return (
    <span data-runes-host="" className="relative inline-block">
      <span data-runes-real="" style={{ color: 'transparent', textShadow: 'none' }}>
        {text}
      </span>
      <span data-runes="" aria-hidden="true" className="absolute inset-0 flex items-baseline whitespace-pre">
        {[...text].map((ch, i) => (ch === ' ' ? <span key={i} style={{ width: '0.3em' }} /> : <Rune key={i} i={runeFor(ch, i, r.step)} />))}
      </span>
    </span>
  );
}
