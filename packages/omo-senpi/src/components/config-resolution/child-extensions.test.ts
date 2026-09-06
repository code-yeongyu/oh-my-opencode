import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import {
  resolveChildExtensions,
  resolveInheritedChildExtensions,
} from "./child-extensions"

const existsAll = () => true

describe("resolveChildExtensions", () => {
  test("#given no config or an empty list #when resolved #then it returns an empty list", () => {
    expect(resolveChildExtensions(undefined, { exists: existsAll })).toEqual([])
    expect(resolveChildExtensions({ child_extensions: undefined }, { exists: existsAll })).toEqual([])
    expect(resolveChildExtensions({ child_extensions: [] }, { exists: existsAll })).toEqual([])
  })

  test("#given absolute entries #when resolved #then they survive verbatim and deduped", () => {
    const resolved = resolveChildExtensions(
      { child_extensions: ["/abs/a.js", "/abs/a.js", "/abs/b.js"] },
      { exists: existsAll },
    )
    expect(resolved).toEqual(["/abs/a.js", "/abs/b.js"])
  })

  test("#given a tilde entry #when resolved #then it expands against HOME", () => {
    const resolved = resolveChildExtensions(
      { child_extensions: ["~/exts/auth.js"] },
      { env: { HOME: "/home/u" }, exists: existsAll },
    )
    expect(resolved).toEqual(["/home/u/exts/auth.js"])
  })

  test("#given a relative entry #when resolved #then it resolves against the supplied cwd", () => {
    const resolved = resolveChildExtensions(
      { child_extensions: ["exts/auth.js"] },
      { cwd: "/work/dir", exists: existsAll },
    )
    expect(resolved).toEqual(["/work/dir/exts/auth.js"])
  })

  test("#given a missing entry #when resolved #then it warns and skips instead of failing", () => {
    const warnings: string[] = []
    const resolved = resolveChildExtensions(
      { child_extensions: ["/abs/here.js", "/abs/gone.js"] },
      {
        exists: (path) => path !== "/abs/gone.js",
        warn: (message) => warnings.push(message),
      },
    )
    expect(resolved).toEqual(["/abs/here.js"])
    expect(warnings).toHaveLength(1)
  })
})

describe("resolveInheritedChildExtensions", () => {
  test("#given argv -e entries and config entries #when resolved #then argv stays first and the union is deduped", () => {
    const resolved = resolveInheritedChildExtensions(
      { child_extensions: ["/cfg/auth.js", "/abs/argv-b.js"] },
      ["senpi", "-e", "/abs/argv-a.js", "--extension", "/abs/argv-b.js"],
      { exists: existsAll },
    )
    expect(resolved).toEqual(["/abs/argv-a.js", "/abs/argv-b.js", "/cfg/auth.js"])
  })

  test("#given argv -e entries and no config #when resolved #then only the argv entries remain", () => {
    const resolved = resolveInheritedChildExtensions(
      undefined,
      ["senpi", "-e", join("/", "omo.js")],
      { exists: existsAll },
    )
    expect(resolved).toEqual(["/omo.js"])
  })
})
