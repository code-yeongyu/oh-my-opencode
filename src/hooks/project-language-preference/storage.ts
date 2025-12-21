import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { PREFERENCES_FILE } from "./constants"
import type { LanguageCode, ProjectPreferences } from "./types"

let cachedPreferences: ProjectPreferences | null = null

export function loadPreferences(): ProjectPreferences {
  if (cachedPreferences !== null) {
    return cachedPreferences
  }

  if (!existsSync(PREFERENCES_FILE)) {
    cachedPreferences = {}
    return cachedPreferences
  }

  try {
    const content = readFileSync(PREFERENCES_FILE, "utf-8")
    cachedPreferences = JSON.parse(content) as ProjectPreferences
    return cachedPreferences
  } catch {
    cachedPreferences = {}
    return cachedPreferences
  }
}

export function savePreferences(preferences: ProjectPreferences): void {
  const dir = dirname(PREFERENCES_FILE)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  writeFileSync(PREFERENCES_FILE, JSON.stringify(preferences, null, 2))
  cachedPreferences = preferences
}

export function getProjectLanguage(projectPath: string): LanguageCode | null {
  const preferences = loadPreferences()
  return preferences[projectPath]?.language ?? null
}

export function setProjectLanguage(projectPath: string, language: LanguageCode): void {
  const preferences = loadPreferences()
  preferences[projectPath] = {
    language,
    updatedAt: Date.now(),
  }
  savePreferences(preferences)
}

export function clearCache(): void {
  cachedPreferences = null
}
