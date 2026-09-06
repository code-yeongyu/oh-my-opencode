# PR #7519 selector validation

## What was tested

- CLI RED: `OMO_FALLBACK_SCENARIOS=typo-selector` with a deliberately invalid Senpi executable.
- CLI RED: `OMO_FALLBACK_SCENARIOS=,` with the same executable.
- CLI GREEN: `typo-selector`, `,`, and `,,` at the same CLI boundary after validation.
- Valid live regression: real Senpi Explore and Librarian Qwen fallback scenarios.
- Focused driver self-test plus Linux Node 24.20/Bun 1.4 direct adapter typecheck and `bun run test:senpi`.

## What was observed

- Before the fix, an unknown selector exited 1 without `verdict.json`; comma-only input exited 0 with `{ "result": "PASS", "scenarios": [] }`.
- After the fix, each malformed selector exits 1, prints and writes the same machine-readable `{ "result": "FAIL", "reason": "invalid_selector", "scenarios": [] }` payload, and creates no scenario directories. Because selection is rejected before the scenario map, no Senpi process is spawned.
- Valid Explore and Librarian fallback scenarios remain PASS, select the agent fallback, keep the credential surface unchanged, and clean their sandboxes.
- Linux gate: 2748 pass, 3 platform skips, 0 fail, 8679 assertions across 360 files.

## Why this is sufficient

The selector is validated before `runScenario` is reachable. The CLI checks prove both malformed families produce durable machine-consumed failure evidence rather than throwing or becoming an empty success. The unchanged valid live cases prove selection of the two affected agents still reaches the real Senpi runtime.

## What was omitted

Raw valid-driver output contains isolation digests and sandbox paths. It remains private. This evidence contains only selector values, result fields, and aggregate cleanup outcomes.
