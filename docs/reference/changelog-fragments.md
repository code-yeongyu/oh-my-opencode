# Changelog fragments (#9961)

A PR that changes user-facing paths adds exactly one file here, named for the PR:
`changes/unreleased/<pr-number>.md` (#9961). Its body is the paragraph that used to go under
`## [Unreleased]` in `CHANGELOG.md`, linking its own PR:

```md
**OmO loads the analytics SDK only when an event is captured.** PostHog now ships as a lazy
sidecar ... ([#10640](https://github.com/code-yeongyu/oh-my-openagent/pull/10640))
```

- Never edit `CHANGELOG.md` or the root `changes.md` in a normal PR; the `changelog-gate`
  workflow refuses it. Notes that used to go in root `changes.md` go in the fragment too.
- Fragments are immutable once merged. Only the release-state PR (`release/*`, opened by the
  release workflow) edits `CHANGELOG.md`: `script/stamp-release-changelog.ts` assembles the
  fragments newest-PR-first into the release section and deletes them in the same commit.
- The `no-changelog` label waives the fragment only for a PR with no user-facing paths.
- This guide lives outside `changes/unreleased/` because the gate accepts only `<pr-number>.md` files there.

## Package logs (`packages/<name>/changes.md`)

A PR never edits a package log either: two open PRs that both prepended to the same log
conflicted on its first lines. Put each entry in the same fragment, after the paragraph, as a block
that names its log:

```md
**OmO ... user-facing paragraph** ([#123](https://github.com/code-yeongyu/oh-my-openagent/pull/123))

<!-- changes-log: packages/omo-senpi/changes.md -->
## 2026-10-20 - What changed in omo-senpi (#123)

The text you used to prepend to that log.
```

- One block per log; the heading is `## YYYY-MM-DD - <title>`; the log must already exist. The
  `changelog-gate` workflow checks every block (`script/package-log-gate.ts`).
- `bun script/compile-package-logs.ts compile` writes the blocks into their logs, newest PR on top,
  and leaves each fragment with only its paragraph (a fragment with no paragraph is deleted). The
  release stamp does the same for any block still waiting. A release needs at least one paragraph: if
  every fragment is blocks-only the stamp refuses and writes nothing, and the blocks wait for the hourly job.
- Only the paragraph goes into `CHANGELOG.md`. The marker grammar matches omo-desktop-app's
  `changes/unreleased`, so the root changelog can move to the same compile later without a second migration.
- A branch that still prepends to a package log converts with
  `bun script/compile-package-logs.ts from-diff --base origin/dev --pr <n>`, then commit.
