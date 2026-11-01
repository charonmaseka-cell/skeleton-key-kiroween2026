# Design: Skeleton Key Foundation

Implements `requirements.md`. Requirement IDs (R#.#) are cited inline.

## 1. Architecture

```
Browser (per app, in-memory session)
  File -> Parser (PDF.js) -> Blocks
  Blocks -> Chunker -> ExtractionClient --HTTPS--> Worker (limits, origin check) -> Workers AI
  Model JSON -> Zod -> EvidenceValidator -> ValueSupportValidator -> validated Facts
  Facts + Corrections + Match decisions -> Matcher -> Rules (via Adapter) -> Findings
  Findings + ReviewState -> UI / Exports
```

Only the Worker call leaves the device, and only after the user presses Analyse (R8.1–8.3). Parsing, validation, matching, rules, review and export are local and model-independent (R5.7).

### Packages
| Path | Responsibility |
| --- | --- |
| `packages/engine` | Types, Zod schemas, chunker, validators, matcher, rule runner, review state, export model, provider interface. No app imports (R1.3). |
| `packages/ui` | Shared components: evidence viewer, status badge, review panel, file drop, quota/error banner (R1.5, R13). |
| `apps/scopecheck` | ScopeCheck Adapter (schemas, prompts, rules), pages. |
| `apps/packcheck` | PackCheck grant Adapter (schemas, prompts, rules), pages. |
| `services/extraction-api` | Worker: validation, limits, Workers AI call. Holds no domain logic beyond a generic "extract by schema" prompt template supplied by the client Adapter. |
| `tools/benchmark` | Node script for the live-extraction benchmark (R10.1). Dev-only. |

Boundary enforcement (R1.3): a Vitest test scans `packages/engine/src` for imports matching `apps/` and for a deny-list of domain words (e.g. `quote`, `rfq`, `grant`, `attachment`), plus an ESLint `no-restricted-imports` rule.

## 2. Core data model (engine)

```ts
type Block = { id: string; docId: string; kind: 'pdf-run'|'docx-para'|'docx-cell';
  text: string; page?: number; bbox?: [number,number,number,number]; // PDF only
  ref?: string };                                                    // DOCX para/cell ref only

type Evidence = { docId: string; blockId: string; start: number; end: number; text: string };

type FactStatus = 'validated' | 'needs_review' | 'user_supplied';
type Fact<T = unknown> = { id: string; docId: string; field: string; raw: string;
  value: T | null;            // null = unknown, never defaulted (R6.4)
  evidence: Evidence[]; status: FactStatus; reason?: string };

type Correction = { factId: string; original: Fact; correctedValue: unknown; note?: string; at: number };
// Original Fact + Evidence are never mutated (R4.8). Effective value = latest Correction ?? Fact.

type Finding = { id: string; ruleId: string; severity: 'critical'|'warning'|'info';
  state: 'confirmed' | 'needs_review'; inputsFingerprint: string;
  evidence: Evidence[]; requirementRef?: Evidence; examined?: { docId: string; fullyProcessed: boolean }[];
  message: string };

type ReviewDecision = { findingId: string; fingerprint: string; status: 'open'|'accepted'|'dismissed';
  note?: string; history: {status:string; note?:string; fingerprint:string; at:number}[] };
```

### Finding identity and reopening (R7.4)
`Finding.id` = hash(ruleId + sorted input Fact IDs). `inputsFingerprint` = hash of the effective values (incl. Corrections) and match decisions it used. When rules rerun, a stored decision applies only if its `fingerprint` equals the finding's current one; otherwise the decision is pushed to `history` and status resets to `open`. A finding that disappears keeps its history; one that reappears starts `open`.

## 3. Validation pipeline (R4)

1. **Schema**: Zod parse of model output; failure → one repair retry for that chunk, then recoverable error (R5.4).
2. **Evidence check**: each cited excerpt must be found, after whitespace/hyphen normalisation, inside the cited Block; offsets are recomputed by code, never taken from the model. Fail → Fact discarded and recorded as `needs_review` (reason `evidence_not_found`).
3. **Value support check** (`ValueSupportValidator`, typed per field kind, in engine; domain Adapters register kinds):
   - `money`: parse currency symbol/code, number and magnitude words ("R1.6 million", "1 600 000 ZAR") from the excerpt into decimal + ISO currency; must equal the model's value. Ambiguous symbols (e.g. bare `$`) → currency unknown → `needs_review`.
   - `date`: parse day/month/year forms; ambiguous numeric formats (01/02/2026) → `needs_review`.
   - `quantity`/`unit`: number parsed from the excerpt; unit must appear in the excerpt else `null`.
   - `name`: normalised (case, punctuation, legal suffix) string must appear in the excerpt.
   - `text/spec`: excerpt must contain the claimed spec tokens.
   Fail → `needs_review` with reason; the value is not used by confirmed rules.
4. **Completeness**: a document is `fullyProcessed` only if every chunk succeeded and every Block was offered to extraction. Otherwise rules that need absence conclusions emit `needs_review` (R2.7, R3.7).

## 4. Matching and rules

- **Matcher** (generic): candidate pairs from model suggestions plus a deterministic lexical score. Each pair has `score`, `source`, `decision: auto|needs_review|user_confirmed|user_rejected`. Initial heuristic threshold 0.7 is a config value, shown only as "suggested match", never a probability (R5.6); calibrated from benchmark fixtures.
- **Rule interface**: `Rule<Ctx> = { id; run(ctx): Finding[] }` where `ctx` exposes effective Facts, matches and document completeness. Adapters supply the rule set. All arithmetic uses decimal.js (R6.1). Currency mismatch → no numeric comparison (R6.5).
- **ScopeCheck rules (M1/M3):** quantity mismatch, spec difference, exclusion (unpriced preserved), omission (cites RFQ requirement + names quote examined). Later (M5): delivery, payment, warranty, arithmetic with stated discount/rounding/tax/pack basis; no stated basis → no finding (R6.2–6.3).
- **PackCheck grant rules:**
  - `attachment-missing`: required attachment with no mapped file, cites the requirement, lists files examined (R3.2).
  - `org-name-consistent`: equivalent field across documents; normalised compare; differing → finding, missing/ambiguous → needs_review.
  - `currency-consistent`, `dates-consistent` (start ≤ end; same dates across docs where repeated).
  - `funding-vs-budget`: funding requested and total budget are NOT compared for equality (R3.5). Emits only if both validated, same currency, and funding > budget.
  - `funding-equivalent-fields`: compares funding requested in form vs. budget summary (equivalent fields only).
- Property tests (R10.8) target the engine runner using a tiny generic test Adapter plus both real Adapters.

## 5. Document ingestion

- **PDF**: PDF.js text content → one Block per text run grouped by line; keep page and bbox. A page with no text layer triggers an explicit "scanned PDF not supported" error (R10.9). Blocks are display aids, not "original lines" (R4.7); UI labels extracted text as such.
- **DOCX (M5)**: Mammoth raw text, paragraph and table-cell refs only; no HTML insertion; no page numbers.
- **Chunker**: groups Blocks by page order up to a character budget derived from the model context (initial budget set by benchmark). Each chunk request carries Block IDs so the model cites IDs.
- **Session store**: in-memory map `docId -> {blocks, facts, extractionStatus}`; extraction is reused until the file changes or the user retries (R5.2). Corrections trigger `runRules()` only (R5.3).

## 6. Extraction Worker (R8)

`POST /extract` JSON `{schemaId, blocks:[{id,text}], docKind}`; no filenames are accepted or logged.

Enforced server-side, in order (each returns a distinct JSON error code with no input echo):
1. **Origin allowlist**: `Origin` must match configured Pages origins, else 403 (R8.9).
2. **Body size**: reject if `Content-Length` or read length > `MAX_BODY_BYTES` (initial 64 KB), 413 (R8.6).
3. **Text length**: sum of block text > `MAX_CHARS` (initial 24,000, tuned by benchmark) or blocks > `MAX_BLOCKS`, 413.
4. **Per-client limit**: Workers Rate Limiting binding keyed by client IP (periods only 10 or 60 s; initial 6 per 60 s). Counters are per-location and eventually consistent, so it is abuse mitigation, not exact; free-plan availability is **to verify in task 3.1** (R8.7).
5. **Global daily ceiling**: a Durable Object (SQLite-backed, free-plan eligible; verify) counts requests per UTC day, ceiling set below the Workers AI neuron budget (initial 200 calls/day; tuned by benchmark) → 429 `daily_limit` (R8.7).
6. **Model call**: Workers AI with JSON mode, `max_tokens` capped, a fixed timeout, **no retry in the Worker**. Quota/capacity errors are mapped to 503 `quota_exhausted` (R8.10).
Logs: only status code, error code, and counts (no content, no filenames) (R8.4). No AI Gateway caching, no KV/R2 for content (R8.5).

### Client bounds (R8.8)
`MAX_CHUNKS_PER_DOC` (initial 8), `MAX_CALLS_PER_SESSION` (initial 30), one repair retry per chunk, no auto-retry on 429/503: UI shows a banner with a manual "Try again" and keeps already-extracted documents. No silent fallback to cache or partial findings; the sample path is a separate, explicit, labelled mode (R9).

Errors: `schema_invalid`, `rate_limited`, `daily_limit`, `quota_exhausted`, `too_large`, `origin_denied`, `model_unavailable`. All recoverable in UI.

## 7. UI, review and export

- **Shared review model**: each Finding and Needs-review item has status (open/accepted/dismissed), note, and visible history. Status uses text and icon plus colour (R13.2).
- **Evidence viewer**: shows the extracted block text with the validated span highlighted and page/ref; PDF page preview is optional.
- **Corrections**: editing a Fact stores a Correction, shows "user-supplied", shows the original value and evidence, reruns rules, reopens changed findings (R7.4).
- **Export model** (engine, format-agnostic): sections `Findings`, `Needs review (unresolved)`, `User decisions`, `Corrections`, `Notes`, each item marked with state. Renderers: CSV, plain text, print/PDF (R7.5). Sample-path runs are marked "SAMPLE (fictional)".
- **Accessibility** (R13): semantic HTML, focus-visible styles, keyboard-operable tables and dialogs, AA-contrast Tailwind tokens, `motion-reduce:` variants; Playwright + axe checks on key pages.
- **Mode banner**: every analysis shows "Fixture/Sample" or "Live: extracted text sent to AI service" (R8.3, R9.2).

## 8. Live-extraction benchmark (R10.1–10.2)

`tools/benchmark` runs the real path on the fictional RFQ + 2 quotes and the grant pack (generated as text PDFs in `samples/`), against a local `wrangler dev` Worker with the real Workers AI binding (or the deployed Worker). Per document and per candidate model it reports: requests, chunks, elapsed ms, neurons/tokens (from response metadata if available, else estimate flagged as such), schema-valid %, evidence-valid %, value-supported %, and field-level recall against expected outputs. Output goes to `samples/*/benchmark-results.json` (no confidential data) and a short summary in `docs/build-log.md`. Candidate models: `@cf/meta/llama-3.3-70b-instruct-fp8-fast` and one smaller model. Decision rule: choose the cheapest model meeting the thresholds the team sets after the first run; if none pass, simplify document scope and rerun. Runs only on request (not in CI); needs developer Cloudflare credentials.

## 9. Testing strategy
- Vitest: engine units, validators (table-driven for money/date/name edge cases incl. "R1.6 million"), rules, golden fixtures, property tests (fast-check), Worker handler tests for every limit and error code (R8.11), boundary test.
- Playwright: both apps on fixture path (labelled), keyboard-only flow, export contents, banner on quota error with a mocked Worker.
- Live checks: benchmark script only.
- CI (GitHub Actions): install, lint, typecheck, Vitest, build both apps.

## 10. Deployment
Two Cloudflare Pages projects (build commands per app, output `apps/*/dist`) and one Worker. Config values (origins, limits) in `wrangler.toml` vars. No secrets in the client. Cost watch: Pages 500 builds/month, Workers 100k requests/day, Workers AI 10k neurons/day; ceiling in §6.5 protects the AI quota.

## 11. Open design assumptions
- Rate Limiting binding and SQLite Durable Objects must be confirmed usable on the free plan in task 3.1; fallback is the stricter Durable Object-only limiter, and if neither is available the endpoint stays closed to the public (local/dev only) until a limiter exists.
- Initial numeric limits are placeholders to be tuned by the benchmark.
- Build Brief text is still missing; M5 checks (delivery, payment, warranty) will need its definitions.
