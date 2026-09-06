import { describe, expect, it } from "bun:test"
import { spawnSync } from "node:child_process"

const resolverUrl = new URL("./system-tool-paths.ts", import.meta.url).href
const sweepUrl = new URL("./process-sweep/exec.ts", import.meta.url).href
const terminationUrl = new URL("./process-tree-termination.ts", import.meta.url).href
const hookUrl = new URL("./command-executor/execute-hook-command.ts", import.meta.url).href

function probe(source: string, roots: Record<string, string | undefined> = {}) {
  const configureRoots = `for (const [key, value] of ${JSON.stringify(Object.entries(roots))}) {
    if (value === null) delete process.env[key]; else process.env[key] = value;
  }`
  const result = spawnSync(process.execPath, ["--eval", configureRoots + source], {
    env: { ...process.env, PATH: "" },
    encoding: "utf8",
    timeout: 10_000,
    windowsHide: true,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(result.stderr || `Probe exited with ${result.status}`)
  return JSON.parse(result.stdout)
}

describe.skipIf(process.platform !== "win32")("Windows system tools with System32 absent from PATH", () => {
  it("#given the real Windows installation #when resolving and launching tools #then absolute paths work without PATH lookup", () => {
    const result = probe(`
      import { execFileSync } from "node:child_process";
      import { resolveWindowsSystemToolExistent } from ${JSON.stringify(resolverUrl)};
      const tools = ["taskkill.exe", "WindowsPowerShell\\\\v1.0\\\\powershell.exe"].map(tool => resolveWindowsSystemToolExistent(tool));
      for (const tool of tools) if (!tool.found) throw new Error(tool.error);
      execFileSync(tools[0].path, ["/?"], { windowsHide: true });
      const output = execFileSync(tools[1].path, ["-NoProfile", "-Command", "Write-Output 6740"], { encoding: "utf8", windowsHide: true });
      console.log(JSON.stringify({ tools, output: output.trim(), path: process.env.PATH }));
    `)
    expect(result.path).toBe("")
    expect(result.output).toBe("6740")
    for (const tool of result.tools) {
      expect(tool.found).toBe(true)
      expect(tool.path).toMatch(/^[A-Za-z]:\\.*\\System32\\/i)
    }
  }, { timeout: 15_000 })

  for (const root of [undefined, "", "relative", "C:Windows", "C:\\Malformed\\Root\\Does\\Not\\Exist"]) {
    it(`#given unusable roots ${root} #when production callers resolve tools #then they return handled failures without launching`, () => {
      const result = probe(`
        import { resolveWindowsSystemToolExistent } from ${JSON.stringify(resolverUrl)};
        import { enumerateProcesses, createDefaultProcessKiller } from ${JSON.stringify(sweepUrl)};
        import { terminateProcessTree } from ${JSON.stringify(terminationUrl)};
        const resolve = resolveWindowsSystemToolExistent("taskkill.exe");
        const killer = createDefaultProcessKiller("win32");
        const outcomes = await Promise.allSettled([enumerateProcesses("win32"), killer.kill(999999999), killer.terminate(999999999)]);
        const report = await terminateProcessTree(999999999, { platform: "win32", childClosed: Promise.resolve(), graceMs: 0, waitMs: 0 });
        console.log(JSON.stringify({ resolve, statuses: outcomes.map(outcome => outcome.status), report }));
      `, { SystemRoot: root, WINDIR: root })
      expect(result.resolve).toEqual({ found: false, error: expect.any(String) })
      expect(result.statuses).toEqual(["rejected", "rejected", "rejected"])
      expect(result.report.attempts[0].outcome).toBe("failed")
      expect(result.report.survivorPids).toEqual([])
    })
  }

  it("#given a relative SystemRoot and real WINDIR #when resolving #then WINDIR supplies the executable", () => {
    const result = probe(`
      import { resolveWindowsSystemToolExistent } from ${JSON.stringify(resolverUrl)};
      console.log(JSON.stringify(resolveWindowsSystemToolExistent("taskkill.exe")));
    `, { SystemRoot: "relative", WINDIR: process.env["SystemRoot"] ?? process.env["WINDIR"] })
    expect(result.found).toBe(true)
    expect(result.path).toMatch(/\\System32\\taskkill\.exe$/i)
  })

  for (const missingRoot of [true, false]) {
    it(`#given ${missingRoot ? "missing roots" : "a tool removed after resolution"} #when hook cleanup runs #then the direct-child fallback handles the failure`, () => {
      const result = probe(`
        import { mock } from "bun:test";
        import * as childProcess from "node:child_process";
        import { EventEmitter } from "node:events";
        const originalSpawn = childProcess.spawn;
        const proc = new EventEmitter();
        proc.pid = 999999999;
        const signals = [];
        proc.kill = signal => { signals.push(signal); proc.emit("close", 0); return true; };
        let killerLaunches = 0;
        mock.module("node:child_process", () => ({ ...childProcess, spawn: (command, ...args) => {
          if (command === "hook-fixture") return proc;
          killerLaunches++;
          return originalSpawn(command + ".forced-missing", ...args);
        } }));
        const { executeHookCommand } = await import(${JSON.stringify(hookUrl)});
        const deadline = setTimeout(() => { throw new Error("Hook cleanup did not settle"); }, 5000);
        try {
          const result = await executeHookCommand("hook-fixture", "", process.cwd(), { timeoutMs: 0 });
          console.log(JSON.stringify({ result, signals, killerLaunches }));
        } finally {
          clearTimeout(deadline);
        }
      `, missingRoot ? { SystemRoot: "relative", WINDIR: "" } : {})
      expect(result.result.exitCode).toBe(124)
      expect(result.signals).toEqual(["SIGKILL"])
      expect(result.killerLaunches).toBe(missingRoot ? 0 : 1)
      if (!missingRoot) expect(result.result.stderr).toContain("ENOENT")
    })
  }

  it("#given a forced missing executable #when checking the real filesystem #then the result is nonfatal and has no launch path", () => {
    const result = probe(`
      import { resolveWindowsSystemToolExistent } from ${JSON.stringify(resolverUrl)};
      console.log(JSON.stringify(resolveWindowsSystemToolExistent("definitely-not-a-real-tool.exe")));
    `)
    expect(result).toEqual({ found: false, error: expect.any(String) })
  })
})
