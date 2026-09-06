import { execFile } from "node:child_process"

import { parsePosixProcessTable, parseWindowsProcessTable, type ProcessInfo } from "./process-table"
import { resolveWindowsSystemToolExistent } from "../system-tool-paths"

export interface ProcessKiller {
  readonly isAlive: (pid: number) => boolean | Promise<boolean>
  readonly kill: (pid: number) => Promise<void>
  readonly terminate: (pid: number) => Promise<void>
}

export function enumerateProcesses(platform: NodeJS.Platform = process.platform): Promise<ProcessInfo[]> {
  return platform === "win32" ? enumerateWindowsProcesses() : enumeratePosixProcesses()
}

export function createDefaultProcessKiller(platform: NodeJS.Platform = process.platform): ProcessKiller {
  return platform === "win32" ? createWindowsKiller() : createPosixKiller()
}

export function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (!(error instanceof Error)) throw error
    return processKillErrorMeansAlive(error)
  }
}

function enumeratePosixProcesses(): Promise<ProcessInfo[]> {
  return execFileText("ps", ["-eo", "pid=,ppid=,command="]).then(parsePosixProcessTable)
}

function enumerateWindowsProcesses(): Promise<ProcessInfo[]> {
  const command = [
    "Get-CimInstance Win32_Process",
    "Select-Object ProcessId,ParentProcessId,CommandLine",
    "ConvertTo-Json -Compress -Depth 2",
  ].join(" | ")
  const tool = resolveWindowsSystemToolExistent("WindowsPowerShell\\v1.0\\powershell.exe")
  if (!tool.found) return Promise.reject(new Error(tool.error))
  return execFileText(tool.path, ["-NoProfile", "-Command", command]).then(parseWindowsProcessTable)
}

function createPosixKiller(): ProcessKiller {
  return {
    isAlive: defaultIsProcessAlive,
    kill: (pid) => {
      process.kill(pid, "SIGKILL")
      return Promise.resolve()
    },
    terminate: (pid) => {
      process.kill(pid, "SIGTERM")
      return Promise.resolve()
    },
  }
}

function createWindowsKiller(): ProcessKiller {
  return {
    isAlive: defaultIsProcessAlive,
    kill: (pid) => execFileVoid("taskkill.exe", ["/PID", String(pid), "/T", "/F"]),
    terminate: (pid) => execFileVoid("taskkill.exe", ["/PID", String(pid), "/T"]),
  }
}

function execFileText(command: string, args: readonly string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile(command, [...args], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (error, stdout) => {
      if (error !== null) {
        reject(error)
        return
      }
      resolvePromise(stdout)
    })
  })
}

function execFileVoid(toolRelativePath: string, args: readonly string[]): Promise<void> {
  const tool = resolveWindowsSystemToolExistent(toolRelativePath)
  if (!tool.found) return Promise.reject(new Error(tool.error))
  return execFileText(tool.path, args).then(() => undefined)
}

function processKillErrorMeansAlive(error: Error): boolean {
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined
  if (code === "ESRCH") return false
  if (code === "EPERM") return true
  return false
}
