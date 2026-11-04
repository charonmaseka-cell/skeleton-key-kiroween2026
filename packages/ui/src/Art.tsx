import type { ReactNode } from 'react';
import { useHaunt } from './Haunt';

// Original art for the candlelight pass (haunted-ui HU-33), drawn in code: carved pumpkins, a lantern, candles, a lock and a spectral
// key. No file, no photo, no third-party image (docs/art.md lists each piece). Colour lives in effects.css as `.art-*` classes (the warm
// colours only there, and only for header, gutter and illustration rules: HU-32); the components name no colour and use no `id`
// (so none can be duplicated). Every piece is decoration: aria-hidden, no text, ignores the pointer, and exists only with effects on.

/** A carved pumpkin, local coordinates 0..100 by 0..90. `face` picks the carving. */
export function PumpkinG({ face = 'grin' }: { face?: 'grin' | 'oh' }) {
  return (
    <g>
      <ellipse className="art-glow" cx="50" cy="54" rx="52" ry="40" />
      <ellipse className="art-pumpkin" cx="29" cy="54" rx="25" ry="31" />
      <ellipse className="art-pumpkin" cx="71" cy="54" rx="25" ry="31" />
      <ellipse className="art-pumpkin-mid" cx="50" cy="53" rx="25" ry="33" />
      <path className="art-rib" d="M50 21C41 37 41 69 50 86M33 27C22 41 24 66 35 82M67 27C78 41 76 66 65 82" />
      <path className="art-stem" d="M45 22C44 12 50 6 59 9L57 17C54 15 52 17 52 23z" />
      <path className="art-carve" d="M30 46L42 46L36 33zM58 46L70 46L64 33zM50 51L45 60L55 60z" />
      {face === 'grin' ? (
        <path className="art-carve" d="M28 63L37 71L44 64L50 73L56 64L63 71L72 63L68 79Q50 90 32 79z" />
      ) : (
        <path className="art-carve" d="M50 64C58 64 62 70 62 76C62 83 56 86 50 86C44 86 38 83 38 76C38 70 42 64 50 64z" />
      )}
    </g>
  );
}

/** A hanging lantern with a lit candle, local coordinates 0..60 by 0..110. */
export function LanternG() {
  return (
    <g>
      <ellipse className="art-glow" cx="30" cy="52" rx="34" ry="46" />
      <circle className="art-iron-line" cx="30" cy="7" r="5" fill="none" />
      <path className="art-iron-line" d="M30 12V16" />
      <path className="art-iron" d="M14 28L22 17H38L46 28z" />
      <rect className="art-glass" x="14" y="28" width="32" height="52" rx="3" />
      <path className="art-iron-line" d="M14 28V80M30 28V80M46 28V80" />
      <rect className="art-wax" x="26" y="56" width="8" height="22" rx="1.5" />
      <rect className="art-wick" x="29.5" y="51" width="1" height="5" />
      <path className="art-flame" d="M30 36C34 43 34 49 30 51C26 49 26 43 30 36z" />
      <path className="art-iron" d="M11 80H49L44 90H16z" />
      <path className="art-iron-line" d="M20 90L17 98M40 90L43 98" />
    </g>
  );
}

/** Three candles, local coordinates 0..120 by 0..60 (their feet at y = 58). */
export function CandlesG() {
  return (
    <g>
      {[
        { x: 18, h: 30 },
        { x: 60, h: 40 },
        { x: 102, h: 30 },
      ].map((c) => (
        <g key={c.x}>
          <ellipse className="art-glow" cx={c.x} cy={58 - c.h - 8} rx="14" ry="16" />
          <rect className="art-wax" x={c.x - 6} y={58 - c.h} width="12" height={c.h} rx="2" />
          <rect className="art-wick" x={c.x - 0.5} y={58 - c.h - 5} width="1" height="5" />
          <path className="art-flame" d={`M${c.x} ${58 - c.h - 19}C${c.x + 5} ${58 - c.h - 12} ${c.x + 4} ${58 - c.h - 4} ${c.x} ${58 - c.h - 4}C${c.x - 4} ${58 - c.h - 4} ${c.x - 5} ${58 - c.h - 12} ${c.x} ${58 - c.h - 19}z`} />
        </g>
      ))}
    </g>
  );
}

/** A lock with a spectral key that turns in it once (CSS), then rests. Local coordinates 0..120 by 0..90. */
export function LockAndKeyG() {
  return (
    <g>
      <path className="art-shackle" d="M30 40V27a12 12 0 0 1 24 0V40" fill="none" />
      <rect className="art-lock" x="20" y="40" width="44" height="38" rx="5" />
      <circle className="art-keyhole" cx="42" cy="56" r="5" />
      <rect className="art-keyhole" x="40.4" y="58" width="3.2" height="9" rx="1" />
      <g className="art-key">
        <circle cx="94" cy="56" r="10" fill="none" />
        <circle cx="94" cy="56" r="4" fill="none" />
        <path d="M84 56H44M60 56V63M52 56V62" fill="none" />
      </g>
    </g>
  );
}

const Svg = ({ w, h, children, className = '' }: { w: number; h: number; children: ReactNode; className?: string }) => (
  <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true" focusable="false" className={className}>
    {children}
  </svg>
);

/**
 * The header's art (from 768 px): lock and key, a lantern and two pumpkins, in the free space at the top right of the header, above the
 * tagline and left of the corner pumpkin. The lock is keyed by the set, so the key turns again for every set that loads (HU-34).
 */
export function HeaderArt() {
  const { effects, fixtureId } = useHaunt();
  if (!effects) return null;
  return (
    <div data-header-art="" data-motif="header-art" data-warm="" aria-hidden="true" className="no-print pointer-events-none absolute right-24 top-3 hidden items-end gap-3 md:flex">
      <Svg w={120} h={90} className="h-[84px] w-[112px]">
        <LockAndKeyG key={fixtureId} />
      </Svg>
      <Svg w={60} h={110} className="h-[88px] w-[48px]">
        <LanternG />
      </Svg>
      <Svg w={100} h={90} className="h-[74px] w-[82px]">
        <PumpkinG face="grin" />
      </Svg>
      <Svg w={100} h={90} className="h-[56px] w-[62px]">
        <PumpkinG face="oh" />
      </Svg>
    </div>
  );
}

/** Beside the counts (from 768 px): a pumpkin, candles on a round table with a planchette, a lantern, and a few pieces of ectoplasm. */
export function SeanceArt() {
  const { effects } = useHaunt();
  if (!effects) return null;
  return (
    <svg data-seance-art="" data-motif="seance-art" data-warm="" aria-hidden="true" focusable="false" viewBox="0 0 250 132" width="250" height="132" className="no-print pointer-events-none hidden shrink-0 self-center md:block">
      <ellipse className="art-table" cx="125" cy="108" rx="118" ry="20" />
      <ellipse className="art-table-top" cx="125" cy="104" rx="114" ry="16" />
      <g transform="translate(8 40) scale(0.72)">
        <PumpkinG face="grin" />
      </g>
      <g transform="translate(76 46)">
        <CandlesG />
      </g>
      <g transform="translate(200 20) scale(0.7)">
        <LanternG />
      </g>
      <g className="art-planchette">
        <path className="art-board" d="M98 112c0-5 11-9 27-9s27 4 27 9c0 4-11 7-27 7s-27-3-27-7z" />
        <circle className="art-lens" cx="125" cy="110" r="3.4" />
      </g>
      <g className="art-spirits">
        <path className="art-wisp art-wisp-1" d="M104 44c-9-10 7-15 0-27s9-14 4-26c8 8 2 16 8 25s-8 17-12 28z" transform="translate(0 14)" />
        <path className="art-wisp art-wisp-2" d="M150 44c8-9-6-14 1-25s-8-13-3-24c-7 7-2 15-7 24s7 16 9 25z" transform="translate(0 14)" />
        <circle className="art-orb art-orb-1" cx="118" cy="14" r="3" />
        <circle className="art-orb art-orb-2" cx="139" cy="9" r="2.2" />
        <circle className="art-orb art-orb-3" cx="128" cy="4" r="1.8" />
      </g>
    </svg>
  );
}

/** The trick-or-treat pumpkin (HU-35): a real button in the header's top-right corner, free space at every width. */
export function CornerPumpkin() {
  const { effects, trickOrTreat, busy } = useHaunt();
  if (!effects) return null;
  return (
    <button type="button" data-trick-or-treat="" data-warm="" data-busy={busy ? '' : undefined} aria-label="Trick or treat" onClick={trickOrTreat} className="no-print absolute right-3 top-3 h-11 w-11 rounded-full border-2 border-transparent p-0.5">
      <svg viewBox="0 0 100 90" aria-hidden="true" focusable="false" className="pointer-events-none h-full w-full">
        <PumpkinG face="oh" />
      </svg>
    </button>
  );
}
