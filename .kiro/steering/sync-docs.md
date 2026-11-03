---
inclusion: manual
---

# Update the README feature list and the build log from the specs (manual)

Use when asked to "sync the docs from the specs". Kiro's hook triggers here are automatic (tool use, file create/save/delete, prompt, session, task); there is no manual trigger, so this is a script plus this note, not a hook.

1. Run `npm run docs:sync` (`tools/docs/sync-from-specs.ts`). It reads every `.kiro/specs/*/tasks.md` and rewrites **only** the text between the markers `<!-- features:start -->` ... `<!-- features:end -->` in `README.md` and `<!-- spec-status:start -->` ... `<!-- spec-status:end -->` in `docs/build-log.md`. `npm run docs:sync -- --check` changes nothing and exits 1 if a block is out of date.
2. Read the diff. A ticked task is shown as delivered because the spec says so; do not tick a task here, and do not add dates or claims to the generated blocks.
3. Anything the build log must say about *what was measured or run* is written by hand in a dated entry above the generated block, from the evidence, never from the specs.
4. Open a pull request with the result; CI is authoritative.
