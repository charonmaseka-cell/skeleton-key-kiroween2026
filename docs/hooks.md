# Hooks: what is configured, what has actually run

Rule from `.kiro/steering/workflow.md`: never claim a hook ran unless it did. **CI in GitHub (Web) is the authoritative check**; hooks are a convenience that gives earlier feedback in a local Kiro IDE or CLI session.

## Status (2026-11-01)

| Hook | Purpose | Configured | Actually run |
|---|---|---|---|
| `golden-fixtures-on-rule-change` | When the agent saves engine source, an app adapter or a fixture, rerun the golden and review-regression tests of both apps | **Yes**: `.kiro/hooks/golden-fixtures-on-rule-change.json` | **No.** Never triggered by an IDE or CLI event. The command it runs was executed by hand in the Web sandbox: 4 test files, 42 tests passed, about 1 s. That shows the command works, not that the hook fires. |
| accessibility checks on UI change | When the agent saves UI code, run the accessibility checks | **No.** Planned only. It needs the accessibility tests of foundation task 11 / HU-T4, which do not exist yet; a hook that calls a missing script would pass silently and look like a check that ran. | No |

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
2. Open the Kiro hooks view and confirm "Rerun golden fixtures when engine or rule code changes" is listed and enabled (the eye icon or switch toggles it).
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
