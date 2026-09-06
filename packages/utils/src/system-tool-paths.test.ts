import { describe, expect, it } from "bun:test"

import { resolveWindowsSystemTool } from "./system-tool-paths"

describe("resolveWindowsSystemTool", () => {
  it("#given a nonstandard installation #when resolving taskkill #then only its existing absolute path is returned", () => {
    const path = "D:\\Custom\\Windows\\System32\\taskkill.exe"
    expect(resolveWindowsSystemTool("taskkill.exe", "D:\\Custom\\Windows", candidate => candidate === path, "")).toBe(path)
  })

  it("#given no configured roots #when resolving #then no guessed Windows path is returned", () => {
    expect(resolveWindowsSystemTool("taskkill.exe", "", () => true, "")).toBeUndefined()
  })

  it("#given an absent executable #when resolving #then no spawnable path is returned", () => {
    expect(resolveWindowsSystemTool("taskkill.exe", "C:\\Windows", () => false, "")).toBeUndefined()
  })

  it("#given WINDIR only #when resolving powershell #then its existing absolute path is returned", () => {
    const path = "D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"
    expect(resolveWindowsSystemTool("WindowsPowerShell\\v1.0\\powershell.exe", "", candidate => candidate === path, "D:\\Windows")).toBe(path)
  })

  it("#given an absolute UNC installation #when resolving #then its existing tool is returned", () => {
    expect(resolveWindowsSystemTool("taskkill.exe", "\\\\server\\share\\Windows", () => true, "")).toBe(
      "\\\\server\\share\\Windows\\System32\\taskkill.exe",
    )
  })
})
