import { describe, expect, it, mock } from "bun:test"

import { resolveWindowsSystemToolExistent } from "./system-tool-paths"

describe("resolveWindowsSystemToolExistent", () => {
  it("#given an existing executable #when resolving #then the absolute path is found", () => {
    const path = "D:\\Windows\\System32\\taskkill.exe"
    const exists = mock((candidate: string) => candidate === path)
    expect(resolveWindowsSystemToolExistent("taskkill.exe", "D:\\Windows", exists, "")).toEqual({ found: true, path })
    expect(exists.mock.calls).toEqual([[path]])
  })

  for (const root of ["relative", ".\\Windows", "C:Windows", "\\Windows", "/Windows", "\\\\server"]) {
    it(`#given a relative root ${root} #when resolving #then it is rejected before any existence check`, () => {
      const exists = mock(() => true)
      const result = resolveWindowsSystemToolExistent("taskkill.exe", root, exists, "")
      expect(result).toEqual({ found: false, error: expect.any(String) })
      expect(exists).not.toHaveBeenCalled()
      expect("path" in result).toBe(false)
    })
  }

  for (const root of ["", "relative", "C:\\Missing"]) {
    it(`#given an unusable SystemRoot ${root} #when WINDIR has the executable #then WINDIR is used`, () => {
      const path = "D:\\Windows\\System32\\taskkill.exe"
      expect(resolveWindowsSystemToolExistent("taskkill.exe", root, candidate => candidate === path, "D:\\Windows")).toEqual({ found: true, path })
    })
  }

  it("#given both candidates exist #when resolving #then SystemRoot takes precedence", () => {
    const exists = mock(() => true)
    expect(resolveWindowsSystemToolExistent("taskkill.exe", "D:\\Windows", exists, "E:\\Windows")).toEqual({
      found: true, path: "D:\\Windows\\System32\\taskkill.exe",
    })
    expect(exists).toHaveBeenCalledTimes(1)
  })

  it("#given both executables are missing #when resolving #then both absolute candidates are checked and a nonfatal error is returned", () => {
    const exists = mock(() => false)
    const result = resolveWindowsSystemToolExistent("taskkill.exe", "D:\\Windows", exists, "E:\\Windows")
    expect(result).toEqual({ found: false, error: expect.any(String) })
    expect(exists.mock.calls).toEqual([
      ["D:\\Windows\\System32\\taskkill.exe"],
      ["E:\\Windows\\System32\\taskkill.exe"],
    ])
  })

  it("#given no installation candidates #when resolving #then there is no blind C drive fallback", () => {
    const exists = mock(() => true)
    expect(resolveWindowsSystemToolExistent("taskkill.exe", "", exists, "")).toEqual({ found: false, error: expect.any(String) })
    expect(exists).not.toHaveBeenCalled()
  })

  it("#given relative WINDIR #when resolving #then it cannot rescue a missing SystemRoot", () => {
    const exists = mock(() => true)
    expect(resolveWindowsSystemToolExistent("taskkill.exe", "", exists, "C:Windows")).toEqual({ found: false, error: expect.any(String) })
    expect(exists).not.toHaveBeenCalled()
  })
})
