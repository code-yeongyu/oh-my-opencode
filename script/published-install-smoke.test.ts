/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { findMissingInstalledArtifacts, parseSmokeArgs } from "./published-install-smoke.mjs"

async function createInstalledPlugin(options: { readonly withUltraworkSkill: boolean }): Promise<string> {
  const pluginPath = await mkdtemp(join(tmpdir(), "omo-smoke-plugin-"))
  await mkdir(join(pluginPath, ".codex-plugin"), { recursive: true })
  await writeFile(join(pluginPath, ".codex-plugin", "plugin.json"), "{}")
  await writeFile(join(pluginPath, "package.json"), "{}")
  if (options.withUltraworkSkill) {
    await mkdir(join(pluginPath, "skills", "ultrawork"), { recursive: true })
    await writeFile(join(pluginPath, "skills", "ultrawork", "SKILL.md"), "---\nname: ultrawork\n---\n")
  }
  return pluginPath
}

describe("published install smoke", () => {
  test("#given an installed plugin without the composed ultrawork skill #when artifacts are checked #then the missing path is reported", async () => {
    // given
    const pluginPath = await createInstalledPlugin({ withUltraworkSkill: false })

    // when
    const missing = findMissingInstalledArtifacts(pluginPath)

    // then
    expect(missing).toEqual([join("skills", "ultrawork", "SKILL.md")])
  })

  test("#given a fully installed plugin #when artifacts are checked #then nothing is reported", async () => {
    // given
    const pluginPath = await createInstalledPlugin({ withUltraworkSkill: true })

    // when
    const missing = findMissingInstalledArtifacts(pluginPath)

    // then
    expect(missing).toEqual([])
  })

  test("#given both payload sources #when smoke args are parsed #then the package spec and tarball path are separated", () => {
    // given
    const argv = ["--package=lazycodex-ai@latest", "--tarball=/tmp/omo.tgz", "--keep"]

    // when
    const args = parseSmokeArgs(argv)

    // then
    expect(args).toEqual({ packageSpec: "lazycodex-ai@latest", tarballPath: "/tmp/omo.tgz", keep: true })
  })
})
