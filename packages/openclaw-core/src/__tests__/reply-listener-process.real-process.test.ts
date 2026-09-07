import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { isReplyListenerDaemonProcess, REPLY_LISTENER_DAEMON_IDENTITY_MARKER } from "../reply-listener-process"

// The fake-spawn tests prove which branch runs; only a real child proves the platform
// command line lookup works (#7885: the win32 branch shipped with zero Windows execution).
const scriptDir = mkdtempSync(join(tmpdir(), "openclaw-reply-listener-identity-"))
const idleScript = join(scriptDir, "idle-daemon.ts")
writeFileSync(idleScript, "setTimeout(() => {}, 60_000)\n")

function spawnIdleChild(extraArgs: readonly string[]) {
  return Bun.spawn([process.execPath, "run", idleScript, ...extraArgs], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  })
}

afterAll(() => {
  rmSync(scriptDir, { recursive: true, force: true })
})

describe("isReplyListenerDaemonProcess against real processes", () => {
  test(
    "#given live children with and without the daemon marker #when probing their pids #then only the marked child is the daemon and a dead pid is not",
    async () => {
      const marked = spawnIdleChild([REPLY_LISTENER_DAEMON_IDENTITY_MARKER])
      const unmarked = spawnIdleChild([])
      try {
        expect(await isReplyListenerDaemonProcess(marked.pid)).toBe(true)
        expect(await isReplyListenerDaemonProcess(unmarked.pid)).toBe(false)
      } finally {
        marked.kill()
        unmarked.kill()
        await Promise.all([marked.exited, unmarked.exited])
      }
      expect(await isReplyListenerDaemonProcess(marked.pid)).toBe(false)
    },
    30_000,
  )
})
