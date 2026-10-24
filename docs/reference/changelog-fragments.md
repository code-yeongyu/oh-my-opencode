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
