import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";

const processUrl = new URL("./process.ts", import.meta.url).href;

describe.skipIf(process.platform !== "win32")("LSP Windows process cleanup", () => {
  it.each([
    { SystemRoot: undefined, WINDIR: undefined },
    { SystemRoot: "relative", WINDIR: "C:Windows" },
    { SystemRoot: "relative", WINDIR: process.env["SystemRoot"] ?? process.env["WINDIR"] },
  ])("#given roots %j and no System32 on PATH #when killing an owned process #then cleanup completes", roots => {
    const result = spawnSync(process.execPath, ["--eval", `
      import { once } from "node:events";
      import { spawnProcess } from ${JSON.stringify(processUrl)};
      for (const [key, value] of ${JSON.stringify(Object.entries(roots))}) {
        if (value === null) delete process.env[key]; else process.env[key] = value;
      }
      const proc = spawnProcess([process.execPath, "--eval", 'console.log("ready"); process.stdin.resume()'], {
        cwd: process.cwd(), env: process.env,
      });
      try {
        await once(proc.stdout, "data", { signal: AbortSignal.timeout(5000) });
        proc.kill();
        await proc.exited;
        console.log(JSON.stringify({ exited: true }));
      } finally {
        if (proc.exitCode === null) proc.kill("SIGKILL");
      }
    `], {
      env: { ...process.env, PATH: "" },
      encoding: "utf8",
      timeout: 10_000,
      windowsHide: true,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(result.stderr || `Probe exited with ${result.status}`);
    expect(JSON.parse(result.stdout)).toEqual({ exited: true });
  }, 15_000);
});
