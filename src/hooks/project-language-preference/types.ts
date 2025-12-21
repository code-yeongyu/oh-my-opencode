export type LanguageCode = "en" | "ko" | "ja" | "zh" | "vi" | "es" | "fr" | "de" | "pt" | "ru"

export interface ProjectPreferences {
  [projectPath: string]: {
    language: LanguageCode
    updatedAt: number
  }
}

export interface LanguagePattern {
  pattern: RegExp
  language: LanguageCode
  description: string
}
