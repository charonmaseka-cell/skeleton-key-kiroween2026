# ScopeCheck Build Brief

Reference copy of the original brief dated 1 November 2026. Source paragraphs and tables are retained; the two diagrams are transcribed as text. Later approved amendments take precedence over superseded proposals.

Nov 1, 2026 · @Charon

## Summary

ScopeCheck checks supplier quotes against the RFQ they answer, and shows the source of every gap. A buyer uploads one RFQ and two or more quotes; within a minute they see missing line items, specification mismatches, unclear pricing and conflicting commercial terms, each linked to the exact page and line in both documents.

It is the first of two apps built on Skeleton Key, a lean open-source engine for checking a set of documents against a set of requirements. The second app, PackCheck, follows in week 4 to prove the template is reusable.

One-line pitch: Stop finding out at delivery that the cheapest quote left something out.

## Hackathon fit

We enter Skeleton Crew: build a lean code template, then show two different apps built from it. Skeleton Key is the template; ScopeCheck and PackCheck are the two apps.

Rules that shape the build:

| Requirement | What it means for us |
| --- | --- |
| Public, open-source repo | MIT licence, all source, sample documents and setup instructions in the repo. Nothing from Akanya's codebase. |
| Substantial Kiro use | Kiro writes most of the code from specs. The .kiro folder (specs, steering, hooks) is committed at the repo root. |
| Newly built in the submission period | Fresh repo created after 1 November 2026. Frameworks and libraries are fine; any pre-existing work is disclosed. |
| Working app URL | Live until judging ends on 29 January 2027. |
| Demo video | Public YouTube, under 3 minutes. |
| Write-ups | Project description plus how Kiro was used. |

Key dates (SAST):

- Request free Kiro credits early; requests close 1 December at 22:00.
- Submission deadline: Saturday 5 December 2026 at 00:00 (Friday 4 December, 14:00 PT).

We also apply for the Best Startup Project bonus, if the organisers accept the startup profile.

## Problem and users

Buyers compare quotes by hand, and the cheapest quote often wins because it quietly excludes something. Quotes arrive as PDFs in different layouts, with unit prices in different units, payment terms buried in footers, and exclusions phrased as assumptions. Procurement practitioners on Reddit describe exactly this manual cross-checking.

Primary user: a buyer or project engineer at a small to mid-sized industrial company, comparing two to five quotes for equipment, spares or services. They know what they asked for but lack time to re-read every quote line by line.

Secondary user: a supplier checking their own quote before sending it.

The job to be done: before awarding, know which quote actually covers the scope, and what each one excludes or changes.

## Scope

The MVP does one comparison end to end, very well: one RFQ against two to five quotes.

In:

- Upload text-based PDFs and DOCX files (one RFQ, two to five quotes).
- Extract RFQ requirements: line items, quantities, units, specifications, delivery, payment and warranty terms.
- Extract each quote's offered items, prices and terms.
- Match quote lines to RFQ lines, with a confidence score and the reason for each match.
- Raise findings by type and severity, each with side-by-side source evidence.
- Comparison matrix: RFQ lines as rows, quotes as columns, status in each cell.
- Buyer can accept, dismiss or annotate any finding.
- Export a findings report (PDF) and a clarification list to send each supplier.
- Three built-in sample sets so judges can try it without their own documents.

Out (post-hackathon):

- Scanned PDFs and OCR.
- Excel quotes and price-list imports.
- Currency conversion and landed-cost calculation.
- User accounts, teams and history. The MVP runs per session.
- ERP or e-procurement integrations.
- Award recommendations. ScopeCheck shows the evidence; the buyer decides.

## User flow and core screens

The whole flow takes under a minute on sample data, which is what the demo video shows.

1. Summon (upload). Drop in the RFQ and the quotes, or pick a sample set. Each file is labelled as RFQ or quote, with the supplier name detected.
2. Ritual (processing). A progress view shows each stage: reading, extracting requirements, matching, checking. Requirements appear as they are found.
3. Séance (results). The main screen, in three panels:
   - Left: findings list, filterable by severity, type and supplier.
   - Centre: comparison matrix of RFQ lines against quotes.
   - Right: evidence pane showing the RFQ excerpt and the quote excerpt side by side, with the relevant words highlighted.
4. Exorcise (review). The buyer accepts, dismisses or annotates findings. Dismissed findings fade but stay recoverable.
5. Testament (export). Download the findings report and a clarification email draft per supplier.

Every screen must work by keyboard, meet WCAG AA contrast, and offer a "lights on" toggle that turns off atmospheric effects.

## Architecture

Skeleton Key holds everything generic; each app adds only its schema, rules and vocabulary. That split is what makes the Skeleton Crew entry credible.

Architecture diagram transcription:

Both apps plug into one shared engine. Each app supplies a schema, rules and vocabulary.

| App | Responsibilities in the original diagram |
| --- | --- |
| ScopeCheck build now | Procurement schema, 11 finding rules; 3 sample sets, clarification export |
| PackCheck week 4 | Application schema and its own rules; 1 sample set, same screens |

Both apps supply schema and rules to the Skeleton Key engine shared template.

| Engine stage | Responsibility in the original diagram |
| --- | --- |
| Ingest | PDF, DOCX to text and pages |
| Extract | LLM pulls items and terms |
| Match | Pair lines, score 0 to 1 |
| Check | Coded rules raise findings |
| Evidence | Cite page and excerpt |

Findings and evidence feed the shared Haunted UI layer: findings list, comparison matrix, evidence pane, lights-on toggle and report export.

Skeleton Key architecture · 2 apps, 5 engine stages, 1 UI layer

The language model is used only in Extract and to suggest matches; Check is plain code, so findings are repeatable.

Core data model:

| Object | Key fields |
| --- | --- |
| Document | id, role (requirement or response), party name, pages |
| Requirement | id, document, item, quantity, unit, specs, terms, source span |
| Offer | id, document, item, quantity, unit, unit price, line total, specs, terms, source span |
| Match | requirement, offer, confidence, reason |
| Finding | type, severity, requirement, offer, evidence spans, status (open, accepted, dismissed), note |

Proposed stack: Next.js and TypeScript, a hosted LLM API with structured JSON output, pdf.js and mammoth for parsing, Zod for schemas, Vitest and Playwright for tests, deployed on Vercel.

## Check rules and findings

The AI extracts and matches; deterministic rules decide what counts as a finding. Each finding must cite at least one source excerpt, or it is not shown.

| Finding (theme name) | What triggers it | Default severity |
| --- | --- | --- |
| Missing item (Ghost) | An RFQ line has no matching quote line | Critical |
| Spec mismatch (Possessed) | Matched line differs on a stated spec: rating, material, standard, size, model | Critical |
| Quantity short or over (Wrong count) | Offered quantity differs from RFQ quantity | High |
| Unit ambiguity (Shapeshifter) | Unit missing, or differs from RFQ (each vs box, m vs roll) | High |
| Exclusion or assumption (Curse) | Quote text excludes scope or adds a condition | High |
| Delivery conflict (Late arrival) | Lead time or Incoterm differs from the RFQ | Medium |
| Payment term change (Blood price) | Payment terms differ from the RFQ | Medium |
| Warranty gap (Short life) | Warranty missing or shorter than required | Medium |
| Price inconsistency (Phantom maths) | Line total does not equal quantity × unit price, or totals don't add up | High |
| Unrequested extra (Stowaway) | Quote line with no matching RFQ line | Low |
| Validity expiry (Fading) | Quote validity ends before the planned award date | Low |

Match confidence below 0.7 is shown as "uncertain" and asks the buyer to confirm the match, rather than raising a confident finding.

Arithmetic and unit checks run in plain code, never in the model.

## Haunted design layer

The theme makes findings easier to notice; it never hides information or slows the buyer down.

- Visual identity: a dark, inky "after-hours procurement office" palette with one ectoplasm-green accent for findings. Clean sans-serif for data; a restrained serif for headings.
- Ghost rows: missing items appear in the matrix as translucent rows that flicker once, then settle. Clicking one solidifies it and opens the evidence.
- Possessed cells: spec mismatches get a subtle distortion on hover, and the evidence pane highlights the two conflicting phrases.
- Séance summary: the results header reads like a medium's verdict, e.g. "3 ghosts and 2 curses found in Supplier B's quote", with plain counts beside it.
- Sound: optional, off by default.
- Lights on: one toggle removes animation and atmosphere, respecting reduced-motion settings automatically.

The theme lives in Skeleton Key's UI layer, so PackCheck inherits it with its own vocabulary.

## Kiro usage plan

Kiro does the building; this plan makes its contribution visible to judges. Everything below lives in .kiro/ at the repo root.

Specs (requirements, design and tasks for each):

- skeleton-key-engine: ingestion, extraction, matching, rules, evidence.
- scopecheck-app: procurement schema, findings rules, screens, export.
- packcheck-app: written in week 4 against the same engine, showing reuse.
- haunted-ui: theme tokens, components, accessibility rules.

Steering files:

- product.md: users, scope, and the rule that every finding cites a source.
- tech.md: stack, folder layout, coding conventions.
- domain-procurement.md: RFQ and quote vocabulary, units, Incoterms, payment terms.
- theme.md: tone of copy and the haunted vocabulary.

Hooks:

- On save in engine/: run unit tests for the touched module.
- On change to a rule: re-run the golden sample sets and report any changed findings.
- On new component: check keyboard access and contrast.
- Before commit: update the README's feature list from the specs.

Evidence for the write-up: keep a short log of which specs, tasks and hooks produced which features, plus screenshots of Kiro mid-task.

## Demo data, testing and acceptance

We write our own fictional RFQs and quotes, so every planted error is known and nothing confidential is used.

Sample sets (fictional companies):

1. Conveyor spares: RFQ for 12 lines (idlers, belting, bearings). Supplier A is complete; Supplier B is 8% cheaper but omits two lines and quotes bearings with a different seal.
2. Pump package: RFQ for a slurry pump with motor and baseplate. One quote excludes commissioning in a footnote and changes payment to 50% upfront.
3. Site PPE and consumables: many small lines with unit traps (box of 100 vs each, rolls vs metres).

Testing:

- Each sample set has a golden answer file listing every expected finding.
- Target: 90% of planted findings caught, and no more than one false critical finding per set.
- Unit tests for parsers, unit normalisation and arithmetic checks.
- One end-to-end test per sample set, run by a Kiro hook.

Acceptance criteria for the MVP:

- A sample set produces findings in under 60 seconds.
- Every finding shows source evidence from both documents.
- Buyer can accept, dismiss and annotate findings.
- PDF report and clarification drafts export correctly.
- Full flow works by keyboard and with "lights on" mode.
- Live URL deployed and stable.

## Five-week plan

ScopeCheck must be live on its URL by 22 November; weeks 4 and 5 are for PackCheck, polish and the submission.

Five-week plan diagram transcription:

ScopeCheck is live by week 3, leaving two weeks for PackCheck and polish.

| Week | Dates in original diagram | Work |
| --- | --- | --- |
| 1 | 2 to 8 November | Specs and steering; repo and licence; sample documents; ingest and extract |
| 2 | 9 to 15 November | Match and rules; evidence spans; golden tests; Kiro hooks |
| 3 | 16 to 22 November | Results screens; matrix and evidence; review and export; deploy live URL |
| 4 | 23 to 29 November | PackCheck spec; PackCheck build; haunted polish; accessibility pass |
| 5 | 30 November to 4 December | Fix and harden; demo video; Kiro write-up; submit |

The four gates in the original diagram are: engine catches 90% of planted errors; ScopeCheck live on its URL; PackCheck runs on the same engine; submit by 4 December.

Five-week plan · 4 gates

If a gate slips, cut from PackCheck and theme polish first, never from evidence quality.

Submission checklist:

- Request free Kiro credits (closes 1 Dec, 22:00 SAST).
- Public GitHub repo with MIT licence and .kiro/ at the root.
- README with setup steps and sample sets.
- Live app URL, kept up until 29 January 2027.
- Public YouTube demo under 3 minutes.
- Project description and Kiro write-up.
- Disclosure of any pre-existing work.
- Best Startup Project bonus details.
- Submit before Saturday 5 December, 00:00 SAST.

## Risks and open questions

| Risk | Fallback |
| --- | --- |
| PDF table extraction is messy | Limit the MVP to text-based PDFs and DOCX; design sample quotes in realistic but parseable layouts |
| The model hallucinates a finding | Rules decide findings; no evidence excerpt means no finding |
| Model API cost or downtime during judging | Cache results for the sample sets so judges always get a fast, working demo |
| PackCheck squeezes week 5 | Keep PackCheck to one sample set and the same screens with different vocabulary |
| Theme hurts usability | "Lights on" mode and accessibility hook from day one |

Open questions:

- Which model provider and stack? Proposed: Next.js, TypeScript, a hosted LLM API, deployed on Vercel.
- Should uploaded documents be stored at all? Proposed: process in memory and discard after the session.
- Solo build, or will someone help with design or the video?
