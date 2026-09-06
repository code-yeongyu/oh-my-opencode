# PR-A: memorian tool-boundary prep - QA evidence

Branch `refactor/memorian-tool-boundary-prep` (plan `.omo/plans/memorian-tool-boundary.md`, issue #7841). No behavior change intended; these captures prove it at the PR head.

| Check | Command | Result |
|---|---|---|
| Senpi typecheck | `bunx tsgo --noEmit -p packages/omo-senpi/tsconfig.json` | exit 0 |
| Package suite | `bun test --timeout 20000 packages/omo-senpi` | 2707 pass, 0 fail, 32 skip (pre-existing skips), 2739 tests / 360 files (`pkg-test-tail.log`) |
| Bundle build | `bun run build:senpi-plugin` | exit 0 |
| Bundle freshness | `node packages/omo-senpi/plugin/scripts/build-extension.mjs --check` | exit 0 (`build-check.log`) |
| Live gate regression | `bun packages/omo-senpi/scripts/qa/memorian-gate-e2e.mjs --scenario all` | ok=true, 20 checks, 0 failures (`memorian-gate-e2e.json`) - S1 silent judge nudges the next turn via the pending file, S2 provider 500 reported as child_failed |

Per-todo RED/GREEN captures, pure-LOC counts and title-set diffs: `.omo/evidence/ulw/memorian-tool-boundary-20260906/` in the worktree (task-1..6, task-14 logs; the two pure moves have identical sorted test-title sets vs dev: 37 and 26 titles).

Isolation: the live driver builds its own sandbox SENPI_CODING_AGENT_DIR (drive.mjs createSandbox) and ignores the caller's; the real ~/.senpi/agent and ~/.omo were not used. Omissions: none.
