import { afterEach, describe, expect, test } from "bun:test"
import { execFileSync, spawnSync } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { extractReleaseNotes } from "./changelog-release-notes"
import { unreleasedBody } from "./changelog-fragments"

const roots: string[] = []
const published = "## [5.1.44] - 2026-10-23\n\nPublished payload.\n"
const scriptFiles = [
  "stamp-release-changelog.ts", "changelog-release-notes.ts", "changelog-fragments.ts",
  "changelog-gate-rules.ts", "check-pr-changelog.ts", "changelog-gate.config.ts", "release-pr-marker.ts",
]

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture(legacy: string, fragments: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "changelog-stamp-"))
  roots.push(root)
  mkdirSync(join(root, "script"))
  mkdirSync(join(root, "changes/unreleased"), { recursive: true })
  for (const file of scriptFiles) copyFileSync(new URL(file, import.meta.url), join(root, "script", file))
  for (const [file, content] of Object.entries(fragments)) writeFileSync(join(root, "changes/unreleased", file), content)
  const before = `# Changelog\n\n## [Unreleased]\n\n${legacy ? `${legacy}\n\n` : ""}${published}`
  writeFileSync(join(root, "CHANGELOG.md"), before)
  const stamp = (version = "5.1.45") => spawnSync(process.execPath, [join(root, "script/stamp-release-changelog.ts"), version, "2026-10-24"], {
    cwd: root, encoding: "utf8", timeout: 10_000,
  })
  return { root, before, stamp }
}

describe("release stamp CLI", () => {
  test.each(["", "Legacy payload."])("consumes fragments and preserves published history with legacy=%j", (legacy) => {
    // given: the post-5.1.44 changelog shape, optionally carrying transition notes
    const { root, stamp } = fixture(legacy, { "7.md": "Older payload.", "008.md": "Newer payload." })
    const git = (...args: string[]) => execFileSync("git", args, {
      cwd: root, encoding: "utf8", env: { ...process.env, GIT_MASTER: "1" },
    }).trim()
    git("init", "-q")
    git("config", "user.name", "Changelog test")
    git("config", "user.email", "changelog@example.invalid")
    git("add", ".")
    git("commit", "-qm", "base")
    const base = git("rev-parse", "HEAD")

    // when: release preparation stamps and stages the real files
    const result = stamp()
    expect(result.status, result.stderr).toBe(0)
    git("add", "CHANGELOG.md", "changes")
    git("commit", "-qm", "release: v5.1.45")
    const gate = spawnSync(process.execPath, [fileURLToPath(new URL("./check-pr-changelog.ts", import.meta.url))], {
      cwd: root, encoding: "utf8", timeout: 10_000,
      env: {
        ...process.env, GIT_MASTER: "1", CHANGELOG_GATE_BASE: base, CHANGELOG_GATE_BASE_REF: "",
        CHANGELOG_GATE_PR: "9", CHANGELOG_GATE_LABELS: "[]", CHANGELOG_GATE_RELEASE: "1",
        CHANGELOG_GATE_BRANCH: "release/v5.1.45-source-state", CHANGELOG_GATE_ACTOR: "sisyphus-dev-ai",
        CHANGELOG_GATE_TITLE: "release: v5.1.45", CHANGELOG_GATE_BODY: "Automated release-state PR for v5.1.45.",
      },
    })

    // then: consumed files are gone and their exact payloads occur only in the new section
    const after = readFileSync(join(root, "CHANGELOG.md"), "utf8")
    expect(unreleasedBody(after)).toBe("")
    expect(extractReleaseNotes(after, "5.1.45")).toBe([legacy, "Newer payload.", "Older payload."].filter(Boolean).join("\n\n"))
    expect(after.slice(after.indexOf("## [5.1.44]"))).toBe(published)
    expect(readdirSync(join(root, "changes/unreleased"))).toEqual([])
    expect(git("diff", "--name-only", "--diff-filter=D", base, "HEAD").split("\n")).toEqual(["changes/unreleased/008.md", "changes/unreleased/7.md"])
    expect(gate.status, gate.stderr + gate.stdout).toBe(0)
  })

  test("a duplicate release leaves the changelog and its fragment intact", () => {
    // given
    const { root, before, stamp } = fixture("", { "7.md": "Pending payload." })
    // when
    const result = stamp("5.1.44")
    // then
    expect(result.status).toBe(1)
    expect(readFileSync(join(root, "CHANGELOG.md"), "utf8")).toBe(before)
    expect(readFileSync(join(root, "changes/unreleased/7.md"), "utf8")).toBe("Pending payload.")
  })

  test("an empty fragment set refuses without mutating legacy notes", () => {
    // given
    const { root, before, stamp } = fixture("Legacy payload.", {})
    // when
    const result = stamp()
    // then
    expect(result.status).toBe(1)
    expect(readFileSync(join(root, "CHANGELOG.md"), "utf8")).toBe(before)
    expect(existsSync(join(root, "changes/unreleased"))).toBe(true)
  })
})
