// Haunted interface: colour tokens for the two modes. See .kiro/specs/haunted-ui/design.md.
//
// "Lights off" is the haunted presentation; "Lights on" is the plain, light presentation with no
// decorative effects. Both carry every review state and keep evidence readable. The tokens are data so
// a test can enforce WCAG 2.x AA contrast on every pair that carries text or a control boundary.

export type Mode = 'off' | 'on';

export type Palette = {
  bg: string;
  surface: string;
  text: string;
  muted: string;
  /** boundary of inputs, cards and buttons (non-text, needs 3:1) */
  border: string;
  accent: string;
  danger: string;
  ok: string;
  info: string;
  link: string;
  /** keyboard focus ring (non-text, needs 3:1) */
  focus: string;
  /** cited-evidence highlight; also drawn with an outline so it never depends on colour alone */
  markBg: string;
  markText: string;
};

export const PALETTES: Record<Mode, Palette> = {
  off: {
    bg: '#0f1117',
    surface: '#181b24',
    text: '#e8e6e3',
    muted: '#b8b4ad',
    border: '#7c8396',
    accent: '#ffb454',
    danger: '#ff9b94',
    ok: '#7bd88f',
    info: '#8ab4ff',
    link: '#9cc2ff',
    focus: '#ffd166',
    markBg: '#ffe08a',
    markText: '#1a1300',
  },
  on: {
    bg: '#ffffff',
    surface: '#f5f5f7',
    text: '#14171f',
    muted: '#3d4352',
    border: '#5b6275',
    accent: '#8a4b00',
    danger: '#a30000',
    ok: '#0b5d1e',
    info: '#0b3d91',
    link: '#0b3d91',
    focus: '#1d4ed8',
    markBg: '#fff1a8',
    markText: '#1a1300',
  },
};

const channel = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** Relative luminance of #rrggbb (WCAG 2.x). */
export function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => channel(parseInt(h.slice(i, i + 2), 16) / 255)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio between two #rrggbb colours (1 to 21). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Pairs that must meet AA: text 4.5:1, non-text (boundaries, focus) 3:1. */
export const REQUIRED_PAIRS: { fg: keyof Palette; bg: keyof Palette; min: number; what: string }[] = [
  ...(['text', 'muted', 'accent', 'danger', 'ok', 'info', 'link'] as const).flatMap((fg) =>
    (['bg', 'surface'] as const).map((bg) => ({ fg, bg, min: 4.5, what: `${fg} text on ${bg}` })),
  ),
  { fg: 'markText', bg: 'markBg', min: 4.5, what: 'highlighted evidence text' },
  ...(['bg', 'surface'] as const).flatMap((bg) => [
    { fg: 'border' as const, bg, min: 3, what: `control boundary on ${bg}` },
    { fg: 'focus' as const, bg, min: 3, what: `focus ring on ${bg}` },
  ]),
];
