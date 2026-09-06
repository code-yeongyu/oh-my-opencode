import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import { resolveAgentHome } from "../components/agent-home/resolve-agent-home"
import { installLocalLauncher, uninstallLocalLauncher } from "./local-launcher"
import { ensurePluginArtifacts } from "./plugin-artifacts"
import {
  dedupePackages,
  readPackages,
  readSettings,
  removeLegacyBuiltinShadows,
  removeOmoPackages,
  type SettingsRecord,
  writeSettingsAtomically,
} from "./senpi-settings"

const execFileAsync = promisify(execFile)

type Env = Readonly<Record<string, string | undefined>>

export interface SenpiInstallOptions {
  readonly env?: Env
  readonly repoRoot?: string
  readonly agentDir?: string
  readonly pluginPath?: string
  readonly platform?: NodeJS.Platform
  readonly runCommand?: (command: string, args: readonly string[], options: { readonly cwd: string }) => Promise<void>
}

export interface SenpiInstallResult {
  readonly ok: true
  readonly action: "install" | "uninstall"
  readonly agentDir: string
  readonly settingsPath: string
  readonly pluginPath: string
  readonly changed: boolean
  readonly backupPath: string
  readonly removed?: boolean
}

export async function runSenpiInstaller(options: SenpiInstallOptions = {}): Promise<SenpiInstallResult> {
  const context = resolveInstallContext(options)
  await ensurePluginArtifacts(context)
  // Claim the launcher before any settings mutation: a foreign owner must fail atomically.
  const launcherPath = installLocalLauncher({
    pluginPath: context.pluginPath,
    senpiCliPath: join(context.repoRoot, "packages", "coding-agent", "dist", "cli.js"),
  })
  if (launcherPath === undefined) throw new Error("Cannot install omo-senpi: local omo launcher is owned by another application")
  const settings = await readSettings(context.settingsPath)
  const before = JSON.stringify(settings)
  const packages = dedupePackages(await removeOmoPackages(
    removeLegacyBuiltinShadows(
      dedupePackages(readPackages(settings)),
      context.repoRoot,
      context.agentDir,
    ),
    context.agentDir,
  ))
  settings.packages = packages
  const backupPath = await writeSettingsAtomically(context.settingsPath, settings)
  return {
    ok: true,
    action: "install",
    agentDir: context.agentDir,
    settingsPath: context.settingsPath,
    pluginPath: context.pluginPath,
    changed: JSON.stringify(settings) !== before,
    backupPath,
  }
}

export async function runSenpiUninstaller(options: SenpiInstallOptions = {}): Promise<SenpiInstallResult> {
  const context = resolveInstallContext(options)
  const settings = await readSettings(context.settingsPath)
  const before = JSON.stringify(settings)
  const packages = dedupePackages(readPackages(settings))
  const nextPackages = packages.filter((entry) => entry !== context.pluginPath)
  settings.packages = nextPackages
  const backupPath = await writeSettingsAtomically(context.settingsPath, settings)
  uninstallLocalLauncher()

  return {
    ok: true,
    action: "uninstall",
    agentDir: context.agentDir,
    settingsPath: context.settingsPath,
    pluginPath: context.pluginPath,
    changed: JSON.stringify(settings) !== before,
    backupPath,
    removed: nextPackages.length !== packages.length,
  }
}

function resolveInstallContext(options: SenpiInstallOptions): {
  readonly env: Env
  readonly repoRoot: string
  readonly agentDir: string
  readonly settingsPath: string
  readonly pluginPath: string
  readonly platform: NodeJS.Platform
  readonly allowBuild: boolean
  readonly runCommand: (command: string, args: readonly string[], options: { readonly cwd: string }) => Promise<void>
} {
  const env = options.env ?? process.env
  const allowBuild = options.pluginPath === undefined
  const repoRoot = resolve(options.repoRoot ?? (allowBuild ? findRepoRoot(dirname(fileURLToPath(import.meta.url))) : dirname(resolve(options.pluginPath))))
  const agentDir = resolve(options.agentDir ?? resolveAgentHome({ env, homeDir: env.HOME ?? homedir() }))
  const pluginPath = resolve(options.pluginPath ?? join(repoRoot, "packages", "omo-senpi", "plugin"))
  return {
    env,
    repoRoot,
    agentDir,
    settingsPath: join(agentDir, "settings.json"),
    pluginPath,
    platform: options.platform ?? process.platform,
    allowBuild,
    runCommand: options.runCommand ?? defaultRunCommand,
  }
}

async function defaultRunCommand(
  command: string,
  args: readonly string[],
  options: { readonly cwd: string },
): Promise<void> {
  const result = await execFileAsync(command, [...args], { cwd: options.cwd })
  if (result.stderr.trim().length > 0) process.stderr.write(result.stderr)
  if (result.stdout.trim().length > 0) process.stdout.write(result.stdout)
}

function findRepoRoot(importerDir: string): string {
  let current = importerDir
  for (let depth = 0; depth <= 7; depth += 1) {
    if (fileExistsSync(join(current, "packages", "omo-senpi", "plugin", "package.json"))) return current
    current = resolve(current, "..")
  }
  throw new Error("Unable to locate packages/omo-senpi/plugin/package.json from installer module")
}

function fileExistsSync(path: string): boolean {
  return existsSync(path)
}
