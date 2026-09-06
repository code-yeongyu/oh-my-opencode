import { afterEach, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { PendingNudges } from "@oh-my-opencode/memory-core"
import { CANDIDATE_PATH, collected, context, gate, roots, SESSION_ID } from "./memorian-wiring.test-support"
import { rmEfaultTolerant } from "./teardown.test-support"

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rmEfaultTolerant(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }))) })

const NUDGES = [{ path: CANDIDATE_PATH, hint: "Drain nodes first." }]

describe("createMemorianGateWiring persist", () => {
  test("#given a gate child that returns nudged #when the settle task completes #then the pending file holds the nudges stamped with the launch epoch", async () => {
    const identity = await context()
    const wiring = gate({
      collect: async () => collected(identity),
      launches: [],
      identity,
      launch: async () => ({ status: "nudged" as const, nudges: NUDGES, runId: "run-nudged-1" }),
    })

    wiring.onSettled({})
    await wiring.whenIdle()

    expect(await new PendingNudges(identity.identityPaths.recallPending).take(SESSION_ID, { currentEpoch: 0 })).toEqual(NUDGES)
  })

  test("#given a compaction accepted before the nudged result lands #when the settle task completes #then no pending file is written and a warning is logged", async () => {
    const identity = await context()
    const logs: Array<{ message: string, details?: unknown }> = []
    const writes: unknown[] = []
    const wiring = gate({
      collect: async () => collected(identity),
      launches: [],
      identity,
      logs,
      launch: async () => {
        wiring.onCompactionAccepted(SESSION_ID)
        return { status: "nudged" as const, nudges: NUDGES, runId: "run-nudged-2" }
      },
      pendingFor: () => ({
        write: async (...args) => { writes.push(args) },
        delete: async () => undefined,
        take: async () => [],
      }),
    })

    wiring.onSettled({})
    await wiring.whenIdle()

    expect(writes).toEqual([])
    expect(logs.map((entry) => entry.message)).toContain("memorian gate nudges dropped after compaction")
  })

  test("#given a compaction accepted during the write #when the write completes #then the landed file is retracted", async () => {
    const identity = await context()
    const real = new PendingNudges(identity.identityPaths.recallPending)
    const ops: string[] = []
    const wiring = gate({
      collect: async () => collected(identity),
      launches: [],
      identity,
      launch: async () => ({ status: "nudged" as const, nudges: NUDGES, runId: "run-nudged-3" }),
      pendingFor: () => ({
        write: async (sessionId, nudges, options) => {
          ops.push("write")
          wiring.onCompactionAccepted(SESSION_ID)
          await real.write(sessionId, nudges, options)
        },
        delete: async (sessionId) => {
          ops.push("delete")
          await real.delete(sessionId)
        },
        take: async () => [],
      }),
    })

    wiring.onSettled({})
    await wiring.whenIdle()

    expect(ops).toEqual(["write", "delete"])
    expect(existsSync(join(identity.identityPaths.recallPending, `${SESSION_ID}.json`))).toBe(false)
    expect(await real.take(SESSION_ID, { currentEpoch: wiring.currentCompactionEpoch(SESSION_ID) })).toEqual([])
  })

  test("#given pendingFor.write rejecting #when a nudged result lands #then the failure is logged and nothing throws", async () => {
    const identity = await context()
    const logs: Array<{ message: string, details?: unknown }> = []
    const wiring = gate({
      collect: async () => collected(identity),
      launches: [],
      identity,
      logs,
      launch: async () => ({ status: "nudged" as const, nudges: NUDGES, runId: "run-nudged-4" }),
      pendingFor: () => ({
        write: async () => { throw new Error("pending write exploded") },
        delete: async () => undefined,
        take: async () => [],
      }),
    })

    wiring.onSettled({})
    await wiring.whenIdle()

    expect(logs.map((entry) => entry.message)).toEqual(["omo-senpi memorian gate failed"])
  })
})
