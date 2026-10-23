#!/usr/bin/env bun
/**
 * bun script/compile-package-logs.ts compile
 *   Writes every package-log block in changes/unreleased/*.md into its log (newest PR on top) and
 *   leaves each fragment with its CHANGELOG preamble (deleted when it has none). The hourly job on
 *   dev runs this; the release stamp does the same for anything left.
 * bun script/compile-package-logs.ts from-diff --base <ref> --pr <n>
 *   Converts a branch that still prepends to packages/<x>/changes.md: the prepended text moves into
 *   changes/unreleased/<n>.md as blocks and each log goes back to the base's bytes. Commit the result.
 */
import { execFileSync } from "node:child_process"
import { readdir, rm } from "node:fs/promises"
import { FRAGMENT_DIR, fragmentPath, readFragments } from "./changelog-fragments"
import { blockFromPrepend, compileBlocks, markerLine, splitFragment } from "./package-log-blocks.ts"

const root = new URL("../", import.meta.url)
const at = (path: string) => new URL(path, root)

async function compile(): Promise<void> {
  const names = (await readdir(at(`${FRAGMENT_DIR}/`))).filter((name) => name.endsWith(".md"))
  const contents = new Map<string, string>()
  for (const name of names) contents.set(name, await Bun.file(at(`${FRAGMENT_DIR}/${name}`)).text())
  const fragments = readFragments(names, (name) => contents.get(name) ?? "")
  const logs = new Map<string, string | null>()
  for (const fragment of fragments) {
    for (const block of splitFragment(fragment.content).blocks) {
      const path = block.log
      const file = Bun.file(at(path))
      logs.set(path, (await file.exists()) ? await file.text() : null)
    }
  }
  const result = compileBlocks(fragments, (path) => logs.get(path) ?? null)
  for (const [path, content] of result.logs) await Bun.write(at(path), content)
  for (const [pr, kept] of result.fragments) {
    if (kept === null) await rm(at(fragmentPath(pr)))
    else await Bun.write(at(fragmentPath(pr)), kept)
  }
  console.log(`compiled ${result.fragments.size} fragment(s) into ${result.logs.size} package log(s)`)
}

async function fromDiff(base: string, pr: number): Promise<void> {
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root.pathname, encoding: "utf8" })
  // The merge base, not the base tip: dev's logs move after this branch forked (#10682 review MEDIUM 2), and the gate
  // diffs against the merge base too, so restoring the tip's bytes would still read as an edit.
  const mergeBase = git("merge-base", base, "HEAD").trim()
  const edited = git("diff", "--name-only", `${mergeBase}...HEAD`, "--", "packages/*/changes.md").split("\n").filter(Boolean)
  if (edited.length === 0) throw new Error("this branch edits no package log")
  const blocks: string[] = []
  for (const log of edited) {
    const block = blockFromPrepend(log, git("show", `${mergeBase}:${log}`), git("show", `HEAD:${log}`))
    if (block === null) throw new Error(`${log} was edited below its top; move that text by hand`)
    blocks.push(`${markerLine(block.log)}\n${block.body}`)
    git("checkout", mergeBase, "--", log)
  }
  const target = at(fragmentPath(pr))
  const file = Bun.file(target)
  const existing = (await file.exists()) ? (await file.text()).trim() : ""
  await Bun.write(target, `${[existing, ...blocks].filter(Boolean).join("\n\n")}\n`)
  console.log(`moved ${blocks.length} log entr${blocks.length === 1 ? "y" : "ies"} into ${fragmentPath(pr)}; review and commit`)
}

if (import.meta.main) {
  const [command, ...rest] = process.argv.slice(2)
  const flag = (name: string) => rest[rest.indexOf(name) + 1]
  if (command === "compile") await compile()
  else if (command === "from-diff" && flag("--base") && /^\d+$/.test(flag("--pr") ?? "")) await fromDiff(flag("--base") ?? "", Number(flag("--pr")))
  else {
    console.error("usage: compile | from-diff --base <ref> --pr <n>")
    process.exit(2)
  }
}
