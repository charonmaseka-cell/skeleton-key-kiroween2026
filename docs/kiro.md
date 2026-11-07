# How I built Skeleton Key with Kiro

I built Skeleton Key with Kiro, spec first. I decided what each part had to guarantee, reviewed the requirements and design before any code was written, and had Kiro implement one small milestone per pull request. `docs/build-log.md` records what each milestone actually delivered, including the corrections.

## Specs

| Spec | What it governs |
| --- | --- |
| `skeleton-key-foundation` | The shared engine and UI: requirements R1 to R13 (evidence validation, matching, coverage, review, export, privacy), the design, and the original task plan |
| `scopecheck-real-documents` | ScopeCheck on real PDFs: upload, multi-part extraction, realistic fixtures, deployment |
| `packcheck-real-documents` | PackCheck on real PDFs: attachment mapping, cross-document fields, a realistic pack |
| `haunted-ui` | The theme as requirements: séance, ghosts, candles and planchette, each with a rule that it never covers data and switches off under Lights on and reduced motion |

The app specs reference foundation requirements by ID instead of copying them, so the template's contract lives in one place.

## Steering

- **`product.md`:** the principles every task is checked against. Models extract; deterministic rules decide. Unknown stays unknown. Needs review is not a finding. Never claim all processing is local.
- **`tech.md`:** stack, folder layout, budget rules, and the rule that no paid service is added without flagging it first.
- **`workflow.md`:** requirements, then design, then tasks, with my review between phases; one small milestone per pull request; an honest build log; never claim a hook ran unless it did.
- **`theme.md`:** the haunted vocabulary and tone. Theme names sit beside plain labels and never replace them.
- **`brief.md`:** the original brief and the changes I approved to it (manual inclusion).
- **`sync-docs.md`:** how to regenerate the README status table and build log from the specs.

## Hooks

- **Engine module tests:** when an engine file is saved, run that module's tests.
- **Golden fixtures on rule change:** when a rule or adapter file is saved, recompute every rule outcome on every sample and report anything that changed. In a deliberate check, reverting one severity rule left all 42 golden tests passing, but this hook reported **10 changed outcomes**: a regression the tests alone would have missed.

I verified both hook commands by running them directly. They have not yet fired automatically in a Kiro session (the workspace was reported as untrusted), so I make no claim that they do. CI does not run the hooks; it runs the checks they stand for on every pull request: all engine tests, both apps' golden tests, and a test that fails when the committed outcome snapshot differs from the outcomes computed now. Details are in `docs/hooks.md`.

## What spec-driven development changed

- **Writing specs first caught design flaws before code.** The rule that an absence is only a finding after confirmed coverage started as a requirement, and it shaped the engine, the review queue and the ghost effect.
- **Steering stopped silent shortcuts.** "Never claim a hook ran unless it did" and "report measured results, not universal accuracy" keep every number in this repo traceable to a results file.
- **Pre-registered tests kept the results honest.** Test documents and expected findings were written and frozen before each live run. Every run reported its misses first, and when a process step failed, I tightened the rule instead of quietly fixing the result. On the fresh pre-registered set (12 expected findings) the pipeline found 12 of 12 with no false critical and no over-confident finding, first with extraction profile `scopecheck.quote.v1` (1 Nov 2026) and again with `scopecheck.quote.v2` (7 Nov 2026); the second run also showed that a model asked for line totals on documents that state none returns none.
- **The template boundary is enforced, not hoped for.** A test fails if procurement or grant vocabulary enters the engine, so PackCheck had to be built entirely through its adapter.

## Evidence

- `.kiro/` at the repository root: specs, steering and hooks.
- `docs/build-log.md`: what each milestone delivered, with dates.
- `docs/hooks.md`: what the hooks do and how they were verified.
- `docs/results/`: benchmark and validation results, including the misses.
