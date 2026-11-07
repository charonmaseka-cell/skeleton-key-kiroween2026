# Hooks: what is configured, what has actually run

Rule from `.kiro/steering/workflow.md`: never claim a hook ran unless it did. **CI in GitHub (Web) is the authoritative check**; hooks are a convenience that gives earlier feedback in a local Kiro IDE or CLI session.

## Where this stands (7 Nov 2026)

- **Verified:** both hook commands, by running them directly with hook-like input (results in the table below).
- **Not verified:** automatic execution in a Kiro session. No hook has fired on its own. The blocker observed was Kiro's own log for the workspace, which reported it as untrusted, so hooks did not run (I read that in the session log and have not reproduced its text here). I have stopped troubleshooting it for now.
- **What CI runs.** The hooks themselves are not run in CI; the workflow (`.github/workflows/ci.yml`) runs the checks they stand for, on every pull request and on pushes to `main`:
  - `engine-module-tests` corresponds to `npm test`, which runs every engine test, a superset of the one module a save would run.
  - `golden-fixtures-on-rule-change` corresponds to `npm test` too: it runs both apps' golden and review-regression tests, and `tools/hooks/hooks.test.ts`, which fails when the committed outcome snapshot (`tools/hooks/golden-outcomes.json`) differs from the outcomes computed now. So a rule change that alters any outcome fails CI until the snapshot is updated on purpose, which is the same signal the hook reports on save.
  - The same workflow also runs `npm run lint`, `npm run typecheck` and `npm run build`, and a separate `a11y` job runs the browser checks (`tools/a11y/check.ts`).
- **If I add a hook through the IDE panel later,** I will validate and commit the configuration it generates, keep a single active copy of each hook, and update this page.

## Status (2026-11-03)

| Hook | Trigger | Purpose | Configured | Actually run |
|---|---|---|---|---|
| `engine-module-tests` | `PostFileSave`, `packages/engine/src/<module>.ts` | Run that module's tests (its own test, plus engine tests that import it; every engine test if none is found) | **Yes**: `.kiro/hooks/engine-module-tests.json`, command `npx tsx tools/hooks/engine-tests.ts` | **Not by Kiro.** The hook tool said it becomes active at the next session start, so it could not have fired in the session that created it. The command was run by hand with hook-like input on 2026-11-03: for `findings.ts` it chose `packages/engine/test/findings.test.ts` and 9 tests passed; for an unknown module it ran all engine tests, 92 passed. That shows the command works, not that the hook fires. |
| `golden-fixtures-on-rule-change` | `PostFileSave`, an app adapter file or an engine rule file (`findings`, `compare`, `comparisons`, `matcher`, `coverage`, `evidence`, `support`, `facts`, `review`) | Compute every rule outcome on every sample fixture, print each one added, removed or changed since `tools/hooks/golden-outcomes.json`, then run the golden and review-regression tests of both apps; exit 1 on any change or failure | **Yes**: `.kiro/hooks/golden-fixtures-on-rule-change.json` (replaces the earlier version, which only reran the tests), command `npx tsx tools/hooks/golden-report.ts` | **Not by Kiro** (same reason). By hand on 2026-11-03: unchanged rules gave "outcomes: unchanged (56 outcomes ...)", 42 golden tests passed, exit 0. With quantity differences temporarily set back to Critical (reverted, not committed) it reported 10 CHANGED outcomes, for example `quantity.differs ... confirmed high -> confirmed critical`, while the 42 golden tests still passed (they do not pin severity), and exited 1. |
| Update the README feature list and build log from the specs | **No hook.** Kiro's triggers here are automatic; there is no manual trigger | The task is manual by nature | A script and a manual-inclusion steering file instead: `npm run docs:sync` (`tools/docs/sync-from-specs.ts`), `.kiro/steering/sync-docs.md` | Run by hand on 2026-11-03; it wrote the generated blocks in `README.md` and `docs/build-log.md`. |
| accessibility checks on UI change | `PostFileSave` | Run the browser accessibility checks when UI code changes | **No, deliberately.** The script now exists (`npm run a11y`, `tools/a11y/check.ts`, also a CI job) but it builds both apps and drives a browser, about a minute: too heavy for every save. CI runs it on every pull request. | No |

Update the "Actually run" column only after you have seen the evidence described below.

## What the documentation says (and does not)

From the Kiro hooks documentation (pages: Hooks, Hook types, Hook actions, Managing hooks, Troubleshooting, CLI headless mode, Cloud sessions):

- Hooks are JSON files in `.kiro/hooks/*.json` (`{"version":"v1","hooks":[{name, trigger, matcher, action, timeout, ...}]}`). The IDE and Kiro CLI v3 both read them.
- **File-trigger hooks (create, save, delete) fire only on changes the agent makes**, not when a person saves a file in the editor. Do not expect the golden-fixtures hook to run when you type and save.
- **Kiro Web does not run hooks.** Web can only store configuration for use in local IDE or CLI sessions. (The cloud-sessions page implies project hooks apply to cloud sessions; the hooks page says otherwise, and the documentation does not reconcile them. Treat Web as not running hooks until you see one run.)
- Default timeouts: 60 s in the IDE, 30 s in CLI agent configuration; the golden hook sets 120 s.
- Exit codes: documented inconsistently (one page says only exit 2 blocks a pre-tool or pre-task hook; another says any non-zero exit blocks). Our hook is a post-save hook and does not rely on blocking.
- No workspace trust prompt for hooks is documented.
- Evidence of execution: the IDE has hook execution logs in the Kiro output panel. The documentation gives no CLI log location and no per-run indicator.

## Run it in the Kiro IDE

1. Open the repository folder (`skeleton-key-kiroween2026`) as the workspace, so `.kiro/hooks/` is at the workspace root and the command's relative paths resolve.
2. Open the Kiro hooks view and confirm "Rerun golden fixtures and report changed outcomes when a rule or adapter file is saved" is listed and enabled (the eye icon or switch toggles it).
3. In a chat, ask Kiro to make a small edit to a matching file (for example `apps/scopecheck/src/adapter/rules.ts`). The hook is a post-save hook for agent edits.
4. Open the Kiro output panel and look for the hook's execution log and the vitest summary.
5. Proof that it ran: temporarily change the command to `npx vitest run ... ; date >> /tmp/hook-ran.log`, repeat step 3, check the file, then **restore the command**. Record the date in the table above.

## Run it in the Kiro CLI

1. Install and start Kiro CLI v3 from the repository root. It reads `.kiro/hooks/*.json` (project hooks); the headless mode in version 2.27.1 and later also loads them.
2. Ask the agent to edit a matching file and watch for the vitest output in the session.
3. Because the documentation gives no CLI log location, use the same `/tmp/hook-ran.log` proof as in the IDE step 5 and then restore the command.
4. If hooks do not appear, check the CLI version and the hooks migration notes for your version; do not assume.

## Planned hook 2 (do not enable yet)

When foundation task 11 / HU-T4 adds an accessibility test script (for example `npm run test:a11y`, covering both apps in both haunted modes), create this file as `.kiro/hooks/a11y-on-ui-change.json` and enable it, then add its row evidence here:

```json
{
  "version": "v1",
  "hooks": [
    {
      "name": "Run accessibility checks when UI code changes",
      "trigger": "PostFileSave",
      "matcher": "(packages/ui/src/|apps/(scopecheck|packcheck)/src/[^/]*\\.tsx)",
      "action": { "type": "command", "command": "npm run test:a11y", "timeout": 180 }
    }
  ]
}
```

## CI stays authoritative

`.github/workflows/ci.yml` runs lint, typecheck, test and build on every pull request in GitHub. A green hook locally never replaces a green CI run, and a hook that has not been shown to run is reported as "configured", not as a check that passed.
