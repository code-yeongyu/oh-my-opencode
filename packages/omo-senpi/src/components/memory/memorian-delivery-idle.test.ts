import { describe, expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { buildIdentityPaths, PendingNudges, RecallLedger, type RecallNudge } from "@oh-my-opencode/memory-core"

import { IdleInjectionCoordinator } from "../../extension/idle-injection-coordinator"
import { createMemoryIdentityContext } from "./context"
import { createMemoryBinding } from "./binding"
import { createMemorianDelivery } from "./memorian-delivery"

const SESSION_ID = "idle-session"
const NUDGE: RecallNudge = { path: "reference/idle.md", hint: "Use the idle wake path." }

async function fixture(): Promise<{ context: ReturnType<typeof createMemoryIdentityContext>; ledger: RecallLedger; pending: PendingNudges }> {
  const dir = join(tmpdir(), `memorian-idle-${crypto.randomUUID()}`)
  await mkdir(dir, { recursive: true })
  const context = createMemoryIdentityContext({ identity: "idle-agent", identityPaths: buildIdentityPaths(join(dir, "memory"), "idle-agent"), binding: createMemoryBinding({ identity: "idle-agent", repoPath: dir, boundAt: 0 }) })
  return { context, ledger: new RecallLedger(context.identityPaths.recallLedger), pending: new PendingNudges(context.identityPaths.recallPending) }
}

describe("memorian delivery idle lifecycle", () => {
  test("#given only a passive memorian entry #when idle flushes #then it does not deliver", async () => {
    const f = await fixture()
    const delivered: string[] = []
    let wakeEntry: unknown
    let wakeEntryReady: (() => void) | undefined
    const wakeReady = new Promise<void>((resolve) => { wakeEntryReady = resolve })
    const coordinator = new IdleInjectionCoordinator((message) => delivered.push(message.content))
    const delivery = createMemorianDelivery({ ledgerFor: () => f.ledger, pendingFor: () => f.pending, coordinator, sendMessage: () => undefined, appendEntry: (_customType, data) => { wakeEntry = data; wakeEntryReady?.() } })
    await delivery.accept(SESSION_ID, f.context, [NUDGE], 0)
    expect(coordinator.flushOnIdle()).toBe(0)
    expect(delivered).toEqual([])
    coordinator.enqueue({ key: "task-completion:1", source: "task-completion", content: "done" })
    expect(coordinator.flushOnIdle()).toBe(2)
    await wakeReady
    await Promise.resolve()
    expect(delivered).toHaveLength(1)
    expect(delivered[0]).toContain(NUDGE.hint)
    expect(delivered[0]).toContain("done")
    expect(wakeEntry).toEqual({ version: 1, nudges: [NUDGE], via: "wake" })
    expect(coordinator.pendingCount()).toBe(0)
    expect(delivery.drainForPrompt(SESSION_ID, f.context)).toEqual([])
    await expect(f.pending.take(SESSION_ID, { currentEpoch: 0 })).resolves.toEqual([])
  })

  test("#given accepted nudges #when compaction is accepted #then state, coordinator, and pending file are cleared", async () => {
    const f = await fixture()
    const coordinator = new IdleInjectionCoordinator(() => undefined)
    const delivery = createMemorianDelivery({ ledgerFor: () => f.ledger, pendingFor: () => f.pending, coordinator, sendMessage: () => undefined, appendEntry: () => undefined })
    await delivery.accept(SESSION_ID, f.context, [NUDGE], 0)
    await delivery.onCompactionAccepted(SESSION_ID, f.context)
    await delivery.onToolResult(SESSION_ID, f.context, { hasPendingMessages: () => false, isIdle: () => false })
    expect(coordinator.remove(`memorian:${NUDGE.path}`)).toBe(false)
    await expect(f.pending.take(SESSION_ID, { currentEpoch: 0 })).resolves.toEqual([])
  })

  test("#given accepted nudges #when session shuts down #then only in-memory wake state is cleared", async () => {
    const f = await fixture()
    const coordinator = new IdleInjectionCoordinator(() => undefined)
    const delivery = createMemorianDelivery({ ledgerFor: () => f.ledger, pendingFor: () => f.pending, coordinator, sendMessage: () => undefined, appendEntry: () => undefined })
    await delivery.accept(SESSION_ID, f.context, [NUDGE], 0)
    delivery.onSessionShutdown(SESSION_ID)
    await delivery.onToolResult(SESSION_ID, f.context, { hasPendingMessages: () => false, isIdle: () => false })
    expect(coordinator.remove(`memorian:${NUDGE.path}`)).toBe(false)
    await expect(f.pending.take(SESSION_ID, { currentEpoch: 0 })).resolves.toEqual([NUDGE])
  })
})
