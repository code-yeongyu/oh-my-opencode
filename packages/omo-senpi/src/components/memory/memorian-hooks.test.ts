import { describe, expect, test } from "bun:test"

import { buildIdentityPaths } from "@oh-my-opencode/memory-core"
import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { createMemoryIdentityContext } from "./context"
import { registerMemorianHooks } from "./memorian-hooks"

const identity = createMemoryIdentityContext({
  identity: "agent",
  identityPaths: buildIdentityPaths("/tmp/omo-memorian-hooks", "agent"),
  binding: { identity: "agent", repoPathHash: "hash", boundAt: 0 },
})

function context(sessionId: string, entries: readonly unknown[] = []): Record<string, unknown> {
  return {
    sessionManager: {
      getSessionId: () => sessionId,
      getEntries: () => entries,
    },
    hasPendingMessages: () => false,
    isIdle: () => false,
  }
}

describe("registerMemorianHooks", () => {
  test("#given a tool call #when dispatched #then the trigger receives it synchronously", async () => {
    const pi = new FakeExtensionAPI()
    const calls: unknown[][] = []
    const eventCtx = context("session-tool-call")
    registerMemorianHooks(pi, {
      trigger: {
        onToolCall: (payload, ctx) => { calls.push([payload, ctx]) },
        onSettled: () => {},
      },
      delivery: {
        onToolResult: async () => {},
      },
      resolveContext: () => undefined,
      resolveSessionId: () => "session-tool-call",
    })

    const payload = { toolName: "read", input: { path: "README.md" } }
    const result = await pi.dispatch("tool_call", payload, eventCtx)

    expect(calls).toEqual([[payload, eventCtx]])
    expect(result).toEqual([undefined])
  })

  test("#given a tool result #when dispatched #then delivery receives the session id and event context", async () => {
    const pi = new FakeExtensionAPI()
    const calls: unknown[][] = []
    const eventCtx = context("session-tool-result")
    registerMemorianHooks(pi, {
      trigger: {
        onToolCall: () => {},
        onSettled: () => {},
      },
      delivery: {
        onToolResult: async (...args) => { calls.push(args) },
      },
      resolveContext: () => identity,
      resolveSessionId: () => "session-tool-result",
    })

    const result = await pi.dispatch("tool_result", { toolName: "read" }, eventCtx)

    expect(calls).toHaveLength(1)
    expect(calls[0]?.[0]).toBe("session-tool-result")
    expect(calls[0]?.[1]).toBe(identity)
    expect(calls[0]?.[2]).toBe(eventCtx)
    expect(result).toEqual([undefined])
  })

  test("#given text-only and empty sessions #when agent_settled dispatches #then only the non-empty branch settles", async () => {
    const pi = new FakeExtensionAPI()
    const settled: unknown[] = []
    registerMemorianHooks(pi, {
      trigger: { onToolCall: () => {}, onSettled: (eventCtx) => { settled.push(eventCtx) } },
      delivery: { onToolResult: async () => {} },
      resolveContext: () => undefined,
      resolveSessionId: () => undefined,
    })

    await pi.dispatch("agent_settled", {}, context("text-only", [
      { type: "message", message: { role: "user", content: "hello" } },
      { type: "message", message: { role: "assistant", content: "hi" } },
    ]))
    await pi.dispatch("agent_settled", {}, context("empty"))

    expect(settled).toHaveLength(1)
  })

  test("#given a trigger that throws #when tool_call dispatches #then it returns undefined and warns", async () => {
    const pi = new FakeExtensionAPI()
    const warnings: unknown[][] = []
    registerMemorianHooks(pi, {
      trigger: {
        onToolCall: () => { throw new Error("boom") },
        onSettled: () => {},
      },
      delivery: { onToolResult: async () => {} },
      resolveContext: () => undefined,
      resolveSessionId: () => undefined,
      logger: { warn: (...args) => { warnings.push(args) }, info: () => {}, error: () => {} },
    })

    const result = await pi.dispatch("tool_call", {}, context("session-warning"))

    expect(result).toEqual([undefined])
    expect(warnings).toHaveLength(1)
  })
})
