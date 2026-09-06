# published-install smoke cannot extract on Windows under GNU tar, 2026-09-07

`node script/published-install-smoke.mjs --package=<spec>` fails before it installs anything whenever `tar` resolves to GNU tar. That is what happens in Git Bash, and in the bash shell GitHub Actions runs on windows runners.

## Failing input, against upstream/dev at ad62603f0

```
$env:PATH = 'C:\Program Files\Git\usr\bin;' + $env:PATH
node script/published-install-smoke.mjs --package=oh-my-openagent@beta
```

`red-gnu-tar.log`, exit 1:

```
tar (child): Cannot connect to C: resolve failed
published install smoke failed: Command failed: tar -xzf C:\Users\LilMG\AppData\Local\Temp\omo-published-smoke-ZscYNE\oh-my-openagent-5.0.0-beta.45.tgz -C C:\Users\LilMG\AppData\Local\Temp\omo-published-smoke-ZscYNE\extracted
```

## Mechanism

GNU tar reads a colon before the first slash as `host:path`. A Windows absolute path carries one at index 1 and has no forward slash to end the host, so the archive name is taken for a remote machine.

`isolation-archive-argument.log`, three rounds, identical every round, GNU tar 1.35 and bsdtar 3.8.4 spawned from node with the destination held relative so only the archive argument varies:

| tar | `-f` argument | result |
| --- | --- | --- |
| GNU | absolute | exit 2, `Cannot connect to C: resolve failed` |
| GNU | relative to cwd | exit 0 |
| GNU | absolute, plus `--force-local` | exit 0 |
| bsdtar | absolute, plus `--force-local` | exit 1, `Option --force-local is not supported` |

The last two rows are why the fix is not `--force-local`. The flag does repair GNU tar, and bsdtar rejects it outright. bsdtar is the `tar` on macOS and the `tar` a default Windows PATH resolves, so the flag would trade this failure for a different one.

The bsdtar default is also why this went unseen on a Windows workstation: bare `tar` there is `C:\Windows\system32\tar.exe`, which accepts drive letters. Only a shell that puts Git's `usr/bin` first reaches the GNU build.

## RED / GREEN

| run | before | after |
| --- | --- | --- |
| `--package=oh-my-openagent@beta`, GNU tar first on PATH | exit 1 | exit 0 |
| `--package=lazycodex-ai@latest`, GNU tar first on PATH | not run before the fix | exit 0 |
| `--package=oh-my-openagent@beta`, default PATH (bsdtar) | exit 0 | exit 0 |
| `bun test script/published-install-smoke.test.ts script/lazycodex-published-smoke-workflow.test.ts` | - | 8 pass / 0 fail, exit 0 |
| `bun run typecheck:script` | - | exit 0 |
| `bun run typecheck` | - | exit 0 |

The bsdtar row is the control. It passed before the change and still passes, so the fix is not a loosening of the extraction.

Logs: `red-gnu-tar.log`, `green-gnu-tar-oh-my-openagent-beta.log`, `green-gnu-tar-lazycodex-ai-latest.log`, `control-bsdtar.log`, `green-unit.log`, `green-typecheck-script.log`, `green-typecheck-full.log`.

## The wider suite is not green on this machine, before or after

`bun test script/` fails on this workstation at upstream/dev as well, so it is not a signal about this change.

| run | result |
| --- | --- |
| upstream/dev, these three files reverted (`baseline-upstream-script-suite.log`) | 449 pass / 8 skip / 7 fail, exit 1 |
| with the fix (`with-fix-script-suite.log`) | 451 pass / 8 skip / 7 fail, exit 1 |

Both runs fail on the same six named cases: the generated Codex installer version check, embedded manifest parity (darwin-arm64), GitHub workflow job summaries, the omo-ai payload verifier, and two publish.yml checks. None touches the extraction path. The two added tests appear only in the second run and pass.

## Mutation proof

Each mutation was applied to the source, the file suite rerun, then the source restored from a copy.

| mutation | tar in use | result |
| --- | --- | --- |
| both arguments back to absolute (`mutation-m1-absolute-both.log`) | GNU | 5 pass / 2 fail |
| `cwd` dropped from the spawn (`mutation-m2-no-cwd.log`) | bsdtar | 5 pass / 2 fail |
| archive reduced to a bare basename (`mutation-m3-basename-archive.log`) | bsdtar | 6 pass / 1 fail |
| destination alone back to absolute (`mutation-m4-absolute-dest.log`) | GNU | 7 pass / 0 fail, not caught |

The first three are the assertions doing work. The last one is a gap, and it is stated rather than hidden: see below.

## What I could not pin down

Whether an absolute `-C` destination fails is not reproducible on demand. Standalone probes spawning tar directly show it failing (`isolation-via-node.log`, `isolation-via-bun.log`, `isolation-bare-tar.log`, `isolation-bare-tar-bun.log`), while the same shape reached through `extractTarball` succeeds, which is why mutation m4 is not caught. The archive argument is the part that failed in every probe, in the driver, and on the GitHub runner. The destination is made relative alongside it because several probes show it breaking and nothing shows a cost, not because a stable failure was measured for it.

## Independently observed on a GitHub windows runner

Before narrowing to this fix I ran the unpatched driver on `windows-latest` through a fork-only pull request, since no upstream job runs it there: `lazycodex-published-smoke` in `.github/workflows/ci.yml` is `runs-on: ubuntu-latest`. All four specs the job iterates failed identically, each with `tar (child): Cannot connect to C: resolve failed`. Runner image `windows-2025-vs2026` 20260824.214.3, node v24.19.0, npm 11.17.0, shell `C:\Program Files\Git\bin\bash.EXE`. Saved as `ci-windows-runner.log`; that fork branch and its pull request were closed afterwards, so this copy is the record.

## Known limit, not fixed here

`relative()` returns an absolute path when the two paths sit on different drives, and for a UNC target, so `--tarball=D:\...` while the OS temp directory is on `C:` would still hand GNU tar a colon. Nothing in the repository passes `--tarball`; it is reachable only from the command line, and `parseSmokeArgs` is its only caller in tests.

## Local versions

node v26.1.0, npm 12.0.2, bun 1.3.14, GNU tar 1.35, bsdtar 3.8.4, upstream/dev at ad62603f0. The tar versions are printed in `isolation-bare-tar.log`; the rest are recorded out of band.
