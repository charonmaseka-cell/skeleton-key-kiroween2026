import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ReviewItem } from '@skeleton-key/engine';
import { useLights } from './ThemeProvider';
import type { SessionView } from './session-core';

// The signature pass (haunted-ui HU-17 to HU-27). Everything here is decoration or navigation sugar on top of the plain page:
//  - it runs only when `effects` is true (Lights off AND no reduced-motion request); otherwise it renders nothing and the page shows
//    the same information and offers the same controls;
//  - decoration is aria-hidden, ignores the pointer, and is drawn BEHIND text and controls (negative z-index layers over the page
//    colour on <body>), in gaps, or on borders; nothing appears at a random time or in a random place;
//  - no sound, no red, nothing sudden. The functions that matter (Next finding, the whisper's link) work with effects off too.

export const IDLE_MS = 45_000;
export const WHISPER_SHOWN_MS = 20_000;
export const SNUFF_MS = 1_500;
export const BOO_MS = 2_600;
export const BOO_COOLDOWN_MS = 5_000;
export const INK_MS = 3_400;
export const POINTER_SHOWN_MS = 1_600;

type Pointer = { x: number; y: number; show: boolean };

type Haunt = {
  effects: boolean;
  /** every item that needs review: one candle each */
  unresolved: ReviewItem[];
  /** the ones still open (not accepted or dismissed): what Next finding and the whisper go to */
  open: ReviewItem[];
  goNext: () => void;
  jumpTo: (findingId: string) => void;
  glowId: string | null;
  /** hover and focus handlers for a cell that stands for a finding: its evidence glows meanwhile */
  cellProps: (findingId: string | undefined) => { onMouseEnter?: () => void; onMouseLeave?: () => void; onFocus?: () => void; onBlur?: () => void };
  whisper: { id: string; text: string } | null;
  voice: SessionView['voice'] | null;
  fixtureId: string;
};

const NONE: Haunt = { effects: false, unresolved: [], open: [], goNext: () => undefined, jumpTo: () => undefined, glowId: null, cellProps: () => ({}), whisper: null, voice: null, fixtureId: '' };
const HauntContext = createContext<Haunt>(NONE);
export const useHaunt = () => useContext(HauntContext);

const isCritical = (i: ReviewItem) => i.finding.state === 'confirmed' && i.finding.severity === 'critical';

/** True while a dialog or the correction editor is open, or a field has focus: nothing ambient may happen then. */
export function interactionOpen(doc: Document = document): boolean {
  if (doc.querySelector('[role="dialog"], dialog[open], form[aria-label^="Correct "]')) return true;
  const a = doc.activeElement as HTMLElement | null;
  return !!a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable);
}

export function HauntProvider({ view, children }: { view?: SessionView; children: ReactNode }) {
  const { effects } = useLights();
  const unresolved = useMemo(() => (view ? view.items.filter((i) => i.finding.state === 'needs_review') : []), [view]);
  const open = useMemo(() => unresolved.filter((i) => i.review.status === 'open'), [unresolved]);
  const fixtureId = view?.fixture.id ?? '';
  const openRef = useRef(open);
  openRef.current = open;
  const cursor = useRef<string | null>(null);
  const [glowId, setGlow] = useState<string | null>(null);
  const [pointer, setPointer] = useState<Pointer | null>(null);
  const pointerTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [whisper, setWhisper] = useState<{ id: string; text: string } | null>(null);
  const whisperShown = useRef(false);
  const [drip, setDrip] = useState(0);
  const [boo, setBoo] = useState(0);
  const mist = useRef<HTMLDivElement>(null);

  // The item after the one last gone to, in page order; the first when there is none yet.
  const pick = useCallback((): ReviewItem | undefined => {
    const list = openRef.current;
    if (list.length === 0) return undefined;
    const at = list.findIndex((i) => i.finding.id === cursor.current);
    return list[(at + 1) % list.length];
  }, []);

  // The pointer is placed once the page has stopped scrolling (smooth scrolling moves the card while it travels), then slides in
  // along the card's top border from the left. That border is always on screen, and the padding there holds no text.
  const movePointer = useCallback((el: HTMLElement) => {
    clearTimeout(pointerTimer.current);
    let lastY = window.scrollY;
    let still = 0;
    const started = performance.now();
    const settle = () => {
      const y = window.scrollY;
      still = y === lastY ? still + 1 : 0;
      lastY = y;
      if (still < 6 && performance.now() - started < 1200) return void requestAnimationFrame(settle);
      const r = el.getBoundingClientRect();
      const x = r.left + window.scrollX + 22;
      const top = r.top + window.scrollY - 11;
      setPointer({ x: Math.max(2, x - 80), y: top, show: false });
      requestAnimationFrame(() => requestAnimationFrame(() => setPointer({ x, y: top, show: true })));
      pointerTimer.current = setTimeout(() => setPointer((p) => (p ? { ...p, show: false } : p)), POINTER_SHOWN_MS);
    };
    requestAnimationFrame(settle);
  }, []);

  const jumpTo = useCallback(
    (id: string) => {
      const el = document.getElementById(`finding-${id}`);
      if (!el) return;
      cursor.current = id;
      el.focus({ preventScroll: true });
      el.scrollIntoView({ block: 'center', behavior: effects ? 'smooth' : 'auto' });
      if (effects) movePointer(el);
    },
    [effects, movePointer],
  );
  const goNext = useCallback(() => {
    const next = pick();
    if (next) jumpTo(next.finding.id);
  }, [pick, jumpTo]);

  useEffect(() => () => clearTimeout(pointerTimer.current), []);
  useEffect(() => {
    if (!effects) setPointer(null);
  }, [effects]);
  // The pointer is placed in page coordinates, so it is only there for the glide and a short dwell, and goes at the next click or key
  // (a decision can change the layout under it).
  const pointerShown = !!pointer?.show;
  useEffect(() => {
    if (!pointerShown) return;
    const hide = () => setPointer((p) => (p ? { ...p, show: false } : p));
    window.addEventListener('pointerdown', hide, { capture: true });
    window.addEventListener('keydown', hide, { capture: true });
    return () => {
      window.removeEventListener('pointerdown', hide, { capture: true });
      window.removeEventListener('keydown', hide, { capture: true });
    };
  }, [pointerShown]);

  // HU-19: after 45 s with no input, once per page session, say which item is next. Blocked while anything is being edited.
  useEffect(() => {
    if (!effects) return;
    let t: ReturnType<typeof setTimeout>;
    let hide: ReturnType<typeof setTimeout> | undefined;
    const fire = () => {
      if (whisperShown.current) return;
      const next = pick();
      if (!next || interactionOpen()) return arm(); // wait for the next quiet stretch
      whisperShown.current = true;
      setWhisper({ id: next.finding.id, text: view?.voice.whisper(next.finding.message) ?? '' });
      hide = setTimeout(() => setWhisper(null), WHISPER_SHOWN_MS);
    };
    const arm = () => {
      clearTimeout(t);
      if (!whisperShown.current) t = setTimeout(fire, IDLE_MS);
    };
    const events = ['pointerdown', 'keydown', 'pointermove', 'wheel', 'touchstart', 'scroll'] as const;
    for (const e of events) window.addEventListener(e, arm, { passive: true, capture: true });
    arm();
    return () => {
      clearTimeout(t);
      clearTimeout(hide);
      for (const e of events) window.removeEventListener(e, arm, { capture: true });
    };
  }, [effects, pick, view]);

  // HU-23: one drop of ink for each critical finding that becomes confirmed during the session (not for those already there).
  const seen = useRef<{ fixture: string; ids: Set<string> } | null>(null);
  useEffect(() => {
    if (!view) return;
    const ids = view.items.filter(isCritical).map((i) => i.finding.id);
    if (!seen.current || seen.current.fixture !== view.fixture.id) {
      seen.current = { fixture: view.fixture.id, ids: new Set(ids) };
      return;
    }
    const fresh = ids.filter((id) => !seen.current!.ids.has(id));
    for (const id of fresh) seen.current.ids.add(id);
    if (fresh.length && effects) {
      setDrip((n) => n + 1);
      const t = setTimeout(() => setDrip(0), INK_MS);
      return () => clearTimeout(t);
    }
  }, [view, effects]);

  // HU-26: typing "boo" outside any field, editor or dialog.
  useEffect(() => {
    if (!effects) return;
    let buf = '';
    let last = 0;
    let lastBoo = -Infinity;
    let hide: ReturnType<typeof setTimeout> | undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
      const t = e.target as HTMLElement | null;
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable || t.closest?.('[role="dialog"], form[aria-label^="Correct "]'))) {
        buf = '';
        return;
      }
      const now = Date.now();
      buf = ((now - last > 1500 ? '' : buf) + e.key.toLowerCase()).slice(-3);
      last = now;
      if (buf === 'boo' && now - lastBoo > BOO_COOLDOWN_MS) {
        lastBoo = now;
        buf = '';
        setBoo((n) => n + 1);
        clearTimeout(hide);
        hide = setTimeout(() => setBoo(0), BOO_MS);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      clearTimeout(hide);
    };
  }, [effects]);

  // HU-24: a faint mist trail behind the page while the pointer moves (mouse and pen only), a few puffs at a time.
  useEffect(() => {
    const host = mist.current;
    if (!effects || !host) return;
    let last = 0;
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const now = performance.now();
      if (now - last < 45) return;
      last = now;
      while (host.childElementCount >= 10) host.firstElementChild?.remove();
      const puff = document.createElement('span');
      puff.style.left = `${e.clientX}px`;
      puff.style.top = `${e.clientY}px`;
      puff.addEventListener('animationend', () => puff.remove(), { once: true });
      host.appendChild(puff);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      host.replaceChildren();
    };
  }, [effects]);

  const cellProps = useCallback(
    (id: string | undefined) => (id ? { onMouseEnter: () => setGlow(id), onMouseLeave: () => setGlow(null), onFocus: () => setGlow(id), onBlur: () => setGlow(null) } : {}),
    [],
  );

  const value = useMemo<Haunt>(
    () => ({ effects, unresolved, open, goNext, jumpTo, glowId, cellProps, whisper, voice: view?.voice ?? null, fixtureId }),
    [effects, unresolved, open, goNext, jumpTo, glowId, cellProps, whisper, view, fixtureId],
  );

  return (
    <HauntContext.Provider value={value}>
      {children}
      {effects && (
        <>
          <div ref={mist} data-motif="mist" aria-hidden="true" className="no-print pointer-events-none fixed inset-0" style={{ zIndex: -1 }} />
          {pointer && (
            <div data-planchette="" data-motif="planchette" data-show={pointer.show ? '' : undefined} aria-hidden="true" className="no-print pointer-events-none absolute left-0 top-0 z-[5]" style={{ transform: `translate(${pointer.x}px, ${pointer.y}px)` }}>
              <Planchette />
            </div>
          )}
          {drip > 0 && <InkDrip key={drip} />}
          {boo > 0 && <Boo key={boo} />}
        </>
      )}
    </HauntContext.Provider>
  );
}

// ---- decoration ----------------------------------------------------------------------------------------------------------------

function Planchette() {
  return (
    <svg width="24" height="26" viewBox="0 0 24 26" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" className="text-sk-accent drop-shadow">
      <path d="M12 2c5 0 10 4 10 9 0 6-7 11-10 13C9 22 2 17 2 11 2 6 7 2 12 2z" fill="color-mix(in srgb, var(--sk-surface) 82%, transparent)" />
      <circle cx="12" cy="11" r="3.2" />
    </svg>
  );
}

/** A single drop of dark ink (ectoplasm-dark) running down the right margin, once. Never red. */
function InkDrip() {
  return (
    <div data-ink="" data-motif="ink" aria-hidden="true" className="no-print pointer-events-none absolute right-1 top-0 z-20 h-40 w-2.5">
      <span data-ink-line="" />
      <span data-ink-drop="" />
    </div>
  );
}

const GHOST_PATH = 'M12 2C7.6 2 5 5.4 5 9.5V21l2.6-2 2.2 2 2.2-2 2.2 2 2.2-2L19 21V9.5C19 5.4 16.4 2 12 2z';

/** The easter egg: ghosts drift up BEHIND the page, in fixed places, for about two seconds. */
function Boo() {
  const spots = [
    { left: '2%', top: '16%', size: 150 },
    { right: '3%', top: '38%', size: 170 },
    { left: '9%', top: '62%', size: 130 },
    { right: '11%', top: '76%', size: 150 },
    { left: '46%', top: '2%', size: 120 },
  ];
  return (
    <div data-boo="" data-motif="boo" aria-hidden="true" className="no-print pointer-events-none fixed inset-0" style={{ zIndex: -1 }}>
      {spots.map((s, i) => (
        <svg key={i} viewBox="0 0 24 24" width={s.size} height={s.size} style={{ left: s.left, right: s.right, top: s.top, animationDelay: `${i * 90}ms` }}>
          <path d={GHOST_PATH} fill="currentColor" />
          <circle cx="9.5" cy="9.5" r="1.3" fill="var(--sk-bg)" />
          <circle cx="14.5" cy="9.5" r="1.3" fill="var(--sk-bg)" />
        </svg>
      ))}
    </div>
  );
}

/** Fog behind the header text (HU-24). Behind, so it never covers the text it sits under. */
export function HeaderFog() {
  const { effects } = useHaunt();
  if (!effects) return null;
  return <div data-fog="" data-motif="fog" aria-hidden="true" className="no-print pointer-events-none absolute inset-x-0 top-0 h-full" style={{ zIndex: -1 }} />;
}

/** One candle per item that needs review (HU-17). Lit candles equal the Needs review count at every moment. */
export function Candles() {
  const { effects, unresolved } = useHaunt();
  if (!effects) return null;
  return <CandleRow ids={unresolved.map((i) => i.finding.id)} />;
}

function CandleRow({ ids }: { ids: string[] }) {
  const [order, setOrder] = useState<string[]>(ids);
  const [expired, setExpired] = useState<ReadonlySet<string>>(new Set());
  const timed = useRef(new Set<string>());
  const current = new Set(ids);

  // A candle whose item stopped needing review stays, unlit with its wisp of smoke, for SNUFF_MS, then goes.
  useEffect(() => {
    for (const id of order) {
      if (current.has(id) || timed.current.has(id)) continue;
      timed.current.add(id);
      setTimeout(() => {
        setExpired((e) => new Set(e).add(id));
        setOrder((o) => o.filter((x) => x !== id));
      }, SNUFF_MS);
    }
    const added = ids.filter((id) => !order.includes(id));
    if (added.length) setOrder((o) => [...o, ...added.filter((id) => !o.includes(id))]);
  }, [ids.join('|')]);

  // What is drawn now, derived from this render's props so the lit count is exact at every render: the lit candles (existing ones in
  // their place, new ones at the end) and the ones still being snuffed.
  const shown = [...order.filter((id) => current.has(id) || !expired.has(id)), ...ids.filter((id) => !order.includes(id))];
  return (
    <div data-candles="" data-motif="candles" aria-hidden="true" className="no-print pointer-events-none mt-2 flex min-h-8 flex-wrap items-end gap-1.5">
      {shown.map((id) => (
        <span key={id} data-candle="" data-lit={current.has(id) ? 'true' : 'false'}>
          <span data-flame="" />
          <span data-wick="" />
          <span data-wax="" />
          {!current.has(id) && <span data-smoke="" />}
        </span>
      ))}
    </div>
  );
}

/** The header's line for the idle whisper: an `aria-live` region that exists from the start and is empty until it speaks. */
export function WhisperLine() {
  const { whisper, jumpTo } = useHaunt();
  return (
    <p aria-live="polite" data-whisper="" className="no-print text-sm italic">
      {whisper && (
        <button type="button" onClick={() => jumpTo(whisper.id)} className="rounded border border-sk-border px-2 py-0.5 text-left italic underline">
          {whisper.text}
        </button>
      )}
    </p>
  );
}

/** HU-18: a real button in both modes. With effects the planchette glides to the item; without them focus simply moves there. */
export function NextFinding() {
  const { open, goNext } = useHaunt();
  if (open.length === 0) return null;
  return (
    <button type="button" data-next-finding="" onClick={goNext} className="no-print rounded border-2 border-sk-border bg-sk-surface px-3 py-1">
      Next finding
    </button>
  );
}

/** HU-22: a wax seal beside the decision buttons while the item is accepted. Violet wax (colours in effects.css), never red. */
export function WaxSeal({ fresh }: { fresh: boolean }) {
  const { effects } = useHaunt();
  if (!effects) return null;
  return (
    <svg data-seal="" data-motif="seal" data-stamp={fresh ? '' : undefined} aria-hidden="true" focusable="false" width="30" height="30" viewBox="0 0 30 30" className="no-print pointer-events-none self-center">
      <path className="wax-body" d="M15 1.5c2.2 0 3.3 1.8 5.3 2.3 2 .5 4.2-.2 5.4 1.5 1.2 1.7.1 3.7.5 5.6.5 2 2.5 3.1 2.1 5.1-.4 2-2.6 2.6-3.6 4.3-1 1.7-.7 4-2.5 5-1.8 1-3.7-.2-5.6.2-1.9.4-3.2 2.3-5.2 1.8-2-.5-2.6-2.7-4.2-3.8-1.6-1.1-4-.8-4.9-2.6-.9-1.8.5-3.6.2-5.5-.3-1.9-2.2-3.2-1.6-5.1.6-1.9 2.8-2.2 4-3.7 1.2-1.5.9-3.8 2.7-4.6 1.8-.8 3.5.6 5.4.4z" strokeWidth="1" />
      <circle className="wax-ring" cx="15" cy="15" r="8.2" fill="none" strokeWidth="1" />
      <circle className="wax-mark" cx="12.2" cy="13" r="2.4" fill="none" strokeWidth="1.3" />
      <path className="wax-mark" d="M14 14.5l5.5 5.5M17.3 17.8l1.6-1.6" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

/** HU-22: the ghost that fades out of a card when it is dismissed (once). The card stays, and Reopen restores it. */
export function FadingGhost() {
  const { effects } = useHaunt();
  if (!effects) return null;
  return (
    <svg data-fade-ghost="" data-motif="fade" aria-hidden="true" focusable="false" width="24" height="24" viewBox="0 0 24 24" className="no-print pointer-events-none absolute right-6 -top-3 text-sk-muted">
      <path d={GHOST_PATH} fill="currentColor" />
    </svg>
  );
}
