# PR #7519 generated-extension rebase

## What was tested

- RED baseline: `node packages/omo-senpi/plugin/scripts/build-extension.mjs --check` reported a stale generated `omo.js`; `git merge --no-commit --no-ff origin/dev` then reproduced the content conflict in generated `plugin/extensions/omo-task.js`.
- GREEN artifact check: `node packages/omo-senpi/plugin/scripts/build-extension.mjs --check` after source-driven regeneration.
- Fallback regression: `bun test packages/senpi-task/src/agents/builtin/fallback-chains.test.ts`.
- Driver isolation: `node packages/omo-senpi/scripts/qa/task-runtime-fallback-e2e.mjs --self-test`.
- Live harness: the real `senpi` binary ran the isolated `explore-qwen-fallback` and `librarian-qwen-fallback` scenarios against the committed bundle.
- Package gates: `bun run --cwd packages/omo-senpi typecheck` and `bun run test:senpi`.

## What was observed

- The merge conflict was isolated to the generated `omo-task.js`; no source file conflicted. Regenerating all extensions from the merged source removed all conflict entries.
- The final artifact freshness check passed. The source and generated task bundle each retain two corrected Qwen fallback entries.
- Fallback regression: 6 pass, 0 fail, 126 assertions.
- The live scenarios both passed: each selected the corrected fallback from the agent chain, completed successfully, kept the real credential surface unchanged, and removed its task-owned sandbox. The sanitized machine-readable results are in `live-fallback-summary.json`.
- Adapter typecheck passed. The Senpi package gate passed: 2719 pass, 32 platform skips, 0 fail, 8574 assertions across 360 files.

## Why this is sufficient

The RED merge proves the exact stale PR state. Regeneration validates the only conflicted generated artifact from merged source rather than hand-editing it. The live real-Senpi scenarios exercise both changed curated agents through the packed task runtime and prove selection, execution, isolation, and cleanup; the package gate covers the wider adapter surface.

## What was omitted

Raw live-driver files contain deterministic isolation digests. They remain private rather than being committed or quoted. This evidence records only the boolean isolation result and sanitized scenario checks. The workspace LSP service could not inspect this task-owned `/private/tmp` worktree because it is outside its configured root; compiler/typecheck gates above ran on the actual worktree.
