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
  state: 'confirmed' | 'needs_review'; basis: 'presence'|'absence'; fingerprint: string;
  evidence: Evidence[]; requirementRef?: Evidence; examined?: { docId: string; fullyProcessed: boolean }[];
  message: string };

type ReviewDecision = { findingId: string; fingerprint: string; status: 'open'|'accepted'|'dismissed';
  note?: string; history: {status:string; note?:string; fingerprint:string; at:number}[] };
```

### Finding identity and reopening (R7.4)
`Finding.id` = hash(ruleId, comparison context, subject, response document). The same item missing from two response documents therefore gives two findings with independent reviews. `fingerprint` = hash of rule version, code, state, basis, reason, match status, effective inputs (value, provenance, validation status and reason, evidence offsets), evidence excerpts and roles, and each document's processing and coverage state. A stored decision applies only if its fingerprint equals the finding's current one; otherwise the finding reopens as `open`, the old decision and note go to `history`, and `reopened` is set. A finding that disappears keeps its history; one that reappears starts `open`.

### User-supplied values
A Correction never mutates the Fact. The effective value is labelled `user_supplied`; finding inputs carry `provenance`, the corrected `value` and the `originalValue`; the original evidence is kept with role `superseded_original` (it must not be shown as support for the corrected value). Findings list `userSuppliedFactIds`, and exports mark them.

## 3. Validation pipeline (R4)

1. **Schema**: Zod parse of model output; failure → one repair retry for that chunk, then recoverable error (R5.4).
2. **Evidence check**: each cited excerpt must be found in the cited Block after normalising case, whitespace runs, typographic dashes/quotes and line-break hyphenation. Normalisation keeps a character map, so offsets index the ORIGINAL block text and the stored excerpt equals `block.text.slice(start, end)` (checked by `isEvidenceIntact`). Offsets are never taken from the model. Fail → `needs_review` (`block_missing`, `excerpt_not_found`). An excerpt occurring more than once in its block is `needs_review` (`excerpt_ambiguous_location`).
3. **Value support check** (`ValueSupportValidator`, typed per field kind, in engine; domain Adapters register kinds):
   - `money`: parse currency symbol/code, number and magnitude words ("R1.6 million", "1 600 000 ZAR") from the excerpt into decimal + ISO currency; must equal the model's value. Ambiguous symbols (e.g. bare `$`) → currency unknown → `needs_review`.
   - `date`: parse day/month/year forms; ambiguous numeric formats (01/02/2026) → `needs_review`.
   - `quantity`/`unit`: number parsed from the excerpt; unit must appear in the excerpt else `null`.
   - `name`: the claimed name's tokens must appear as a contiguous run in the excerpt. Name comparison ignores only case, punctuation, spacing and "&"/"and"; legal-form-only differences are reported separately (`legal_form_differs`); any other difference (e.g. Trust vs Foundation, Holdings vs Holding) is `different`.
   - Where an excerpt holds several plausible amounts, dates or numbers, the app adapter's field label (hint) must precede exactly one candidate; otherwise `needs_review` (`multiple_candidates_no_context` / `ambiguous_candidates`). Ambiguous numeric dates (01/02/2026), decimal commas and bare `$` stay `needs_review`. The resolved value is parsed from the excerpt by code.
   - `text/spec`: excerpt must contain the claimed spec tokens.
   Fail → `needs_review` with reason; the value is not used by confirmed rules.
4. **Processing versus coverage**: *processing complete* = every chunk succeeded and every Block was offered to extraction. *Coverage* = the extraction is known to have found every item; it is `unverified` by default and becomes `verified` (deterministic check) or `user_confirmed` only on an explicit action, and only for a fully processed document. A successful run can still miss a line, so an unmatched item is `needs_review` (`processing_incomplete` / `coverage_unverified`) until coverage is verified or confirmed. `uncoveredBlocks` lists blocks no fact cites, to guide that confirmation. The rule runner also downgrades any confirmed absence finding whose coverage snapshot is not complete and verified (R2.7, R3.7).

## 4. Matching and rules

- **Matcher** (generic): candidates carry `score`, `source`, optional adapter `keyAgreement` and `userDecision`. A match is `verified` only by user confirmation or key agreement; a score at or above the heuristic threshold (initially 0.7, calibrated from benchmark fixtures) gives only `suggested`; several plausible targets give `ambiguous`; otherwise `none`. Suggested and ambiguous matches stay reviewable and never support a confirmed finding or an absence conclusion. Resolution is per subject, response document and context, and is order-independent (R5.6).
- **Rule interface**: `Rule<Ctx> = { id; run(ctx): Finding[] }` where `ctx` exposes effective Facts, matches and document completeness. Adapters supply the rule set. All arithmetic uses decimal.js (R6.1). Currency mismatch → no numeric comparison (R6.5).
- **ScopeCheck rules (M1/M3):** quantity mismatch, spec difference, exclusion (unpriced preserved), omission (cites RFQ requirement + names quote examined). Later (M5): delivery lead time and Incoterm differences; changed payment terms; missing or shorter warranty coverage; arithmetic inconsistencies where quantities, prices, discounts, tax and rounding give a clear basis. Unclear terms or no stated basis → `needs_review` / no finding (R6.2–6.3).
- **PackCheck grant rules** (cross-file equivalent-field checks are primary; the funding-exceeds-budget rule is additional and does not replace them):
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

`POST /extract` with JSON `{schemaId, blocks:[{id,text}]}`, validated strictly: unknown keys (filenames, prompts, model names, token limits) are rejected. The client only picks a `schemaId` from a server allowlist of **extraction profiles** (`src/profiles.ts`). Each profile fixes the model, output token cap, instructions, field list and JSON schema. Document text is sent as JSON data in the user message; the system message says it is untrusted and to ignore instructions inside it. Model output is validated again server-side: fields outside the profile and block IDs that were not sent are dropped (counted in `meta.dropped`), and value shapes are checked per kind. The client still performs evidence and value-support validation (§3).

Checks run in this order, each with a distinct error code and no echo of input, and the first five never touch the counter or model:
1. **Path and origin**: only `/extract`. `Origin` must be in the exact allowlist, else 403 `origin_denied` (an additional control, not authentication; non-browser clients can spoof it). Preflight (`OPTIONS`) from an allowed origin returns 204 without calling anything.
2. **Configuration**: all limits and the daily ceiling must parse within hard caps, else 503 `not_configured` (fail closed). The ceiling has no default.
3. **Body size on actual bytes**: the stream is counted as it is read and cancelled at `MAX_BODY_BYTES`; `Content-Length` is only an early hint (R8.6) → 413 `too_large`.
4. **Shape and size**: strict schema, unique block IDs, `MAX_BLOCKS`, `MAX_BLOCK_CHARS`, `MAX_CHARS` → 400 `invalid_input` / 413 `too_large`. Unknown `schemaId` → 400.
5. **Optional per-client limiter** (Rate Limiting binding, per-location, eventually consistent) → 429 `rate_limited`. The strict global ceiling does not depend on it.
6. **Admission (strict, global)**: a SQLite-backed Durable Object keeps one integer per UTC day (no text, filenames or client data). `admit(ceiling, now)` runs synchronously inside a storage transaction, so concurrent requests cannot exceed the ceiling; the count persists across restarts and a new UTC day starts at 00:00:00.000Z. **Every inference attempt, including a repair attempt, is admitted before the model is called.** There is no refund: a failed or timed-out call may still have consumed inference. If the counter call fails the request is refused (503 `limiter_unavailable`); it is never bypassed. Over the ceiling → 429 `daily_limit` with `Retry-After` to the next 00:00 UTC.
7. **Model call**: Workers AI JSON mode, profile `max_tokens`, fixed timeout (504 `timeout`), no automatic retry. Invalid output allows at most `MAX_REPAIR_ATTEMPTS` (server-set, cap 1) repair attempt, each admitted first; then 502 `schema_invalid`. Daily free quota errors → 503 `quota_exhausted`; other upstream failures → 503 `model_unavailable`. Upstream messages are used for classification only and never returned.

**Ceiling and limits come from the benchmark.** `DAILY_ADMISSION_CEILING` ships as `0` (closed). A request count does not equal neuron use (depends on model, input and output size), so the ceiling, `MAX_CHARS`, `MAX_BLOCKS` and the profile token caps are set together from measured neurons per call against the 10,000/day allowance, with margin for repairs and timeouts. Response `meta.usage` reports tokens when the model supplies them, to support that measurement.

Logs: status, code, block and character counts, attempts and elapsed ms only (R8.4). No AI Gateway caching, KV or R2 (R8.5).

### Client bounds (R8.8)
`MAX_CHUNKS_PER_DOC` (initial 8), `MAX_CALLS_PER_SESSION` (initial 30), no client-side repair (the Worker's single counted repair is the only one), no auto-retry on 429/503/504: UI shows a banner with a manual "Try again" and keeps already-extracted documents. No silent fallback to cache or partial findings; the sample path is a separate, explicit, labelled mode (R9).

Errors: `invalid_input`, `too_large`, `origin_denied`, `rate_limited`, `daily_limit`, `quota_exhausted`, `model_unavailable`, `timeout`, `schema_invalid`, `limiter_unavailable`, `not_configured`. The UI treats all but `invalid_input`, `origin_denied` and `not_configured` as recoverable. The one repair retry lives in the Worker (counted), so the client does not repair on its own.

## 7. UI, review and export

- **Shared review model**: each Finding and Needs-review item has status (open/accepted/dismissed), note, and visible history. Status uses text and icon plus colour (R13.2).
- **Evidence viewer**: shows the extracted block text with the validated span highlighted and page/ref; PDF page preview is optional.
- **Corrections**: editing a Fact stores a Correction, shows "user-supplied", shows the original value and evidence, reruns rules, reopens changed findings (R7.4).
- **Export model** (engine, format-agnostic): sections `Findings`, `Needs review (unresolved)`, `User decisions`, `Corrections`, `Notes`, each item marked with state. A further section, `Not evaluated`, lists every planned comparison that could not run, with its reason and blocked input (R4.9, R7.6). The review panel shows the same three groups: confirmed findings, Needs review (including rejected critical fields), and Not evaluated. A comparison ledger (planned / agree / flagged / not evaluated) is produced alongside the findings so absence of a finding is never read as a pass; the benchmark already records it (`samples[].comparisons`). Renderers: CSV, plain text, print/PDF (R7.5). Sample-path runs are marked "SAMPLE (fictional)".
- **Accessibility** (R13): semantic HTML, focus-visible styles, keyboard-operable tables and dialogs, AA-contrast Tailwind tokens, `motion-reduce:` variants; Playwright + axe checks on key pages.
- **Mode banner**: every analysis shows "Fixture/Sample" or "Live: extracted text sent to AI service" (R8.3, R9.2).

## 8. Live-extraction benchmark (R10.1–10.2)

`tools/benchmark` runs the real path on labelled fictional samples (`samples/scopecheck`, `samples/packcheck`: text PDFs, a manifest of expected facts per line, and expected findings). Path: `packages/ingest` (PDF.js blocks with pages and coordinates) → `chunkBlocks` → the real Worker request handler → model → `validateClaims` (evidence + value support) → benchmark-local checks built from engine primitives (promoted to app adapters in Task 6) → scoring. Extraction, matching/rules and findings are scored separately.

- **Modes:** `mock` uses an oracle model built from the labels with injectable defects (missed line, unsupported value, unknown block, bad JSON, model failure). It tests the harness and pipeline only; its output says nothing about model quality, is labelled MOCK, uses synthetic token counts, and is not committed. `live` calls Workers AI through the Cloudflare REST API from the sandbox (one allowed host, `api.cloudflare.com`), through the same handler and the same `admit()` code over a local SQLite file. It does not exercise the Workers binding or the deployed Durable Object; that is validated at deployment.
- **Hard bounds in live mode:** `--max-attempts N` is both a client budget and the local admission ceiling for the run (attempts already used today plus N), so repairs and timeouts count and cannot exceed it. `--doc` is required. Estimated neurons used today are tracked locally and a self-imposed budget (default 8,000 of 10,000) stops further runs. Credentials are read only from the environment and are never printed or stored.
- **Profiles are versioned and frozen.** A behaviour change is a new profile ID (`packcheck.grant.v2` clarifies money magnitude); published versions keep their text so earlier results stay reproducible. Each result records the profile version per document.
- **Item identity** (`apps/scopecheck/src/adapter/identity.ts`) is the single resolver used by the benchmark and by the ScopeCheck adapter: it recovers an item code the model omitted only when the source segment ties exactly one code to the item, and leaves any other case description-only or uncertain (Needs review).
- **Coverage:** a successful request never establishes coverage. Every document stays `unverified`; absences remain Needs review. `--simulate-coverage` exists only to measure what confirmed absences would look like and is labelled SIMULATED in the output.
- **Extraction issues:** rejected claims (excerpt or value unsupported), ambiguous values, claims the Worker dropped (`unknown_block`, `unknown_field`, `invalid_value`, reported by reason), failed chunks, oversized and unprocessed blocks are all listed per document. None of them is silent.
- **Reported:** requests, schema-valid rate, repaired requests, latency, claims received, evidence-located rate, value-supported rate, recall and validated precision against labels, missed and unsupported facts, false critical findings, over-confident findings, missed findings, must-not-flag violations, and usage.
- **Usage honesty:** token counts are *measured* only when the model reports them. Neurons are an *estimate* derived from tokens at approximate published rates, unless the user supplies a dashboard figure (`--measured-neurons`), which is labelled as such. Per-request neuron counts are not returned by the API.
- **Decision rule:** choose the cheapest model meeting thresholds set after the first run; set `DAILY_ADMISSION_CEILING`, `MAX_CHARS`, `MAX_BLOCKS` and token caps from measured neurons per call. If none pass, simplify document scope and rerun. Live runs are manual (not CI).

## 9. Testing strategy
- Vitest: engine units, validators (table-driven for money/date/name edge cases incl. "R1.6 million"), rules, golden fixtures, property tests (fast-check), Worker handler tests for every limit and error code (R8.11), boundary test.
- Playwright: both apps on fixture path (labelled), keyboard-only flow, export contents, banner on quota error with a mocked Worker.
- Live checks: benchmark script only.
- CI (GitHub Actions): install, lint, typecheck, Vitest, build both apps.

## 10. Deployment
Two Cloudflare Pages projects (build commands per app, output `apps/*/dist`) and one Worker. Config values (origins, limits) in `wrangler.toml` vars. No secrets in the client. Cost watch: Pages 500 builds/month, Workers 100k requests/day, Workers AI 10k neurons/day; the AI quota depends on measured neuron use per request and on bounded input and output sizes (§6, §8); the request ceiling is only one control and is set from benchmark results.

## 11. Open design assumptions
- SQLite-backed Durable Objects are documented as available on Workers Free and the counter is the strict global control. The Rate Limiting binding is optional and unverified on the free plan; the system works without it. If the counter is unavailable the endpoint stays closed.
- Initial numeric limits are placeholders to be tuned by the benchmark.
- Build Brief text is still missing; M5 checks (delivery, payment, warranty) will need its definitions.
