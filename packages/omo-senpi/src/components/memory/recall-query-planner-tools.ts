import { basename } from "node:path"

import { containsSecretLikeMaterial } from "@oh-my-opencode/memory-core"

const TOOL_ARG_WINDOW = 8
const MAX_TOKENS = 32
const PATH_KEYS = new Set(["path", "filePath", "file_path", "target", "file", "pattern", "query", "command"])
const ARRAY_KEYS = new Set(["paths", "files"])
const PATH_LIKE = /\/|\.[a-z0-9]{1,6}$/i

function isUsable(value: string): boolean {
  return value.length > 0 && value.length <= 120 && !containsSecretLikeMaterial(value)
}

function pathWords(value: string): string[] {
  const name = basename(value)
  return [name, ...name.split(/[-_.]/).filter((word) => word.length >= 3)]
}

function shellTokens(command: string): string[] {
  return command.split(/\s+/).map((token) => token.replace(/^['"]|['"]$/g, "")).filter(Boolean)
}

function commandTexts(command: string): string[] {
  const result: string[] = []
  for (const segment of command.split(/\||&&|;/)) {
    const tokens = shellTokens(segment)
    const first = tokens.find((token) => !token.startsWith("-"))
    if (first !== undefined) result.push(first)
    for (const token of tokens) {
      if (PATH_LIKE.test(token) && !token.startsWith("-")) result.push(...pathWords(token))
    }
  }
  return result
}

export function toolArgTexts(toolName: string, input: Record<string, unknown>): string[] {
  void toolName
  const result: string[] = []
  for (const [key, value] of Object.entries(input)) {
    if (key === "command" && typeof value === "string") {
      if (isUsable(value)) result.push(...commandTexts(value))
      continue
    }
    if (PATH_KEYS.has(key) && typeof value === "string" && isUsable(value)) {
      result.push(...(PATH_LIKE.test(value) ? pathWords(value) : [value]))
      continue
    }
    if (ARRAY_KEYS.has(key) && Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string" && isUsable(item)) result.push(...(PATH_LIKE.test(item) ? pathWords(item) : [item]))
      }
    }
  }
  return result.slice(0, MAX_TOKENS)
}

export class ToolArgWindow {
  private readonly sessions = new Map<string, string[][]>()

  push(sessionId: string, texts: string[]): void {
    const pushes = this.sessions.get(sessionId) ?? []
    pushes.push(texts)
    if (pushes.length > TOOL_ARG_WINDOW) pushes.splice(0, pushes.length - TOOL_ARG_WINDOW)
    this.sessions.set(sessionId, pushes)
  }

  texts(sessionId: string): string[] {
    return (this.sessions.get(sessionId) ?? []).flat()
  }

  clear(sessionId: string): void {
    this.sessions.delete(sessionId)
  }
}
