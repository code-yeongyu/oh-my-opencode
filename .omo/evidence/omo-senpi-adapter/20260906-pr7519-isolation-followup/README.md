# PR #7519 isolation follow-up

## What was tested

- RED machine-environment boundary: the fallback-driver self-test supplied a hostile `USERPROFILE` and failed before the child environment pinned it.
- GREEN machine-environment boundary: the same self-test after pinning `USERPROFILE` to the sandbox home.
- Real fallback surface: the real Senpi Explore and Librarian fallback scenarios ran with a hostile inherited `USERPROFILE` selector.
- Shared structured isolation surface: the current unmodified `packages/omo-senpi/scripts/qa/drive.mjs` ran in a disposable supported Linux Node 24.20/Bun 1.4.0 environment with the real Senpi binary and fully staged plugin.
- Gate: direct adapter typecheck plus `bun run test:senpi` in the same Linux environment.

## What was observed

- The RED self-test exited 1 at the child-environment isolation assertion. After the minimal common-environment pin, it exited 0.
- Both real fallback scenarios passed after the fix: they selected and completed with the corrected agent fallback, kept their credential surface unchanged, and removed their task-owned sandboxes.
- The shared driver passed its behavior and structured isolation contracts: `isolationCertified`, `realHomeIsolationCertified`, `realSenpiUntouched`, and `realOmoUntouched` are true; both attributed changed-path arrays, certification changed paths, and isolation errors are empty. The sanitized machine-readable result is `shared-drive-isolation-summary.json`.
- Linux typecheck and package gate passed: 2748 pass, 3 platform skips, 0 fail, 8679 assertions across 360 files.

## Why this is sufficient

`USERPROFILE` is a child-process home selector on Windows. The failing-first boundary check proves it was inherited before the change, and the same test plus the real fallback run prove the sandboxed value is now passed into the actual child. The current shared driver is separate from the digest-only fallback driver and proves complete structured real-home observation, changed-path attribution, controlled-root certification, and sandbox environment receipt on a supported runtime.

## Historical evidence

Earlier general-driver evidence with `DIRECTORY_IDENTITY_UNAVAILABLE` is not treated as a pass. This run supersedes it with a new structured verdict from a supported Linux environment; no isolation checker was weakened.

## What was omitted

Raw driver output contains exact sandbox and container-home paths. It is retained privately with the complete structured fields but not committed. No credential digest values, credentials, tokens, or host paths are included here.
