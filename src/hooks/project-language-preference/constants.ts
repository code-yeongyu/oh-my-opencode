import { join } from "node:path"
import { xdgConfig } from "xdg-basedir"
import type { LanguageCode, LanguagePattern } from "./types"

export const CONFIG_DIR = xdgConfig ?? join(process.env.HOME ?? "", ".config")
export const PREFERENCES_FILE = join(CONFIG_DIR, "opencode", "project-preferences.json")

export const LANGUAGE_NAMES: Record<LanguageCode, string> = {
  en: "English",
  ko: "Korean",
  ja: "Japanese",
  zh: "Chinese",
  vi: "Vietnamese",
  es: "Spanish",
  fr: "French",
  de: "German",
  pt: "Portuguese",
  ru: "Russian",
}

export const LANGUAGE_PATTERNS: LanguagePattern[] = [
  { pattern: /\b(use|speak|respond\s+in|answer\s+in|talk\s+in)\s+english\b/i, language: "en", description: "English" },
  { pattern: /\bin\s+english\b/i, language: "en", description: "English" },

  { pattern: /\b(use|speak|respond\s+in|answer\s+in)\s+korean\b/i, language: "ko", description: "Korean" },
  { pattern: /\bin\s+korean\b/i, language: "ko", description: "Korean" },
  { pattern: /한국어로\s*(답변|대화|말|응답|해줘|해주세요|부탁)/i, language: "ko", description: "Korean" },
  { pattern: /한글로\s*(답변|대화|말|응답|해줘|해주세요|부탁)/i, language: "ko", description: "Korean" },

  { pattern: /\b(use|speak|respond\s+in|answer\s+in)\s+japanese\b/i, language: "ja", description: "Japanese" },
  { pattern: /\bin\s+japanese\b/i, language: "ja", description: "Japanese" },
  { pattern: /日本語で(答えて|話して|応答して|お願い)/i, language: "ja", description: "Japanese" },

  { pattern: /\b(use|speak|respond\s+in|answer\s+in)\s+chinese\b/i, language: "zh", description: "Chinese" },
  { pattern: /\bin\s+chinese\b/i, language: "zh", description: "Chinese" },
  { pattern: /用中文(回答|说|回复)/i, language: "zh", description: "Chinese" },
  { pattern: /中文回(答|复)/i, language: "zh", description: "Chinese" },

  { pattern: /\b(use|speak|respond\s+in|answer\s+in)\s+vietnamese\b/i, language: "vi", description: "Vietnamese" },
  { pattern: /\bin\s+vietnamese\b/i, language: "vi", description: "Vietnamese" },
  { pattern: /bằng\s+tiếng\s+việt/i, language: "vi", description: "Vietnamese" },

  { pattern: /\b(use|speak|respond\s+in|answer\s+in)\s+spanish\b/i, language: "es", description: "Spanish" },
  { pattern: /\bin\s+spanish\b/i, language: "es", description: "Spanish" },
  { pattern: /en\s+español/i, language: "es", description: "Spanish" },

  { pattern: /\b(use|speak|respond\s+in|answer\s+in)\s+french\b/i, language: "fr", description: "French" },
  { pattern: /\bin\s+french\b/i, language: "fr", description: "French" },
  { pattern: /en\s+français/i, language: "fr", description: "French" },

  { pattern: /\b(use|speak|respond\s+in|answer\s+in)\s+german\b/i, language: "de", description: "German" },
  { pattern: /\bin\s+german\b/i, language: "de", description: "German" },
  { pattern: /auf\s+deutsch/i, language: "de", description: "German" },

  { pattern: /\b(use|speak|respond\s+in|answer\s+in)\s+portuguese\b/i, language: "pt", description: "Portuguese" },
  { pattern: /\bin\s+portuguese\b/i, language: "pt", description: "Portuguese" },
  { pattern: /em\s+português/i, language: "pt", description: "Portuguese" },

  { pattern: /\b(use|speak|respond\s+in|answer\s+in)\s+russian\b/i, language: "ru", description: "Russian" },
  { pattern: /\bin\s+russian\b/i, language: "ru", description: "Russian" },
  { pattern: /на\s+русском/i, language: "ru", description: "Russian" },
]
