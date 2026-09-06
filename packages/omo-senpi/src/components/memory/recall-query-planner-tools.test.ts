import { describe, expect, test } from "bun:test"

import { toolArgTexts, ToolArgWindow } from "./recall-query-planner-tools"

describe("toolArgTexts", () => {
  test("extracts read paths and path words", () => {
    expect(toolArgTexts("read", { path: "/a/b/compaction-timeout.ts" })).toEqual([
      "compaction-timeout.ts", "compaction", "timeout",
    ])
  })

  test("extracts command tokens without flags", () => {
    const texts = toolArgTexts("bash", { command: "git rebase -i origin/dev | tee log.txt" })
    expect(texts).toContain("git")
    expect(texts).toContain("tee")
    expect(texts).toContain("log.txt")
    expect(texts).not.toContain("-i")
  })

  test("keeps grep patterns", () => {
    expect(toolArgTexts("grep", { pattern: "memorian nudged" })).toEqual(["memorian nudged"])
  })

  test("removes secret-bearing strings", () => {
    expect(toolArgTexts("bash", { command: "curl -H 'Authorization: Bearer sk-abcdef0123456789abcdef'" })).not.toContain("sk-abcdef0123456789abcdef")
  })

  test("ignores unknown keys and nested objects", () => {
    expect(toolArgTexts("read", { content: "hidden", text: "hidden", other: { path: "nested.ts" } })).toEqual([])
  })

  test("filters export secret command", () => {
    expect(toolArgTexts("bash", { command: "export TOKEN=abc123secretvalue00000" })).toEqual([])
  })
})

describe("ToolArgWindow", () => {
  test("keeps newest eight pushes and clears", () => {
    const window = new ToolArgWindow()
    for (let index = 0; index < 10; index += 1) window.push("session", [`text-${index}`])
    expect(window.texts("session")).toEqual(["text-2", "text-3", "text-4", "text-5", "text-6", "text-7", "text-8", "text-9"])
    window.clear("session")
    expect(window.texts("session")).toEqual([])
  })
})
