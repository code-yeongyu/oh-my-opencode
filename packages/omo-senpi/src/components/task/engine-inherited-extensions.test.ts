import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { loadOmoConfig } from "@oh-my-opencode/omo-config-core"
import type { ManagedRunner } from "@oh-my-opencode/senpi-task"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { composeTaskEngine } from "./engine"
import type { TaskRunnerFactories } from "./engine-runners"

const roots: string[] = []

function captureInheritedExtensions(omoConfig: ReturnType<typeof loadOmoConfig>["config"], cwd: string): readonly string[] {
  let captured: readonly string[] | undefined
  const runner = {} as ManagedRunner
  const runnerFactories: TaskRunnerFactories = {
    inProcess: () => runner,
    process: (context) => {
      captured = context.inheritedExtensions
      return runner
    },
  }
  composeTaskEngine({
    pi: new FakeExtensionAPI(),
    omoConfig,
    cwd,
    sharedParentTools: () => [],
    runnerFactories,
  })
  if (captured === undefined) throw new Error("process runner factory was not invoked")
  return captured
}

describe("composeTaskEngine child_extensions", () => {
  test("#given child_extensions in omo config #when the process runner is built #then the paths join the inherited extension list", () => {
    // given
    const cwd = mkdtempSync(join(tmpdir(), "omo-child-ext-"))
    roots.push(cwd)
    const extension = join(cwd, "auth-ext.js")
    writeFileSync(extension, "// fixture\n", "utf8")
    const config = {
      ...loadOmoConfig({ cwd }).config,
      child_extensions: [extension],
    }

    // when
    const inherited = captureInheritedExtensions(config, cwd)

    // then
    expect(inherited).toContain(extension)
  })

  test("#given a missing child_extensions entry #when the process runner is built #then the entry is skipped, not fatal", () => {
    // given
    const cwd = mkdtempSync(join(tmpdir(), "omo-child-ext-"))
    roots.push(cwd)
    const config = {
      ...loadOmoConfig({ cwd }).config,
      child_extensions: [join(cwd, "does-not-exist.js")],
    }

    // when
    const inherited = captureInheritedExtensions(config, cwd)

    // then
    expect(inherited).toEqual([])
  })

  test("#given no child_extensions #when the process runner is built #then the inherited list matches the parent argv entries", () => {
    // given
    const cwd = mkdtempSync(join(tmpdir(), "omo-child-ext-"))
    roots.push(cwd)
    const config = loadOmoConfig({ cwd }).config

    // when
    const inherited = captureInheritedExtensions(config, cwd)

    // then: bun test argv carries no -e entries, so nothing is inherited
    expect(inherited).toEqual([])
  })
})

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
