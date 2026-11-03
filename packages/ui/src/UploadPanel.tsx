import { useEffect, useId, useRef, useState } from 'react';
import type { Block } from '@skeleton-key/engine';
import { StatusBadge } from './Badges';
import { ProgressView, initialStages, setStage, type Stage } from './ProgressView';
import { ERROR_TEXT, MAX_CALLS_PER_SESSION, MAX_CHUNKS_PER_DOC, analyseAll, newClientSession, refusalText, type ClientConfig, type DocumentResult, type ErrorKind, type RunRefusal } from './extraction-client';
import { buildLiveFixture, type Fixture } from './session-core';

// Upload and Analyse (foundation tasks 8 and 9; spec SC-1, SC-2, SC-5).
//
//  - A file is parsed ON THE DEVICE as soon as it is chosen. Nothing is sent.
//  - Text is sent only when the user presses Analyse, after a plain statement that extracted text leaves the device.
//  - Failures stay visible and recoverable: a failed chunk marks its document "not fully processed", the user can
//    retry the failed parts manually, and sample mode remains available (R8.10, R9). A run in which NOTHING was processed
//    (for example refused with daily_limit or limiter_unavailable) does not replace the page: the sample set stays shown.
//  - The panel is a collapsed section BELOW the sample results; the privacy statement and the limits are inside it.

export type UploadSlot = { id: string; role: string; label: string; schemaId: string; required: boolean };

export type UploadDeps = {
  /** Parse a chosen file into blocks. Default: the browser PDF parser, loaded on first use. */
  parse?: (file: File, docId: string) => Promise<Block[]>;
  fetchImpl?: typeof fetch;
};

export const MAX_FILE_BYTES = 5 * 1024 * 1024;

async function defaultParse(file: File, docId: string): Promise<Block[]> {
  const { parsePdfInBrowser } = await import('@skeleton-key/ingest/browser');
  return parsePdfInBrowser(new Uint8Array(await file.arrayBuffer()), docId);
}

function parseError(e: unknown): string {
  const msg = e instanceof Error ? e.message : '';
  if (msg === 'unsupported_pdf:scanned_or_empty') return 'This PDF has no text layer (it looks scanned). Scanned documents are not supported; nothing was read.';
  if (msg === 'unsupported_pdf:unreadable') return 'This file could not be read as a PDF.';
  return 'This file could not be read.';
}

type Parsed = { file: File; blocks: Block[] } | { file: File; error: string };
type Run = { slot: UploadSlot; result: DocumentResult };

export function UploadPanel({
  slots,
  baseUrl,
  deps = {},
  onResult,
  idPrefix,
}: {
  slots: UploadSlot[];
  /** Worker URL. When missing, Analyse is unavailable and the panel says so. */
  baseUrl?: string;
  deps?: UploadDeps;
  onResult: (fixture: Fixture) => void;
  idPrefix: string;
}) {
  const uid = useId();
  const panel = useRef<HTMLDetailsElement>(null);
  // The in-page link "#upload" opens the collapsed section, so it is never a link to something hidden.
  useEffect(() => {
    const open = () => {
      if (window.location.hash === '#upload' && panel.current) panel.current.open = true;
    };
    open();
    window.addEventListener('hashchange', open);
    return () => window.removeEventListener('hashchange', open);
  }, []);
  const [parsed, setParsed] = useState<Record<string, Parsed>>({});
  const [runs, setRuns] = useState<Run[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [stopped, setStopped] = useState<ErrorKind | null>(null);
  const [refusal, setRefusal] = useState<RunRefusal | null>(null);
  const [stages, setStages] = useState<Stage[] | null>(null);
  const session = useRef(newClientSession());
  const analyses = useRef(0);
  const parse = deps.parse ?? defaultParse;

  const ready = slots.filter((s) => s.required).every((s) => 'blocks' in (parsed[s.id] ?? { error: '' })) && Object.values(parsed).some((p) => 'blocks' in p);
  const configured = !!baseUrl;

  async function choose(slot: UploadSlot, file: File | undefined) {
    setStopped(null);
    if (!file) {
      setParsed((p) => {
        const { [slot.id]: _drop, ...rest } = p;
        void _drop;
        return rest;
      });
      return;
    }
    if (file.size > MAX_FILE_BYTES) return setParsed((p) => ({ ...p, [slot.id]: { file, error: `This file is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB, which is more than this version reads.` } }));
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') return setParsed((p) => ({ ...p, [slot.id]: { file, error: 'Only PDF files with a text layer are supported in this version.' } }));
    try {
      const blocks = await parse(file, slot.id);
      setParsed((p) => ({ ...p, [slot.id]: { file, blocks } }));
    } catch (e) {
      setParsed((p) => ({ ...p, [slot.id]: { file, error: parseError(e) } }));
    }
  }

  const tick = () => new Promise<void>((r) => setTimeout(r, 0));

  async function analyse(retry: boolean) {
    if (!configured) return;
    setBusy(true);
    setStopped(null);
    setRefusal(null);
    const cfg: ClientConfig = { baseUrl: baseUrl!, fetchImpl: deps.fetchImpl };
    const used = slots.filter((s) => 'blocks' in (parsed[s.id] ?? { error: '' }));
    if (!retry) session.current = newClientSession();
    const label = (id: string) => slots.find((s) => s.id === id)?.label ?? id;
    // 1. Reading: the files were read on this device when they were chosen; this stage says what is about to be sent.
    const lines = used.reduce((n, s) => n + (parsed[s.id] as { blocks: Block[] }).blocks.length, 0);
    let st = setStage(initialStages(), 'reading', 'done', `${used.length} document(s), ${lines} text lines, read on your device`);
    st = setStage(st, 'extracting', 'active', 'Reserving the allowance for the whole run before anything is sent');
    setStages(st);
    await tick();
    const { results, stoppedBy, refusal: refused } = await analyseAll(
      cfg,
      session.current,
      used.map((slot) => ({ docId: slot.id, schemaId: slot.schemaId, blocks: (parsed[slot.id] as { blocks: Block[] }).blocks })),
      {
        previous: retry ? Object.fromEntries(runs.map((r) => [r.slot.id, r.result])) : undefined,
        onAdmitted: ({ chunks }) => {
          st = setStage(st, 'extracting', 'active', `Allowance reserved for all ${chunks} part(s). Sending…`);
          setStages(st);
        },
        onProgress: (id, done, total) => {
          setProgress(`${label(id)}: part ${Math.min(done + 1, total)} of ${total}`);
          st = setStage(st, 'extracting', 'active', `${label(id)}: ${done} of ${total} part(s) done`);
          setStages(st);
        },
      },
    );
    analyses.current += 1;
    if (refused) {
      // Refused up front: nothing was sent, nothing was cut off. The page stays as it was.
      setRefusal(refused);
      setStopped(null);
      if (!retry) setRuns([]);
      setProgress('');
      setStages(setStage(setStage(setStage(st, 'extracting', 'stopped', 'Not started: nothing was sent'), 'matching', 'not_run', 'Nothing to match'), 'checking', 'not_run', 'Nothing to check'));
      setBusy(false);
      return;
    }
    const next: Run[] = results.map((result) => ({ slot: used.find((u) => u.id === result.docId)!, result }));
    const sentSomething = next.some((r) => r.result.chunks.some((c) => c.status === 'ok'));
    const partsOk = next.reduce((n, r) => n + r.result.chunks.filter((c) => c.status === 'ok').length, 0);
    const partsAll = next.reduce((n, r) => n + r.result.chunks.length, 0);
    setRuns(next);
    setStopped(stoppedBy);
    setProgress('');
    // Nothing processed at all: keep showing what was shown (the sample set); the message explains why.
    if (!sentSomething) {
      setStages(setStage(setStage(setStage(st, 'extracting', 'stopped', `0 of ${partsAll} part(s) processed`), 'matching', 'not_run', 'Nothing to match'), 'checking', 'not_run', 'Nothing to check'));
      setBusy(false);
      return;
    }
    st = setStage(st, 'extracting', partsOk === partsAll ? 'done' : 'stopped', `${partsOk} of ${partsAll} part(s) processed`);
    // 3 and 4. Matching and checking run on this device, with the results below; shown in order as they happen.
    setStages(setStage(st, 'matching', 'active'));
    await tick();
    st = setStage(st, 'matching', 'done');
    setStages(setStage(st, 'checking', 'active'));
    await tick();
    onResult(buildLiveFixture(next.map((r) => ({ id: r.slot.id, role: r.slot.role, title: (parsed[r.slot.id] as Parsed).file.name, profile: r.slot.schemaId, result: r.result })), `live-upload-${analyses.current}`));
    await tick();
    setStages(setStage(st, 'checking', 'done'));
    setBusy(false);
  }

  const failed = runs.flatMap((r) => r.result.chunks.filter((c) => c.status !== 'ok').map((c) => ({ label: r.slot.label, c })));

  return (
    <details ref={panel} id="upload" className="no-print rounded border-2 border-sk-info bg-sk-surface p-4">
      <summary className="cursor-pointer">
        <h2 id={`${uid}-h`} className="inline text-xl font-semibold">
          Analyse your own documents
        </h2>
        <span className="ml-2 text-sm">(optional: sends extracted text to an AI service; limits and privacy inside)</span>
      </summary>
      <section aria-labelledby={`${uid}-h`} className="mt-3 space-y-3">
      <p className="text-sm">
        <strong>What leaves your device.</strong> Files are read on your device when you choose them. When you press Analyse, the <em>text extracted from them</em> is sent to an AI service for analysis. Not all processing is local. Do not analyse documents you are not allowed to share. The original files are never uploaded.
      </p>
      <p className="text-sm" data-testid="live-limits">
        <strong>Live analysis is limited.</strong> Text-layer PDFs only, up to {Math.round(MAX_FILE_BYTES / (1024 * 1024))} MB each. Each document is sent in short requests, one after another: a document needing more than {MAX_CHUNKS_PER_DOC} requests is refused as too long, a session sends at most {MAX_CALLS_PER_SESSION} requests, and nothing is retried automatically. It takes minutes, not seconds: one measured run of three 3-page documents took about 5 minutes (a single run, not a promise). Results cover only what was read; a part that failed is marked not processed. The sample sets above are the instant default and run the same checks on saved extractions.
      </p>
      {!configured && (
        <p role="note" className="rounded border border-sk-accent bg-sk-surface p-2 text-sm font-medium">
          Analysis is not available on this site yet: no analysis service is connected, and public access is closed until its limits are set. You can still choose files to see them read on your device, and the sample sets above work fully.
        </p>
      )}
      <div className="grid gap-3 md:grid-cols-3">
        {slots.map((s) => {
          const p = parsed[s.id];
          const inputId = `${idPrefix}-${s.id}`;
          return (
            <div key={s.id}>
              <label htmlFor={inputId} className="block text-sm font-medium">
                {s.label}
                {s.required ? '' : ' (optional)'}
              </label>
              <input id={inputId} type="file" accept="application/pdf,.pdf" disabled={busy} onChange={(e) => void choose(s, e.target.files?.[0])} aria-describedby={`${inputId}-s`} className="w-full text-sm" />
              <p id={`${inputId}-s`} className="text-sm" aria-live="polite">
                {!p ? 'No file chosen.' : 'error' in p ? <span className="font-medium text-sk-danger">{p.error}</span> : `Read on your device: ${p.blocks.length} text lines on ${Math.max(...p.blocks.map((b) => b.page ?? 1))} page(s).`}
              </p>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => void analyse(false)} disabled={!ready || busy || !configured} className="rounded bg-sk-text px-4 py-2 font-medium text-sk-bg disabled:bg-sk-muted disabled:opacity-70">
          Analyse (sends extracted text)
        </button>
        {busy && (
          <span aria-live="polite">
            Analysing… {progress}
          </span>
        )}
      </div>
      {refusal && (
        <p role="alert" data-run-refused="" className="rounded border-2 border-sk-danger bg-sk-surface p-2 font-medium">
          {refusalText(refusal)}
        </p>
      )}
      {stages && <ProgressView stages={stages} />}
      {runs.length > 0 && (
        <div aria-live="polite" className="space-y-2">
          <h3 className="font-medium">Result of the last analysis</h3>
          <ul className="space-y-1">
            {runs.map((r) => {
              const bad = r.result.chunks.filter((c) => c.status !== 'ok').length;
              return (
                <li key={r.slot.id}>
                  {r.slot.label}: {r.result.chunks.length - bad} of {r.result.chunks.length} part(s) processed{' '}
                  {bad === 0 ? <StatusBadge kind="validated" label="Fully processed" /> : <StatusBadge kind="needs_review" label="Not fully processed: nothing can be called missing from it" />}
                </li>
              );
            })}
          </ul>
          {stopped && (
            <p role="alert" className="rounded border border-sk-danger bg-sk-surface p-2 font-medium">
              {ERROR_TEXT[stopped].text}
            </p>
          )}
          {failed.length > 0 && (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm">{failed.length} part(s) were not processed.</span>
              <button type="button" onClick={() => void analyse(true)} disabled={busy || !configured} className="rounded border border-sk-border px-3 py-1">
                Try the failed parts again
              </button>
            </div>
          )}
        </div>
      )}
      </section>
    </details>
  );
}
