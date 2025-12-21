import { LANGUAGE_PATTERNS } from "./constants"
import type { LanguageCode } from "./types"

export function detectLanguageFromPrompt(text: string): LanguageCode | null {
  for (const { pattern, language } of LANGUAGE_PATTERNS) {
    if (pattern.test(text)) {
      return language
    }
  }
  return null
}

export function extractPromptText(parts: Array<{ type: string; text?: string }>): string {
  return parts
    .filter((p) => p.type === "text" && p.text)
    .map((p) => p.text!)
    .join(" ")
}
