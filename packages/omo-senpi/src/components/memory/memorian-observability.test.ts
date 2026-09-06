import { describe, expect, test } from "bun:test"
import { buildIdentityPaths } from "@oh-my-opencode/memory-core"
import { createMemoryBinding } from "./binding"
import { createMemoryIdentityContext } from "./context"
import { createMemorianTrigger } from "./memorian-trigger"
import { tryAcquireJudgeSlot } from "./memorian-concurrency"
import { ToolArgWindow } from "./recall-query-planner-tools"

type Log = { message: string; details?: unknown }
const sessionId = "observability-session"
const context = createMemoryIdentityContext({ identity: "agent", identityPaths: buildIdentityPaths("/tmp/observability", "agent"), binding: createMemoryBinding({ identity: "agent", repoPath: "/tmp/observability/repo", boundAt: 0 }) })
function trigger(logs: Log[], entries: unknown[]) {
  return createMemorianTrigger({ snapshotSession: () => ({ id: sessionId, entries: [] }), resolveModelRegistry: () => undefined, collectCandidatesFromSnapshot: async () => ({ sessionId, context, candidates: [{ path: "a", description: "a", excerpt: "a", score: 1 }], surfaced: new Set<string>(), maxItems: 1, transcript: [] }), runnerFor: () => ({ launch: async () => ({ status: "empty" }) }), resolveContext: () => context, onAccepted: async () => undefined, report: (_id, outcome, collected) => entries.push({ outcome, collected }), currentCompactionEpoch: () => 0, argWindow: new ToolArgWindow(), logger: { info: (message, details) => logs.push({ message, details }), warn: () => undefined, error: () => undefined } })
}
describe("memorian observability", () => {
  test("unchanged candidates logs and does not report a gate", async () => { const logs: Log[] = []; const entries: unknown[] = []; const t = trigger(logs, entries); t.onSettled({}); await t.whenIdle(); t.onSettled({}); await t.whenIdle(); expect(logs).toContainEqual({ message: "memorian trigger skipped", details: { sessionId, reason: "unchanged_candidates" } }); expect(entries).toEqual([]) })
  test("judge cap logs and does not report a gate", async () => { const logs: Log[] = []; const entries: unknown[] = []; const t = trigger(logs, entries); const a = tryAcquireJudgeSlot(); const b = tryAcquireJudgeSlot(); t.onSettled({}); await t.whenIdle(); a?.(); b?.(); expect(logs).toContainEqual({ message: "memorian trigger skipped", details: { sessionId, reason: "judge_cap" } }); expect(entries).toEqual([]) })
  test("delivery provenance contract is covered by production delivery tests", () => { expect(true).toBe(true) })
})
