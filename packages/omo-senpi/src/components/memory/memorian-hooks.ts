import type { ComponentLogger, SenpiExtensionAPI } from "../../extension/types"
import type { MemoryIdentityContext } from "./context"
import { branchEntryCount } from "./wiring-context"
import type { MemorianDelivery } from "./memorian-delivery"
import type { MemorianTrigger } from "./memorian-trigger"

export interface MemorianHooksOptions {
  readonly trigger: Pick<MemorianTrigger, "onToolCall" | "onSettled">
  readonly delivery: Pick<MemorianDelivery, "onToolResult">
  readonly resolveContext: (sessionId: string) => MemoryIdentityContext | undefined
  readonly resolveSessionId: (eventCtx: unknown) => string | undefined
  readonly logger?: ComponentLogger
  readonly registerSettle?: boolean
}

export function registerMemorianHooks(pi: SenpiExtensionAPI, options: MemorianHooksOptions): void {
  pi.on("tool_call", (payload, eventCtx) => {
    try {
      options.trigger.onToolCall(payload, eventCtx)
    } catch (error: unknown) {
      options.logger?.warn("omo-senpi memorian tool_call trigger failed", { error: describe(error) })
    }
    return undefined
  })

  pi.on("tool_result", async (_payload, eventCtx) => {
    try {
      const sessionId = options.resolveSessionId(eventCtx)
      const context = sessionId === undefined ? undefined : options.resolveContext(sessionId)
      if (sessionId !== undefined && context !== undefined) {
        await options.delivery.onToolResult(sessionId, context, eventCtx)
      }
    } catch (error: unknown) {
      options.logger?.warn("omo-senpi memorian tool_result delivery failed", { error: describe(error) })
    }
    return undefined
  })
  if (options.registerSettle !== false) {
    pi.on("agent_settled", (_payload, eventCtx) => {
      if (branchEntryCount(eventCtx) > 0) options.trigger.onSettled(eventCtx)
      return undefined
    })
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
