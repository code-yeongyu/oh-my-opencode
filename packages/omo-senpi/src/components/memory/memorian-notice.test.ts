import { describe, expect, test } from "bun:test"
import type { CustomEntry } from "@code-yeongyu/senpi"

import { Theme } from "../../senpi-test-runtime"
import { renderMemorianNudgedEntry } from "./memorian-notice"

const TEST_FG_COLORS = {
  accent: "#000000", bashMode: "#000000", border: "#000000", borderAccent: "#000000", borderMuted: "#000000",
  customMessageLabel: "#000000", customMessageText: "#000000", dim: "#000000", error: "#000000", mdCode: "#000000",
  mdCodeBlock: "#000000", mdCodeBlockBorder: "#000000", mdHeading: "#000000", mdHr: "#000000", mdLink: "#000000",
  mdLinkUrl: "#000000", mdListBullet: "#000000", mdQuote: "#000000", mdQuoteBorder: "#000000", muted: "#000000",
  success: "#000000", syntaxComment: "#000000", syntaxFunction: "#000000", syntaxKeyword: "#000000", syntaxNumber: "#000000",
  syntaxOperator: "#000000", syntaxPunctuation: "#000000", syntaxString: "#000000", syntaxType: "#000000", syntaxVariable: "#000000",
  text: "#000000", thinkingHigh: "#000000", thinkingLow: "#000000", thinkingMax: "#000000", thinkingMedium: "#000000",
  thinkingMinimal: "#000000", thinkingOff: "#000000", thinkingText: "#000000", thinkingXhigh: "#000000", toolDiffAdded: "#000000",
  toolDiffContext: "#000000", toolDiffRemoved: "#000000", toolOutput: "#000000", toolTitle: "#000000", userMessageText: "#000000",
  warning: "#000000",
} as const satisfies ConstructorParameters<typeof Theme>[0]
const TEST_BG_COLORS = {
  customMessageBg: "#000000", selectedBg: "#000000", toolErrorBg: "#000000", toolPendingBg: "#000000", toolSuccessBg: "#000000", userMessageBg: "#000000",
} as const satisfies ConstructorParameters<typeof Theme>[1]
const theme = new Theme(TEST_FG_COLORS, TEST_BG_COLORS, "truecolor")
function entry(data: unknown): CustomEntry<unknown> {
  return { type: "custom", id: "entry-1", parentId: null, timestamp: new Date(0).toISOString(), customType: "test", data }
}

describe("memorian nudged provenance", () => {
  test("#given a steer provenance #when rendered #then the via line is shown", () => {
    const component = renderMemorianNudgedEntry(entry({ version: 1, nudges: [{ path: "a.md", hint: "Use it." }], via: "steer" }), { expanded: false }, theme)
    expect(component?.render(120).join("\n")).toContain("via steer")
  })

  test("#given an unknown provenance #when rendered #then no via line is shown", () => {
    const component = renderMemorianNudgedEntry(entry({ version: 1, nudges: [{ path: "a.md", hint: "Use it." }], via: "bogus" }), { expanded: false }, theme)
    expect(component?.render(120).join("\n")).not.toContain("via bogus")
    expect(component?.render(120).join("\n")).not.toContain("via ")
  })
})
