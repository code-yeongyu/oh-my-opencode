/// <reference types="bun-types" />

import { afterAll, describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  extractTarball,
  findMissingInstalledArtifacts,
  isSupportedPackageSpec,
  parseSmokeArgs,
} from "./published-install-smoke.mjs"

const createdPluginPaths: string[] = []
const createdSandboxPaths: string[] = []

async function createInstalledPlugin(options: { readonly withUltraworkSkill: boolean }): Promise<string> {
  const pluginPath = await mkdtemp(join(tmpdir(), "omo-smoke-plugin-"))
  createdPluginPaths.push(pluginPath)
  await mkdir(join(pluginPath, ".codex-plugin"), { recursive: true })
  await writeFile(join(pluginPath, ".codex-plugin", "plugin.json"), "{}")
  await writeFile(join(pluginPath, "package.json"), "{}")
  if (options.withUltraworkSkill) {
    await mkdir(join(pluginPath, "skills", "ultrawork"), { recursive: true })
    await writeFile(join(pluginPath, "skills", "ultrawork", "SKILL.md"), "---\nname: ultrawork\n---\n")
  }
  return pluginPath
}

async function packProbeTarball(directory: string, tarballName: string): Promise<string> {
  await mkdir(join(directory, "package"), { recursive: true })
  await writeFile(join(directory, "package", "package.json"), '{"name":"probe","version":"1.0.0"}')
  execFileSync("tar", ["-czf", tarballName, "package"], { cwd: directory, stdio: "ignore" })
  return join(directory, tarballName)
}

afterAll(async () => {
  for (const createdPath of [...createdPluginPaths, ...createdSandboxPaths]) {
    await rm(createdPath, { recursive: true, force: true })
  }
})

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

  test("#given specs carrying shell metacharacters #when they are checked #then none is accepted for packing", () => {
    // given
    const hostile = [
      "lazycodex-ai@latest|calc",
      "oh-my-openagent@5.0.0-beta.43>out.txt",
      "oh-my-openagent@5.0.0<in.txt",
      "oh-my-openagent@latest&whoami",
      "oh-my-openagent@^5.0.0",
    ]

    // when / then
    for (const spec of hostile) {
      expect(isSupportedPackageSpec(spec)).toBe(false)
    }
  })

  test("#given plain dist-tag and exact-version specs #when they are checked #then both are accepted", () => {
    // given / when / then
    expect(isSupportedPackageSpec("lazycodex-ai@latest")).toBe(true)
    expect(isSupportedPackageSpec("oh-my-openagent@5.0.0-beta.43")).toBe(true)
    expect(isSupportedPackageSpec("@scope/pkg@beta")).toBe(true)
  })

  test("#given a tarball packed beside the sandbox #when it is extracted #then the payload lands under the sandbox", async () => {
    // given
    const workingDirectory = await mkdtemp(join(tmpdir(), "omo-smoke-sandbox-"))
    createdSandboxPaths.push(workingDirectory)
    const tarballPath = await packProbeTarball(workingDirectory, "probe.tgz")

    // when
    const packageRoot = await extractTarball(tarballPath, workingDirectory)

    // then
    expect(packageRoot).toBe(join(workingDirectory, "extracted", "package"))
    expect(existsSync(join(packageRoot, "package.json"))).toBe(true)
  })

  test("#given a tarball handed in from outside the sandbox #when it is extracted #then the payload still lands under the sandbox", async () => {
    // given
    const sourceDirectory = await mkdtemp(join(tmpdir(), "omo-smoke-source-"))
    const workingDirectory = await mkdtemp(join(tmpdir(), "omo-smoke-sandbox-"))
    createdSandboxPaths.push(sourceDirectory, workingDirectory)
    const tarballPath = await packProbeTarball(sourceDirectory, "probe.tgz")

    // when
    const packageRoot = await extractTarball(tarballPath, workingDirectory)

    // then
    expect(existsSync(join(packageRoot, "package.json"))).toBe(true)
  })
})
