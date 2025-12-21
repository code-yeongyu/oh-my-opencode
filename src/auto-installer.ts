#!/usr/bin/env bun

import { $ } from "bun"
import { homedir } from "os"
import { join } from "path"
import { createInterface } from "readline"

const OPENCODE_CONFIG_DIR = join(homedir(), ".config", "opencode")
const OPENCODE_CONFIG_PATH = join(OPENCODE_CONFIG_DIR, "opencode.json")
const OPENCODE_CONFIG_JSONC_PATH = join(OPENCODE_CONFIG_DIR, "opencode.jsonc")
const OMO_CONFIG_PATH = join(OPENCODE_CONFIG_DIR, "oh-my-opencode.json")

const MESSAGES = {
  BANNER: `
 ██████╗ ███╗   ███╗ ██████╗ 
██╔═══██╗████╗ ████║██╔═══██╗
██║   ██║██╔████╔██║██║   ██║
██║   ██║██║╚██╔╝██║██║   ██║
╚██████╔╝██║ ╚═╝ ██║╚██████╔╝
 ╚═════╝ ╚═╝     ╚═╝ ╚═════╝ 
  Oh My OpenCode Installer
  oMoMoMoMoMo...
`,
  STEPS: {
    CHECK_OPENCODE: "Step 1: Check OpenCode Installation",
    SUBSCRIPTION: "Subscription Check",
    REGISTER_PLUGIN: "Step 2: Register Plugin",
    CONFIGURE: "Step 3: Configure oh-my-opencode",
    AUTH_SETUP: "Authentication Setup",
    COMPLETE: "Installation Complete!",
  },
  PROMPTS: {
    CLAUDE: "Do you have a Claude Pro/Max subscription?",
    MAX20: "Are you on max20 (20x mode)?",
    CHATGPT: "Do you have a ChatGPT Plus/Pro subscription?",
    GEMINI: "Will you use Gemini models (Google AI Studio)?",
  },
  SUCCESS: {
    OPENCODE_INSTALLED: (version: string) => `OpenCode ${version} is installed`,
    PLUGIN_REGISTERED: "Registered oh-my-opencode plugin",
    CONFIG_UPDATED: "Updated existing oh-my-opencode.json",
    CONFIG_CREATED: "Created oh-my-opencode.json",
  },
  INFO: {
    PLUGIN_EXISTS: "oh-my-opencode plugin already registered",
    CONFIG_PATH: (path: string) => `Config path: ${path}`,
    NO_AUTH_REQUIRED: "No authentication required (using opencode/big-pickle as fallback)",
    OPENCODE_DOCS: "Visit: https://opencode.ai/docs",
  },
  WARN: {
    JSONC_MANUAL: "Found opencode.jsonc - please add 'oh-my-opencode' to the plugin array manually",
    PATH: (path: string) => `Path: ${path}`,
  },
  ERROR: {
    OPENCODE_NOT_INSTALLED: "OpenCode is not installed. Please install it first.",
  },
  AUTH: {
    CLAUDE: `
📌 Claude Authentication:
   1. Run: opencode auth login
   2. Select Provider: Anthropic
   3. Select Login method: Claude Pro/Max
   4. Complete OAuth in browser
`,
    CHATGPT: `
📌 ChatGPT Authentication:
   1. Add to opencode.json plugins: "opencode-openai-codex-auth"
   2. Run: opencode auth login
   3. Select Provider: OpenAI
   4. Select Login method: ChatGPT Plus/Pro (Codex Subscription)
   5. Complete OAuth in browser

   ⚠️  For details, see: https://github.com/numman-ali/opencode-openai-codex-auth
`,
    GEMINI: `
📌 Google Gemini Authentication (Recommended: opencode-antigravity-auth):
   1. Add to opencode.json plugins: "opencode-antigravity-auth@1.1.2"
   2. Run: opencode auth login
   3. Select Provider: Google
   4. Select Login method: OAuth with Google (Antigravity)
   5. Complete OAuth in browser

   ⚠️  For details, see: https://github.com/NoeFabris/opencode-antigravity-auth
`,
  },
  FINAL: `
🎉 Congratulations! oh-my-opencode is now configured.

Next steps:
1. Complete the authentication steps above (if any)
2. Run 'opencode' to start using it

📖 Documentation: https://github.com/code-yeongyu/oh-my-opencode
⭐ If you like it, please star the repo!

`,
} as const

interface UserChoices {
  hasClaude: boolean
  hasMax20: boolean
  hasChatGPT: boolean
  hasGemini: boolean
}

interface OmoConfig {
  $schema?: string
  google_auth?: boolean
  agents?: Record<string, { model: string }>
}

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
})

function ask(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim().toLowerCase())
    })
  })
}

async function confirm(question: string): Promise<boolean> {
  const answer = await ask(`${question} (y/n): `)
  return ["y", "yes"].includes(answer.toLowerCase())
}

function print(message: string, type: "info" | "success" | "error" | "warn" = "info") {
  const colors = {
    info: "\x1b[36m",
    success: "\x1b[32m",
    error: "\x1b[31m",
    warn: "\x1b[33m",
  }
  const reset = "\x1b[0m"
  const prefix = { info: "[INFO]", success: "[OK]", error: "[ERROR]", warn: "[WARN]" }
  console.log(`${colors[type]}${prefix[type]}${reset} ${message}`)
}

function printHeader(message: string) {
  console.log(`\n${"=".repeat(50)}`)
  console.log(`  ${message}`)
  console.log(`${"=".repeat(50)}\n`)
}

async function checkOpenCodeInstalled(): Promise<boolean> {
  try {
    const result = await $`opencode --version`.quiet()
    if (result.exitCode === 0) {
      print(MESSAGES.SUCCESS.OPENCODE_INSTALLED(result.stdout.toString().trim()), "success")
      return true
    }
  } catch {}
  return false
}

async function fileExists(path: string): Promise<boolean> {
  return Bun.file(path).exists()
}

async function readJsonFile<T>(path: string): Promise<T | null> {
  try {
    const content = await Bun.file(path).text()
    return JSON.parse(content) as T
  } catch {
    return null
  }
}

async function writeJsonFile(path: string, data: unknown): Promise<void> {
  await Bun.write(path, JSON.stringify(data, null, 2))
}

async function ensureDir(path: string): Promise<void> {
  await $`mkdir -p ${path}`.quiet()
}

async function registerPlugin(): Promise<boolean> {
  await ensureDir(OPENCODE_CONFIG_DIR)

  if (await fileExists(OPENCODE_CONFIG_JSONC_PATH)) {
    print(MESSAGES.WARN.JSONC_MANUAL, "warn")
    print(MESSAGES.WARN.PATH(OPENCODE_CONFIG_JSONC_PATH), "info")
    return false
  }

  let config: { plugin?: string[] } = {}
  if (await fileExists(OPENCODE_CONFIG_PATH)) {
    config = (await readJsonFile<{ plugin?: string[] }>(OPENCODE_CONFIG_PATH)) ?? {}
  }

  const plugins = config.plugin ?? []
  if (!plugins.includes("oh-my-opencode")) {
    plugins.push("oh-my-opencode")
    config.plugin = plugins
    await writeJsonFile(OPENCODE_CONFIG_PATH, config)
    print(MESSAGES.SUCCESS.PLUGIN_REGISTERED, "success")
  } else {
    print(MESSAGES.INFO.PLUGIN_EXISTS, "info")
  }

  return true
}

function buildOmoConfig(choices: UserChoices): OmoConfig {
  const config: OmoConfig = {
    $schema: "https://raw.githubusercontent.com/code-yeongyu/oh-my-opencode/master/assets/oh-my-opencode.schema.json",
  }

  const agents: Record<string, { model: string }> = {}
  const fallback = choices.hasClaude ? "anthropic/claude-opus-4-5" : "opencode/big-pickle"

  if (!choices.hasClaude) {
    agents["Sisyphus"] = { model: "opencode/big-pickle" }
    agents["librarian"] = { model: "opencode/big-pickle" }
  } else if (!choices.hasMax20) {
    agents["librarian"] = { model: "opencode/big-pickle" }
  }

  if (!choices.hasChatGPT) {
    agents["oracle"] = { model: fallback }
  }

  if (!choices.hasGemini) {
    agents["frontend-ui-ux-engineer"] = { model: fallback }
    agents["document-writer"] = { model: fallback }
    agents["multimodal-looker"] = { model: fallback }
  } else {
    config.google_auth = true
  }

  if (Object.keys(agents).length > 0) {
    config.agents = agents
  }

  return config
}

async function collectUserChoices(): Promise<UserChoices> {
  printHeader(MESSAGES.STEPS.SUBSCRIPTION)

  const hasClaude = await confirm(MESSAGES.PROMPTS.CLAUDE)
  let hasMax20 = false
  if (hasClaude) {
    hasMax20 = await confirm(MESSAGES.PROMPTS.MAX20)
  }

  const hasChatGPT = await confirm(MESSAGES.PROMPTS.CHATGPT)
  const hasGemini = await confirm(MESSAGES.PROMPTS.GEMINI)

  return { hasClaude, hasMax20, hasChatGPT, hasGemini }
}

function printAuthInstructions(choices: UserChoices) {
  printHeader(MESSAGES.STEPS.AUTH_SETUP)

  let hasAuth = false

  if (choices.hasClaude) {
    hasAuth = true
    console.log(MESSAGES.AUTH.CLAUDE)
  }

  if (choices.hasChatGPT) {
    hasAuth = true
    console.log(MESSAGES.AUTH.CHATGPT)
  }

  if (choices.hasGemini) {
    hasAuth = true
    console.log(MESSAGES.AUTH.GEMINI)
  }

  if (!hasAuth) {
    print(MESSAGES.INFO.NO_AUTH_REQUIRED, "info")
  }
}

async function main() {
  console.log(MESSAGES.BANNER)

  printHeader(MESSAGES.STEPS.CHECK_OPENCODE)
  const hasOpenCode = await checkOpenCodeInstalled()
  if (!hasOpenCode) {
    print(MESSAGES.ERROR.OPENCODE_NOT_INSTALLED, "error")
    print(MESSAGES.INFO.OPENCODE_DOCS, "info")
    rl.close()
    process.exit(1)
  }

  const choices = await collectUserChoices()

  printHeader(MESSAGES.STEPS.REGISTER_PLUGIN)
  await registerPlugin()

  printHeader(MESSAGES.STEPS.CONFIGURE)
  const omoConfig = buildOmoConfig(choices)

  if (await fileExists(OMO_CONFIG_PATH)) {
    const existing = await readJsonFile<OmoConfig>(OMO_CONFIG_PATH)
    if (existing) {
      const merged = {
        ...existing,
        ...omoConfig,
        agents: { ...existing.agents, ...omoConfig.agents },
      }
      await writeJsonFile(OMO_CONFIG_PATH, merged)
      print(MESSAGES.SUCCESS.CONFIG_UPDATED, "success")
    }
  } else {
    await writeJsonFile(OMO_CONFIG_PATH, omoConfig)
    print(MESSAGES.SUCCESS.CONFIG_CREATED, "success")
  }

  print(MESSAGES.INFO.CONFIG_PATH(OMO_CONFIG_PATH), "info")

  printAuthInstructions(choices)

  printHeader(MESSAGES.STEPS.COMPLETE)
  console.log(MESSAGES.FINAL)

  rl.close()
}

main().catch((err) => {
  console.error("Installation failed:", err)
  rl.close()
  process.exit(1)
})
