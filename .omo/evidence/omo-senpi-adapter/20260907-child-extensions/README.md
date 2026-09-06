# 20260907-child-extensions — live QA evidence

Proves the new `child_extensions` omo.json list is forwarded as explicit `-e` entries to
detached senpi children that otherwise run with `--no-extensions`, on the REAL senpi binary.

## What was tested

Driver: `packages/omo-senpi/scripts/qa/child-extensions-e2e.mjs` (run with `bun`; the
in-process leg imports the extension's `.ts` sources).

```bash
node packages/omo-senpi/scripts/qa/drive.mjs --self-test          # SELF-TEST OK
SENPI_BIN="$(pwd)/node_modules/.bin/senpi" \
CHILD_EXT_E2E_OUT_DIR=".omo/evidence/omo-senpi-adapter/20260907-child-extensions" \
bun packages/omo-senpi/scripts/qa/child-extensions-e2e.mjs        # ALL PASS
```

senpi under test: `node_modules/.bin/senpi` (workspace pin), version `2026.9.6`.

- **S1 — senpi mechanism.** `senpi --no-extensions [--e <mock-provider>] --list-models`
  inside an isolated `SENPI_CODING_AGENT_DIR` + `XDG_CONFIG_HOME`. Asserts the `omo-mock`
  provider is absent without `-e` and present with `-e`: `--no-extensions` disables
  *discovery* while explicit `-e` still loads — the contract this feature relies on.
- **S2 — positive, real detached reflection child.** The extension is composed in-process on
  `MemoryFakeExtensionAPI` with `.omo/omo.json` carrying
  `child_extensions: ["<abs path to task-e2e-mock-provider.ts>"]` and
  `categories.quick.model = "omo-mock/mock-1"`. `SENPI_BIN` is a logging-only shim that
  appends each child argv to a file and `exec`s the real senpi unchanged (it injects
  nothing). A session is bound (`session_start` + `agent_settled` with a structural model
  registry exposing `omo-mock/mock-1`), then `/reflect` reserves a manual run. Asserts:
  - catalog-probe argv: `--no-extensions -e <mock> --no-skills ... --list-models`
  - reflection-child argv: `-p --system-prompt ... --tools bash,edit --no-extensions -e <mock>
    ... --model omo-mock/mock-1`
  - run outcome `merged` and `merge(reflection)` commit landed in the memory repo — the
    `omo-mock/mock-1` model cannot exist inside the child unless the extension loaded, so a
    merged run is proof of actual load, not just argv forwarding.
- **S3 — negative control.** Identical setup with `child_extensions` omitted: probe argv has
  no `-e`, the provider is invisible, the run fails `spawn_failed` ("No reflection model
  candidate is visible"), and no child spawn/launch manifest exists — the config list, not
  ambient discovery, delivered the extension.
- **Isolation.** `~/.senpi/agent` and `~/.omo/memory` content digests hashed before/after —
  unchanged (`4ac1b2f21200`, `f08dbcbc4e35`). All state lived under `/tmp/omo-senpi-qa-*`
  sandboxes (agent dir, XDG dirs, `OMO_MEMORY_HOME`, memory repo).

## What was observed

`results.json` — 15/15 PASS, 0 failures.

- `s2-spawn-argv.log` — the two detached-child argv lines the shim saw: the model-catalog
  probe and the `senpi -p` reflection child, both carrying `-e <mock provider>` after
  `--no-extensions`.
- `s2-completion.json` — `outcome: "merged"`, `model: "omo-mock/mock-1"`,
  `trigger: "manual"`.
- `s3-spawn-argv.log` — probe argv with `--no-extensions` and NO `-e`.
- `s3-completion.json` — `outcome: "failed"`, `reason: "spawn_failed"`, detail names the
  missing model visibility.

## Why it is enough

The feature's contract is: configured paths are resolved once and re-added as `-e` on every
detached child spawn. The reflection lane is the deepest end-to-end surface (config →
resolver → preflight probe → spawn-payload → supervisor → real senpi child → real provider
load → merged outcome). The negative scenario excludes ambient extension discovery as an
explanation. The remaining detached surfaces (task/RPC/team/DAG children, `/people --ask`)
share the same argv mechanism (`-e` after `--no-extensions`); the config→argv union there is
pinned by unit tests (`engine-inherited-extensions.test.ts`, `people-ask.test.ts`) and the
senpi mechanism is proven by S1.

## What was omitted / deviations

- `launch.json` env is not copied into evidence (the manifest records the full inherited
  environment; only argv-relevant files were captured).
- The `-p`-mode parent path for settled-trigger reflections cannot be QA'd on this senpi
  build: the fire-and-forget `runner.launch` races parent exit and, when it does run, hits a
  pre-existing "extension ctx is stale after session replacement" failure inside senpi — the
  stock `memory-e2e.mjs` S2 fails identically on this machine, so this is unrelated to the
  change. The in-process `/reflect` route exercises the identical spawn chain.
- Sandbox (`bwrap`/`seatbelt`) needed no change: extension files are only read.
- Temporary `/tmp/omo-senpi-qa-*` sandboxes are throwaway tmp dirs; child processes all
  terminated (supervisor + senpi children completed or were reaped with the driver).
