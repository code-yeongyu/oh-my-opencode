import type { AgentConfig } from "@opencode-ai/sdk"
import { smartAgent } from "./smart"
import { oracleAgent } from "./oracle"
import { librarianAgent } from "./librarian"
import { exploreAgent } from "./explore"
import { frontendUiUxEngineerAgent } from "./frontend-ui-ux-engineer"
import { documentWriterAgent } from "./document-writer"
import { multimodalLookerAgent } from "./multimodal-looker"

export const builtinAgents: Record<string, AgentConfig> = {
  smart: smartAgent,
  oracle: oracleAgent,
  librarian: librarianAgent,
  explore: exploreAgent,
  "frontend-ui-ux-engineer": frontendUiUxEngineerAgent,
  "document-writer": documentWriterAgent,
  "multimodal-looker": multimodalLookerAgent,
}

export * from "./types"
export { createBuiltinAgents } from "./utils"
export { BUILD_AGENT_PROMPT_EXTENSION } from "./build"
