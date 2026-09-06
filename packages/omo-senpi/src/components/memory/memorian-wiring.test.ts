import { describe, expect, test } from "bun:test"

import { buildIdentityPaths } from "@oh-my-opencode/memory-core"
import { createMemoryIdentityContext } from "./context"
import { createMemorianGateWiring } from "./memorian-wiring"

const context = createMemoryIdentityContext({
  identity: "agent",
  identityPaths: buildIdentityPaths("/tmp/omo-memorian-wiring", "agent"),
  binding: { identity: "agent", repoPathHash: "hash", boundAt: 0 },
})
const collected = { sessionId: "session-1", context, candidates: [], surfaced: new Set<string>(), maxItems: 2, transcript: [] }

describe("createMemorianGateWiring", () => {
  test("#given skipped outcomes #when reported repeatedly #then one gate entry is appended per session and cause", () => {
    const entries: Array<{ customType: string; data: unknown }> = []
    const gate = createMemorianGateWiring({ resolveContext: () => context, runnerFor: () => ({ launch: async () => ({ status: "empty" }) }) })
    gate.attachEntrySink((customType, data) => entries.push({ customType, data }))

    gate.reportOutcome("session-1", { status: "skipped", cause: "quick_unavailable" }, collected)
    gate.reportOutcome("session-1", { status: "skipped", cause: "quick_unavailable" }, collected)
    gate.reportOutcome("session-1", { status: "failed", cause: "child_failed", reason: "broken" }, collected)

    expect(entries).toHaveLength(2)
    expect(entries[0]?.data).toEqual({ version: 1, status: "skipped", cause: "quick_unavailable", candidateCount: 0 })
  })

  test("#given a session epoch #when compaction is accepted #then the epoch increments and shutdown drains the runner", async () => {
    let cancelled = 0
    let idle = 0
    const gate = createMemorianGateWiring({
      resolveContext: () => context,
      runnerFor: () => ({
        launch: async () => ({ status: "empty" }),
        cancel: async () => { cancelled += 1 },
        whenIdle: async () => { idle += 1 },
      }),
    })

    expect(gate.currentCompactionEpoch("session-1")).toBe(0)
    gate.onCompactionAccepted("session-1")
    expect(gate.currentCompactionEpoch("session-1")).toBe(1)
    await gate.onSessionShutdown("session-1")

    expect({ cancelled, idle }).toEqual({ cancelled: 1, idle: 1 })
    expect(gate.currentCompactionEpoch("session-1")).toBe(0)
  })
})
