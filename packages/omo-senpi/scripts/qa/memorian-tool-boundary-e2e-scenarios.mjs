#!/usr/bin/env bun
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { open as fsOpen } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

import { digestDirectory } from "./drive.mjs"
import { startMockCompletionsServer } from "./mock-completions-server.mjs"
import {
  JUDGE_TIMEOUT_MS, NUDGE_TOOL, SEED_BODY, SEED_PATH, TURN_1_PROMPT, TURN_2_PROMPT,
  assertSandboxEnv, assertUnchangedFor, childTranscript, createRouter, getState, identityDirs,
  lastAssistant, launchRpc, pendingFiles, prepareSandbox, prompt, readEntries, recallRuns,
  sandboxEnv, seedMemoryRepo, teardown, waitUntil, writeOmoConfig,
} from "./memorian-e2e-support.mjs"

const SECOND_FILE = "other-notes.md"
const ROLLOUT_FILE = "rollout-notes.md"

export function record(checks, name, ok, detail) {
  checks.push({ name, ok, detail })
  console.log(`${ok ? "PASS" : "FAIL"} ${name} :: ${detail}`)
}

export const isRecall = (entry) => entry.type === "custom_message" && entry.customType === "omo-memorian:recall"
export const isNudged = (entry) => entry.type === "custom" && entry.customType === "omo-memorian:nudged"
export const isAssistant = (entry) => entry.type === "message" && entry.message?.role === "assistant"
export const isToolResult = (entry) => entry.type === "message" && entry.message?.role === "toolResult"

export function assistantToolCallIndexes(entries) {
  return entries.flatMap((entry, index) => (isAssistant(entry) && Array.isArray(entry.message?.content) && entry.message.content.some((block) => block?.type === "toolCall") ? [index] : []))
}

export function countsOf(entries, router, pendingPresent) {
  return {
    parentRequests: router.state.parent,
    judgeRequests: router.state.judge,
    assistantMessages: entries.filter(isAssistant).length,
    recallMessages: entries.filter(isRecall).length,
    nudgedEntries: entries.filter(isNudged).length,
    pendingFilePresent: pendingPresent,
  }
}

function judgeSteps(holdUntilParent) {
  return [
    { type: "tool_call", name: NUDGE_TOOL, arguments: { path: SEED_PATH, hint: SEED_BODY }, ...(holdUntilParent === undefined ? {} : { releaseWhen: holdUntilParent }) },
    { type: "text", text: "" },
  ]
}

async function withHarness(options, { parentSteps, holdJudge, fifo, requestLogPath }, run) {
  const cleanup = []
  const router = createRouter({ judgeSteps: judgeSteps(holdJudge === true ? () => router.state.parent >= 2 : undefined) })
  const server = startMockCompletionsServer({ steps: router.steps, requestLogPath, classifyRequest: router.classify })
  const baseUrl = await server.ready
  const sandbox = prepareSandbox(options.pluginRoot, baseUrl)
  writeFileSync(join(sandbox.cwd, SECOND_FILE), "unrelated notes\n")
  if (fifo) {
    const made = spawnSync("mkfifo", [join(sandbox.cwd, ROLLOUT_FILE)], { encoding: "utf8" })
    if (made.status !== 0) throw new Error(`mkfifo failed: ${made.stderr}`)
  } else writeFileSync(join(sandbox.cwd, ROLLOUT_FILE), "notes about a rollout\n")
  const env = sandboxEnv(sandbox)
  assertSandboxEnv(sandbox, env)
  const beforeSenpi = digestDirectory(join(homedir(), ".senpi", "agent"))
  let session
  try {
    const seed = await seedMemoryRepo(options, sandbox, env, router)
    if (seed.status !== 0) throw new Error(`seed turn exited ${seed.status}: ${seed.stderr.slice(-400)}`)
    if (identityDirs(sandbox.memoryHome).map((dir) => join(dir, "repo", SEED_PATH)).filter(existsSync).length !== 1) throw new Error(`seed missing ${SEED_PATH}`)
    writeOmoConfig(sandbox, true)
    router.setParentSteps(parentSteps)
    session = launchRpc(options.senpiCli, sandbox, env)
    const state = await getState(session)
    if (typeof state.sessionFile !== "string") throw new Error("sessionFile missing")
    const facts = await run({ sandbox, session, state, router })
    facts.sessionText = readFileSync(state.sessionFile, "utf8")
    facts.realSenpiUntouched = beforeSenpi === digestDirectory(join(homedir(), ".senpi", "agent"))
    return facts
  } finally {
    if (session !== undefined) cleanup.push(await teardown(session))
    server.close()
    cleanup.push("server closed")
    if (options.keepSandbox) cleanup.push(`sandbox KEPT: ${sandbox.root}`)
    else {
      rmSync(sandbox.root, { recursive: true, force: true })
      cleanup.push(existsSync(sandbox.root) ? `sandbox NOT removed: ${sandbox.root}` : "sandbox removed")
    }
    console.log(`cleanup: ${cleanup.join(", ")}`)
  }
}

async function releaseFifoAfterAccept(sandbox, sessionId, sessionFile) {
  try {
    await waitUntil(
      () => pendingFiles(sandbox.memoryHome, sessionId).length > 0 || readEntries(sessionFile).some(isNudged) || undefined,
      { timeoutMs: JUDGE_TIMEOUT_MS, description: "judge accepted (pending or nudged)" },
    )
  } finally {
    const handle = await fsOpen(join(sandbox.cwd, ROLLOUT_FILE), "w")
    await handle.close()
  }
}

function midTurnRecallOk(entries) {
  const toolResults = entries.flatMap((entry, index) => (isToolResult(entry) ? [index] : []))
  const recalls = entries.flatMap((entry, index) => (isRecall(entry) ? [index] : []))
  const toolCalls = assistantToolCallIndexes(entries)
  return toolResults[0] !== undefined && recalls[0] !== undefined && toolCalls[1] !== undefined && toolResults[0] < recalls[0] && recalls[0] < toolCalls[1]
}

function finish(checks, prefix, facts) {
  record(checks, `${prefix}.realSenpiUntouched`, facts.realSenpiUntouched === true, `realSenpiUntouched=${facts.realSenpiUntouched}`)
  return { result: checks.some((check) => check.name.startsWith(`${prefix}.`) && !check.ok) ? "FAIL" : "PASS", ...facts }
}

const readRollout = { type: "tool_call", name: "read", arguments: { path: ROLLOUT_FILE } }
const readSecond = { type: "tool_call", name: "read", arguments: { path: SECOND_FILE } }
const textDone = { type: "text", text: "done" }
const textTurn2 = { type: "text", text: "you're welcome" }

export async function runS3(options, checks, requestLogPath) {
  return finish(checks, "s3", await withHarness(options, { parentSteps: [readRollout, readSecond, textDone], fifo: true, requestLogPath }, async ({ sandbox, session, state, router }) => {
    const pending = prompt(session, TURN_1_PROMPT, 120_000)
    try {
      await releaseFifoAfterAccept(sandbox, state.sessionId, state.sessionFile)
      record(checks, "s3.judge-accepted", true, "pending or nudged before first tool result")
    } catch (error) {
      record(checks, "s3.judge-accepted", false, error instanceof Error ? error.message : String(error))
    }
    await pending
    const entries = readEntries(state.sessionFile)
    const pendingPresent = pendingFiles(sandbox.memoryHome, state.sessionId).length > 0
    const counts = countsOf(entries, router, pendingPresent)
    const nudged = entries.filter(isNudged)
    record(checks, "s3.mid-turn-recall", midTurnRecallOk(entries), "recall after first tool result and before second tool call")
    record(checks, "s3.nudged-steer", nudged.length === 1 && nudged[0]?.data?.via === "steer", `count=${nudged.length} via=${nudged[0]?.data?.via}`)
    record(checks, "s3.parent-requests", counts.parentRequests === 3, `parentRequests=${counts.parentRequests}`)
    record(checks, "s3.pending-absent", pendingPresent === false, `pending=${pendingPresent}`)
    return { counts, entries }
  }))
}

export async function runS4(options, checks, requestLogPath) {
  return finish(checks, "s4", await withHarness(options, { parentSteps: [readRollout, textDone, textTurn2], holdJudge: true, requestLogPath }, async ({ sandbox, session, state, router }) => {
    await prompt(session, TURN_1_PROMPT)
    const turn1 = readEntries(state.sessionFile)
    record(checks, "s4.turn1-parent-requests", router.state.parent === 2, `parentRequests=${router.state.parent}`)
    record(checks, "s4.turn1-no-recall", turn1.filter(isRecall).length === 0, `recall=${turn1.filter(isRecall).length}`)
    await waitUntil(
      () => pendingFiles(sandbox.memoryHome, state.sessionId).length > 0 || readEntries(state.sessionFile).some(isNudged) || undefined,
      { timeoutMs: JUDGE_TIMEOUT_MS, description: "s4 judge accepted" },
    )
    await prompt(session, TURN_2_PROMPT)
    const entries = readEntries(state.sessionFile)
    const counts = countsOf(entries, router, pendingFiles(sandbox.memoryHome, state.sessionId).length > 0)
    const nudged = entries.filter(isNudged)
    record(checks, "s4.turn2-recall", counts.recallMessages === 1, `recallMessages=${counts.recallMessages}`)
    record(checks, "s4.nudged-prompt", nudged.length === 1 && nudged[0]?.data?.via === "prompt", `count=${nudged.length} via=${nudged[0]?.data?.via}`)
    record(checks, "s4.parent-requests-total", counts.parentRequests === 3, `parentRequests=${counts.parentRequests}`)
    return { counts, entries }
  }))
}

export async function runS5(options, checks, requestLogPath) {
  return finish(checks, "s5", await withHarness(options, { parentSteps: [readRollout, textDone], holdJudge: true, requestLogPath }, async ({ sandbox, session, state, router }) => {
    await prompt(session, TURN_1_PROMPT)
    await waitUntil(() => pendingFiles(sandbox.memoryHome, state.sessionId).length > 0 || undefined, { timeoutMs: JUDGE_TIMEOUT_MS, description: "s5 nudge accepted" })
    await waitUntil(() => {
      const run = recallRuns(sandbox.memoryHome)[0]
      const transcript = run === undefined ? undefined : childTranscript(run.dir)
      return transcript !== undefined && lastAssistant(transcript.messages)?.stopReason === "stop" ? transcript : undefined
    }, { timeoutMs: JUDGE_TIMEOUT_MS, description: "s5 child transcript finished" })
    const sample = () => ({ parentRequests: router.state.parent, assistantMessages: readEntries(state.sessionFile).filter(isAssistant).length })
    const before = sample()
    record(checks, "s5.parent-before", before.parentRequests === 2, `parentRequestsBefore=${before.parentRequests}`)
    const unchanged = await assertUnchangedFor(sample, { durationMs: 5000, intervalMs: 200, description: "s5 idle parent" }).then(() => true, (error) => { record(checks, "s5.idle-unchanged", false, error.message); return false })
    if (unchanged) record(checks, "s5.idle-unchanged", true, "parent requests and assistant messages held for 5s")
    const after = sample()
    const entries = readEntries(state.sessionFile)
    const counts = { ...countsOf(entries, router, pendingFiles(sandbox.memoryHome, state.sessionId).length > 0), parentRequestsBefore: before.parentRequests, parentRequestsAfter: after.parentRequests, assistantMessagesBefore: before.assistantMessages, assistantMessagesAfter: after.assistantMessages }
    return { counts, entries }
  }))
}
