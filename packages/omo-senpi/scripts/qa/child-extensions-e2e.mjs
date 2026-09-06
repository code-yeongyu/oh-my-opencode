#!/usr/bin/env bun
// Live end-to-end QA for the omo.json `child_extensions` list (detached-child -e forwarding).
//
// The `-p`-mode parent exits before the fire-and-forget reflection launch finishes (the stock
// memory-e2e S2 shows the same "extension ctx is stale" failure on this senpi build), so the
// reflection leg is driven in-process: the extension is composed on MemoryFakeExtensionAPI, a
// session is bound, and `/reflect` reserves a manual run while THIS process stays alive long
// enough for the detached supervisor + senpi child to run to completion.
//
//   S1 `senpi --no-extensions -e <mock-provider> --list-models` exposes the extension's provider
//      while the same probe without -e does not (the senpi mechanism this feature relies on)
//   S2 positive: `child_extensions` in .omo/omo.json -> a real detached reflection child spawns
//      through a LOGGING-ONLY SENPI_BIN shim; launch.json + shim log both show `-e <mock>` after
//      `--no-extensions`, and the run reaches `merged` — the mock provider had to load for the
//      omo-mock model to exist in the child
//   S3 negative: identical setup without `child_extensions` — the catalog probe runs without -e,
//      the provider is invisible, and the run fails instead of merging
// The shim logs argv and re-execs real senpi UNCHANGED — it injects nothing, so any -e entry in
// the log came from omo's spawn code. Real ~/.senpi/agent and ~/.omo/memory are hashed
// before/after as the isolation proof. Run with bun (the in-process leg imports .ts sources).
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, copyFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { homedir } from "node:os"
import { delimiter, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createSandbox, seedSandbox } from "./drive.mjs"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const mockProviderEntry = join(scriptDir, "task-e2e-mock-provider.ts")
const outDir = process.env.CHILD_EXT_E2E_OUT_DIR === undefined ? undefined : resolve(process.env.CHILD_EXT_E2E_OUT_DIR)
const results = []
const failures = []

function record(name, ok, detail) {
  results.push({ name, ok, detail })
  if (!ok) failures.push({ name, detail })
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`)
}

function fail(message) {
  throw new Error(message)
}

function findOnPath(bin) {
  if (bin.includes("/")) return existsSync(bin) ? bin : null
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    const candidate = resolve(dir || ".", bin)
    if (existsSync(candidate)) return candidate
  }
  return null
}

const senpiBin = process.env.SENPI_BIN ?? findOnPath("senpi")
if (senpiBin === null) fail("senpi binary not found (set SENPI_BIN)")

const ISOLATION_EXCLUDE = new Set(["sessions", "senpi-debug.log", "mcp-cache.json", "mcp-auth", "settings.json", "telemetry.log", "goals"])

function hashDir(root, exclude = undefined) {
  if (!existsSync(root)) return "absent"
  const hash = createHash("sha256")
  const walk = (dir) => {
    for (const name of readdirSync(dir).toSorted()) {
      if (exclude !== undefined && exclude(name)) continue
      const full = join(dir, name)
      const st = statSync(full)
      if (st.isDirectory()) { walk(full); continue }
      hash.update(name); hash.update(readFileSync(full))
    }
  }
  walk(root)
  return hash.digest("hex")
}

const isolationExclude = (name) => ISOLATION_EXCLUDE.has(name)
const realSenpiBefore = hashDir(join(homedir(), ".senpi", "agent"), isolationExclude)
const realOmoMemoryBefore = hashDir(join(homedir(), ".omo", "memory"))

// The shim records every argv line to SPAWN_LOG, then re-execs the real senpi unchanged: it
// deliberately injects NO -e entries, so any -e the log shows was added by omo's spawn code.
function writeLoggingShim(sandbox) {
  const spawnLog = join(sandbox.root, "spawn-argv.log")
  const shimPath = join(sandbox.root, "senpi-log-shim")
  writeFileSync(shimPath, [
    "#!/bin/sh",
    `printf '%s\n' "$*" >> ${JSON.stringify(spawnLog)}`,
    `exec ${JSON.stringify(senpiBin)} "$@"`,
    "",
  ].join("\n"))
  spawnSync("chmod", ["+x", shimPath])
  return { shimPath, spawnLog }
}

function scenarioSandbox() {
  const sandbox = createSandbox()
  seedSandbox(sandbox)
  mkdirSync(join(sandbox.agentDir, "sessions"), { recursive: true })
  mkdirSync(join(sandbox.cwd, ".omo"), { recursive: true })
  // The category resolver gates on registry.getAvailable(), which drops providers without
  // configured auth; the scripted mock provider therefore needs an auth entry to be selectable.
  writeFileSync(join(sandbox.agentDir, "auth.json"), `${JSON.stringify({ "omo-mock": { type: "api_key", key: "mock" } }, null, 2)}\n`)
  return sandbox
}

function writeOmoConfig(sandbox, { childExtensions } = {}) {
  const config = {
    categories: { quick: { description: "QA mock quick category", model: "omo-mock/mock-1" } },
    memory: {
      enabled: true,
      // Step/dream triggers stay parked; only the manual /reflect below reserves a run.
      reflection: { trigger: { step_count: 9999, on_compaction: false } },
    },
    ...(childExtensions === undefined ? {} : { child_extensions: childExtensions }),
  }
  writeFileSync(join(sandbox.cwd, ".omo", "omo.json"), `${JSON.stringify(config, null, 2)}\n`)
}

function memoryRepos(memoryHome) {
  const agentsDir = join(memoryHome, "agents")
  if (!existsSync(agentsDir)) return []
  return readdirSync(agentsDir).map((name) => join(agentsDir, name, "repo")).filter(existsSync)
}

function gitLog(repo) {
  const run = spawnSync("git", ["log", "--format=%s", "HEAD"], { cwd: repo, encoding: "utf8" })
  return run.status === 0 ? run.stdout.trim() : ""
}

function readSpawnLog(spawnLog) {
  return existsSync(spawnLog) ? readFileSync(spawnLog, "utf8").split("\n").filter(Boolean) : []
}

function findCompletionRecord(memoryHome) {
  const agentsDir = join(memoryHome, "agents")
  if (!existsSync(agentsDir)) return undefined
  for (const agent of readdirSync(agentsDir)) {
    const completionsDir = join(agentsDir, agent, "runtime", "reflection", "completions")
    if (!existsSync(completionsDir)) continue
    const files = readdirSync(completionsDir).filter((name) => name.endsWith(".json"))
    if (files.length === 0) continue
    return JSON.parse(readFileSync(join(completionsDir, files[0]), "utf8"))
  }
  return undefined
}

function findRunDirs(memoryHome) {
  const agentsDir = join(memoryHome, "agents")
  if (!existsSync(agentsDir)) return []
  const dirs = []
  for (const agent of readdirSync(agentsDir)) {
    const runsDir = join(agentsDir, agent, "runtime", "reflection", "runs")
    if (!existsSync(runsDir)) continue
    for (const runId of readdirSync(runsDir)) dirs.push(join(runsDir, runId))
  }
  return dirs
}

function readLaunchManifest(memoryHome) {
  for (const runDir of findRunDirs(memoryHome)) {
    const launchPath = join(runDir, "launch.json")
    if (existsSync(launchPath)) return JSON.parse(readFileSync(launchPath, "utf8"))
  }
  return undefined
}

// Structural stand-in for the settle-time registry snapshot: eventCtx.modelRegistry must expose
// find() + getProviderAuth() (see model-registry-resolver.ts isModelRegistry).
function fakeModelRegistry() {
  const entry = { provider: "omo-mock", id: "mock-1", contextWindow: 1_000_000 }
  return {
    find: (provider, modelId) => (provider === "omo-mock" && modelId === "mock-1" ? entry : undefined),
    getAvailable: () => [entry],
    getProviderAuth: () => ({ type: "api_key", key: "mock" }),
  }
}

function waitFor(predicate, { timeoutMs = 90_000, intervalMs = 500, description } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const start = Date.now()
    const poll = () => {
      try {
        const value = predicate()
        if (value) { resolvePromise(value); return }
      } catch {}
      if (Date.now() - start > timeoutMs) {
        rejectPromise(new Error(`timeout waiting for ${description}`))
        return
      }
      setTimeout(poll, intervalMs)
    }
    poll()
  })
}

// S1: the senpi mechanism itself — `-e` still loads under `--no-extensions`.
function scenarioMechanism() {
  const sandbox = scenarioSandbox()
  const env = {
    ...process.env,
    SENPI_CODING_AGENT_DIR: sandbox.agentDir,
    XDG_CONFIG_HOME: sandbox.xdgConfigHome,
    OMO_MEMORY_HOME: join(sandbox.root, "memory"),
  }
  const base = ["--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files", "--list-models"]
  const without = spawnSync(senpiBin, base, { cwd: sandbox.cwd, env, encoding: "utf8", timeout: 60_000 })
  const withExt = spawnSync(senpiBin, ["--no-extensions", "-e", mockProviderEntry, ...base.slice(1)], { cwd: sandbox.cwd, env, encoding: "utf8", timeout: 60_000 })
  if (without.status !== 0) return record("S1 baseline list-models", false, (without.stderr ?? "").slice(-300))
  if (withExt.status !== 0) return record("S1 -e list-models", false, (withExt.stderr ?? "").slice(-300))
  record("S1 provider hidden under --no-extensions", !(without.stdout ?? "").includes("omo-mock"), "omo-mock absent from catalog")
  record("S1 provider visible with explicit -e", (withExt.stdout ?? "").includes("omo-mock"), "omo-mock present in catalog")
}

// S2/S3 share one in-process driver: compose the extension, bind a session, /reflect, then let
// the floating launch finish because this process stays alive polling the completion record.
async function scenarioReflect({ label, childExtensions, expectMerged }) {
  const sandbox = scenarioSandbox()
  const memoryHome = join(sandbox.root, "memory")
  writeOmoConfig(sandbox, childExtensions === undefined ? {} : { childExtensions })
  const { shimPath, spawnLog } = writeLoggingShim(sandbox)

  const mockScriptPath = join(sandbox.root, "mock-script.json")
  writeFileSync(mockScriptPath, `${JSON.stringify({
    parentSteps: [
      { type: "tool_call", name: "bash", arguments: { command: "mkdir -p system && printf -- '---\\ndescription: qa extension-load proof\\n---\\nqa extension-loaded fact\\n' > system/qa-fact.md && git add -A && git commit -m 'feat(reflection): qa child extension proof'" } },
      { type: "text", text: "reflection written" },
    ],
    childSteps: [],
  }, null, 2)}\n`)

  const previousEnv = {
    SENPI_CODING_AGENT_DIR: process.env.SENPI_CODING_AGENT_DIR,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
    XDG_DATA_HOME: process.env.XDG_DATA_HOME,
    XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,
    OMO_MEMORY_HOME: process.env.OMO_MEMORY_HOME,
    SENPI_BIN: process.env.SENPI_BIN,
    MOCK_SCRIPT_PATH: process.env.MOCK_SCRIPT_PATH,
  }
  const previousCwd = process.cwd()
  process.env.SENPI_CODING_AGENT_DIR = sandbox.agentDir
  process.env.XDG_CONFIG_HOME = sandbox.xdgConfigHome
  process.env.XDG_DATA_HOME = sandbox.xdgDataHome
  process.env.XDG_CACHE_HOME = sandbox.xdgCacheHome
  process.env.OMO_MEMORY_HOME = memoryHome
  process.env.SENPI_BIN = shimPath
  process.env.MOCK_SCRIPT_PATH = mockScriptPath
  process.chdir(sandbox.cwd)

  const sessionId = "qa-child-ext-session"
  const sessionManager = { getSessionId: () => sessionId, getEntries: () => [] }
  const eventCtx = { sessionManager, modelRegistry: fakeModelRegistry() }
  try {
    const bundleModule = await import("../../src/extension/index.ts")
    const { MemoryFakeExtensionAPI } = await import("../../src/components/memory/memory.test-support.ts")
    const pi = new MemoryFakeExtensionAPI()
    await bundleModule.default(pi, {})
    await pi.dispatch("session_start", {}, eventCtx)
    await pi.dispatch("agent_settled", {}, eventCtx)

    const reflect = pi.commands.find((command) => command.name === "reflect")
    if (reflect === undefined) return record(`${label} reflect command`, false, "not registered")
    const commandCtx = { mode: "print", hasUI: false, cwd: sandbox.cwd, agentDir: sandbox.agentDir, sessionManager }
    const request = await reflect.options.handler("", commandCtx)
    record(`${label} /reflect accepted`, typeof request === "string" && !/rejected|disabled|error/i.test(request), String(request).slice(0, 160))

    const completion = await waitFor(() => findCompletionRecord(memoryHome), {
      timeoutMs: 120_000,
      description: `${label} reflection completion record`,
    }).catch((error) => error)
    if (completion instanceof Error) {
      console.error(`${label} spawn log:`, readSpawnLog(spawnLog).join("\n"))
      return record(`${label} completion record`, false, completion.message)
    }
    if (expectMerged) {
      record(`${label} outcome merged`, completion.outcome === "merged", JSON.stringify(completion).slice(0, 300))
      const repos = memoryRepos(memoryHome)
      const log = repos.length > 0 ? gitLog(repos[0]) : ""
      record(`${label} merge commit landed`, /merge\(reflection\)/.test(log), log.split("\n").slice(0, 3).join(" || "))
    } else {
      record(`${label} run failed without merge`, completion.outcome !== "merged", JSON.stringify(completion).slice(0, 300))
      // launch.json is cleaned up after publication; its absence plus a failed outcome proves
      // the run never reached the child spawn.
      record(`${label} no launch manifest (child never spawned)`, readLaunchManifest(memoryHome) === undefined, findRunDirs(memoryHome).join(","))
    }

    const lines = readSpawnLog(spawnLog)
    // The `-p` line is the reflection child; the `--list-models` line is the catalog probe.
    const childLine = lines.find((line) => line.includes(" -p ") || line.startsWith("-p "))
    if (expectMerged) {
      const flagIndex = childLine?.indexOf("--no-extensions") ?? -1
      const eIndex = childLine?.indexOf(`-e ${mockProviderEntry}`) ?? -1
      record(`${label} reflection child argv has -e after --no-extensions`, flagIndex !== -1 && eIndex > flagIndex, (childLine ?? "no child spawn").slice(0, 300))
    } else {
      record(`${label} no detached child argv carries -e`, lines.every((line) => !line.includes(`-e ${mockProviderEntry}`)), lines.join(" | ").slice(0, 300))
    }
    const probeLine = lines.find((line) => line.includes("--list-models"))
    record(`${label} catalog probe ran discovery-disabled`, probeLine !== undefined && probeLine.includes("--no-extensions"), (probeLine ?? "no probe").slice(0, 240))

    if (outDir) {
      mkdirSync(outDir, { recursive: true })
      copyFileSync(spawnLog, join(outDir, `${label.toLowerCase()}-spawn-argv.log`))
      writeFileSync(join(outDir, `${label.toLowerCase()}-completion.json`), `${JSON.stringify(completion, null, 2)}\n`)
      const launch = readLaunchManifest(memoryHome)
      if (launch !== undefined) {
        // env is omitted on purpose: the manifest records the full inherited environment.
        const { env: _env, ...rest } = launch
        writeFileSync(join(outDir, `${label.toLowerCase()}-launch.json`), `${JSON.stringify(rest, null, 2)}\n`)
      }
    }
  } finally {
    process.chdir(previousCwd)
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
  return { sandbox }
}

async function main() {
  scenarioMechanism()
  await scenarioReflect({ label: "S2", childExtensions: [mockProviderEntry], expectMerged: true })
  await scenarioReflect({ label: "S3", childExtensions: undefined, expectMerged: false })

  const realSenpiAfter = hashDir(join(homedir(), ".senpi", "agent"), isolationExclude)
  const realOmoMemoryAfter = hashDir(join(homedir(), ".omo", "memory"))
  record("isolation: real ~/.senpi/agent untouched", realSenpiBefore === realSenpiAfter, `${realSenpiBefore.slice(0, 12)} -> ${realSenpiAfter.slice(0, 12)}`)
  record("isolation: real ~/.omo/memory untouched", realOmoMemoryBefore === realOmoMemoryAfter, `${realOmoMemoryBefore.slice(0, 12)} -> ${realOmoMemoryAfter.slice(0, 12)}`)

  if (outDir) {
    mkdirSync(outDir, { recursive: true })
    writeFileSync(join(outDir, "results.json"), `${JSON.stringify({ results, failures }, null, 2)}\n`)
  }
  console.log(failures.length === 0 ? "ALL PASS" : `${failures.length} FAILURES`)
  process.exit(failures.length === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error("driver crashed:", error)
  process.exit(1)
})
