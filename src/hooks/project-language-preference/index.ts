import type { PluginInput } from "@opencode-ai/plugin"
import { detectLanguageFromPrompt, extractPromptText } from "./detector"
import { getProjectLanguage, setProjectLanguage } from "./storage"
import { LANGUAGE_NAMES } from "./constants"
import { log } from "../../shared"
import { injectHookMessage } from "../../features/hook-message-injector"

export * from "./types"
export * from "./constants"
export * from "./detector"
export * from "./storage"

interface ChatMessageInput {
  sessionID: string
  agent?: string
  model?: { providerID: string; modelID: string }
  messageID?: string
}

interface ChatMessageOutput {
  message: Record<string, unknown>
  parts: Array<{ type: string; text?: string; [key: string]: unknown }>
}

const sessionLanguageInjected = new Set<string>()

export function createProjectLanguagePreferenceHook(ctx: PluginInput) {
  const projectPath = ctx.directory

  return {
    "chat.message": async (
      input: ChatMessageInput,
      output: ChatMessageOutput
    ): Promise<void> => {
      const promptText = extractPromptText(output.parts)
      const detectedLanguage = detectLanguageFromPrompt(promptText)

      if (detectedLanguage) {
        const previousLanguage = getProjectLanguage(projectPath)
        setProjectLanguage(projectPath, detectedLanguage)

        if (previousLanguage !== detectedLanguage) {
          log(`Language preference updated: ${previousLanguage ?? "none"} -> ${detectedLanguage}`, {
            sessionID: input.sessionID,
            projectPath,
          })
        }
      }

      if (!sessionLanguageInjected.has(input.sessionID)) {
        const savedLanguage = getProjectLanguage(projectPath)
        if (savedLanguage) {
          sessionLanguageInjected.add(input.sessionID)

          const message = output.message as {
            agent?: string
            model?: { modelID?: string; providerID?: string }
            path?: { cwd?: string; root?: string }
            tools?: Record<string, boolean>
          }

          const languageName = LANGUAGE_NAMES[savedLanguage]
          const instruction = `[Project Language Preference]
This project has a saved language preference: ${languageName} (${savedLanguage})
Please respond in ${languageName} for this project.`

          const success = injectHookMessage(input.sessionID, instruction, {
            agent: message.agent,
            model: message.model,
            path: message.path,
            tools: message.tools,
          })

          if (success) {
            log(`Injected language preference: ${savedLanguage}`, {
              sessionID: input.sessionID,
              projectPath,
            })
          }
        }
      }
    },
  }
}
