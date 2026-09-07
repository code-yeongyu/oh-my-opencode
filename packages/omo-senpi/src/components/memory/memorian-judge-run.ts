import { mkdir, writeFile } from "@oh-my-opencode/memory-core/fs"
import type { RecallNudge } from "@oh-my-opencode/memory-core"
import type { ChildHandle } from "@oh-my-opencode/senpi-task"
import { join } from "node:path"

import { resolveAgentHome } from "../agent-home/resolve-agent-home"
import { abortAndDispose } from "./memorian-lifecycle"
import { classifyJudgeTurn, normalizeGateReason } from "./memorian-judge-outcome"
import { buildMemorianJudgeSpec } from "./memorian-judge-spec"
import { memorianCandidatesPayload, renderTranscriptWindow } from "./memorian-prompt"
import type {
  MemorianGateLaunchInput,
  MemorianGateLaunchResult,
  MemorianGateLaunchState,
  MemorianGateRunnerOptions,
} from "./memorian-runner"
import type { ReflectionModelResolution } from "./worker/resolve-model"

export type MemorianJudgeRunHost = {
  readonly options: MemorianGateRunnerOptions
  readonly deadlineMs: number
  handle: ChildHandle | undefined
  state: MemorianGateLaunchState | undefined
}

/**
 * Run the judge as an in-process child session and await its single turn. The absolute deadline
 * replaces SIGTERM/SIGKILL escalation: an abort timer fires handle.abort() and the race resolves
 * the launch immediately, never waiting for a turn that will not settle.
 */
export async function runMemorianJudge(
  host: MemorianJudgeRunHost,
  input: MemorianGateLaunchInput,
  resolution: Extract<ReflectionModelResolution, { readonly kind: "resolved" }>,
  runId: string,
  accepted: RecallNudge[],
  state: MemorianGateLaunchState,
): Promise<{ readonly status: "completed"; readonly partial?: true } | Extract<MemorianGateLaunchResult, { readonly status: "failed" | "dropped" }>> {
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined
  let deadlineReached = false
  const deadline = new Promise<"deadline">((resolve) => {
    deadlineTimer = setTimeout(() => {
      deadlineReached = true
      resolve("deadline")
    }, Math.max(0, host.deadlineMs))
    deadlineTimer.unref?.()
  })
  const setup = (async (): Promise<ChildHandle> => {
    const runDir = join(host.options.identityPaths.recall, "runs", runId)
    await mkdir(runDir, { recursive: true, mode: 0o700 })
    // Auditable artifacts, NOT inputs: the child receives both inline in its prompt and holds no
    // read tool. The run dir is kept after the run so a live or finished judge can be inspected.
    await Promise.all([
      writeFile(join(runDir, "candidates.json"), `${JSON.stringify(memorianCandidatesPayload(input), null, 2)}\n`, { encoding: "utf8", mode: 0o600 }),
      writeFile(join(runDir, "transcript-window.txt"), renderTranscriptWindow(input.transcript), { encoding: "utf8", mode: 0o600 }),
    ])

    const taskRuntime = await import("#omo-task-runtime")
    const runner = host.options.createRunner?.(
      host.options.createSession === undefined ? {} : { createSession: host.options.createSession },
    ) ?? taskRuntime.createInProcessJudgeRunner(
      host.options.createSession === undefined ? {} : { createSession: host.options.createSession },
    )
    return runner.start(buildMemorianJudgeSpec({ launch: input, runId, runDir, agentDir: resolveAgentHome({ env: host.options.env }), model: input.modelRegistry === undefined ? undefined : taskRuntime.findModelReference(input.modelRegistry, resolution.model), ...(resolution.thinking === undefined ? {} : { thinkingLevel: resolution.thinking }), accepted }))
  })()
  const setupResult = setup.then(
    async (handle) => {
      if (deadlineReached || state.cancelled) {
        await abortAndDispose(handle, host.options.logger, runId)
        return undefined
      }
      host.handle = handle
      host.state = state
      return handle
    },
    (error: unknown) => {
      if (deadlineReached || state.cancelled) return undefined
      throw error
    },
  )
  try {
    const settled = await Promise.race([setupResult, deadline])
    if (settled === "deadline" || settled === undefined) {
      const handle = host.handle
      if (handle !== undefined) await abortAndDispose(handle, host.options.logger, runId)
      if (state.cancelled && settled === undefined) {
        return { status: "dropped", cause: "cancelled", runId, candidateCount: input.candidates.length }
      }
      host.options.logger?.warn("memorian gate deadline exceeded", { runId, salvaged: accepted.length })
      if (accepted.length > 0) return { status: "completed", partial: true }
      state.cancelled = true
      return { status: "failed", cause: "deadline", model: resolution.model, candidateCount: input.candidates.length, runId }
    }
    const turn = await Promise.race([settled.waitForIdle(), deadline])
    if (turn === "deadline") {
      host.options.logger?.warn("memorian gate deadline exceeded", { runId, salvaged: accepted.length })
      await abortAndDispose(settled, host.options.logger, runId)
      if (accepted.length > 0) return { status: "completed", partial: true }
      return { status: "failed", cause: "deadline", model: resolution.model, candidateCount: input.candidates.length, runId }
    }
    const classification = classifyJudgeTurn(turn)
    if (classification.status === "failed") {
      const reason = normalizeGateReason(classification.reason)
      host.options.logger?.warn("memorian gate child failed", { runId, cause: "child_failed", reason })
      return { status: "failed", cause: "child_failed", reason, runId, model: resolution.model, candidateCount: input.candidates.length }
    }
    if (classification.status === "dropped") return { status: "dropped", cause: "cancelled", runId, candidateCount: input.candidates.length }
    return { status: "completed" }
  } catch (error) {
    host.options.logger?.warn("memorian gate child session creation failed", { error: normalizeGateReason(describe(error)), runId })
    return { status: "failed", cause: "session_create_failed", reason: normalizeGateReason(describe(error)), runId, model: resolution.model, candidateCount: input.candidates.length }
  } finally {
    const handle = (clearTimeout(deadlineTimer), host.handle)
    if (handle !== undefined) {
      host.handle = undefined
      handle.dispose()
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
