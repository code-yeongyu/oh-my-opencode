// `child_extensions` resolver: the omo.json list of senpi extension file paths that detached
// child processes must always load. Every detached child omo spawns (memory reflection/dream
// workers, task/team/DAG RPC children, the model catalog probes) runs `--no-extensions`,
// which only disables DISCOVERY - explicit `-e`/`--extension` entries still load. This module
// turns the config list into the absolute, deduped path list those spawn sites append as
// `-e <path>` arguments.
//
// Resolution rules: a leading `~` expands against the home directory, non-absolute entries
// resolve against the session cwd, and missing/unreadable entries warn and are SKIPPED - a
// typo'd path must never kill a background launch.

import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { isAbsolute, resolve } from "node:path"

import type { OmoConfig } from "@oh-my-opencode/omo-config-core"
import { parseExtensionEntries } from "@oh-my-opencode/senpi-task"

export interface ResolveChildExtensionsOptions {
  /** Base directory for non-absolute entries; defaults to the process cwd. */
  readonly cwd?: string
  readonly env?: NodeJS.ProcessEnv
  readonly exists?: (path: string) => boolean
  readonly warn?: (message: string, details?: unknown) => void
}

function expandEntry(entry: string, env: NodeJS.ProcessEnv): string {
  if (entry === "~" || entry.startsWith("~/") || entry.startsWith("~\\")) {
    const home = env.HOME ?? env.USERPROFILE ?? homedir()
    return resolve(home, entry.slice(2))
  }
  return entry
}

/** Resolves `config.child_extensions` into deduped absolute paths; missing files warn + skip. */
export function resolveChildExtensions(
  config: Pick<OmoConfig, "child_extensions"> | undefined,
  options: ResolveChildExtensionsOptions = {},
): readonly string[] {
  const entries = config?.child_extensions ?? []
  if (entries.length === 0) return []
  const env = options.env ?? process.env
  const cwd = options.cwd ?? process.cwd()
  const exists = options.exists ?? existsSync
  const resolved: string[] = []
  const seen = new Set<string>()
  for (const entry of entries) {
    const expanded = expandEntry(entry, env)
    const absolute = isAbsolute(expanded) ? expanded : resolve(cwd, expanded)
    if (seen.has(absolute)) continue
    seen.add(absolute)
    if (!exists(absolute)) {
      options.warn?.("omo child_extensions entry does not exist; skipping", { entry, resolved: absolute })
      continue
    }
    resolved.push(absolute)
  }
  return resolved
}

/**
 * The extension list handed to a detached child: the parent's own `-e` argv entries FIRST
 * (index 0 must stay the OMO launcher extension - senpi-task drops `spec.extensions[0]` for
 * DAG-owned children, so config entries are appended and survive that slice), then the
 * resolved `child_extensions` config entries, deduped.
 */
export function resolveInheritedChildExtensions(
  config: Pick<OmoConfig, "child_extensions"> | undefined,
  argv: readonly string[],
  options: ResolveChildExtensionsOptions = {},
): readonly string[] {
  const merged: string[] = []
  const seen = new Set<string>()
  for (const entry of parseExtensionEntries(argv)) {
    if (seen.has(entry)) continue
    seen.add(entry)
    merged.push(entry)
  }
  for (const entry of resolveChildExtensions(config, options)) {
    if (seen.has(entry)) continue
    seen.add(entry)
    merged.push(entry)
  }
  return merged
}
