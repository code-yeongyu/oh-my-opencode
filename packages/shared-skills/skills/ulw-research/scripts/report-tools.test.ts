import { describe, expect, onTestFinished, test } from "bun:test"
import { createHash } from "node:crypto"
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, join } from "node:path"

import { COMMANDS, run } from "./report-tools.mjs"

const SCRIPT = join(import.meta.dir, "report-tools.mjs")
const FIXTURES = join(import.meta.dir, "tests", "fixtures")

function sessionDir() {
	const root = mkdtempSync(join(tmpdir(), "report-tools-cli-"))
	onTestFinished(() => rmSync(root, { recursive: true, force: true }))
	const dir = join(root, "20260101-120000")
	mkdirSync(dir)
	return dir
}

function nodeWithoutBun(args: string[]) {
	const nodePath = Bun.which("node")
	if (nodePath === null) throw new Error("node not found on PATH")
	const path = (process.env.PATH ?? "").split(delimiter).filter((entry) => !entry.includes(".bun")).join(delimiter)
	return Bun.spawnSync({ cmd: [nodePath, SCRIPT, ...args], env: { ...process.env, PATH: path } })
}

function defectsFile(dir: string, name: string, codes: string[]) {
	const file = join(dir, name)
	writeFileSync(file, JSON.stringify(codes.map((code) => ({ code, message: code }))))
	return file
}

describe("help and usage", () => {
	test("#given --help --json #when run #then it lists exactly the command matrix", async () => {
		const result = await run(["--help", "--json"])
		expect(result.json.commands).toEqual([...COMMANDS])
		expect(COMMANDS).toEqual(["check", "layout-probe", "repair decide", "outcome init", "outcome set", "outcome gate", "outcome render", "outcome state", "outcome verify", "outcome finish", "outcome briefing", "format-extract", "fact add", "fact quote", "fact retract", "fact export", "fact fill", "fact verify", "fact derive", "source snapshot", "claims index"])
	})

	test("#given no arguments under node #when spawned #then it exits 2 with a usage line on stderr", () => {
		const proc = nodeWithoutBun([])
		expect(proc.exitCode).toBe(2)
		expect(proc.stderr.toString()).toContain("usage")
	})

	test("#given a missing report file #when checked #then it exits 2 naming the path", () => {
		const proc = nodeWithoutBun(["check", "missing-report.html", "--design-spec", "missing-spec.md"])
		expect(proc.exitCode).toBe(2)
		expect(proc.stderr.toString()).toContain("missing-spec.md")
	})
})

describe("check", () => {
	test("#given the bad fixture under node #when checked #then it exits 1 with blockers in stdout JSON", () => {
		const proc = nodeWithoutBun(["check", join(FIXTURES, "bad-report.html"), "--design-spec", join(FIXTURES, "design-spec.md")])
		expect(proc.exitCode).toBe(1)
		const parsed = JSON.parse(proc.stdout.toString())
		expect(parsed.command).toBe("check")
		expect(parsed.counts.blocker).toBeGreaterThanOrEqual(1)
		expect(parsed.layout).toBe("not_run")
	})

	test("#given the good fixture #when checked #then it passes with exit 0", () => {
		const proc = nodeWithoutBun(["check", join(FIXTURES, "good-report.html"), "--design-spec", join(FIXTURES, "design-spec.md")])
		expect(proc.exitCode).toBe(0)
		expect(JSON.parse(proc.stdout.toString()).status).toBe("pass")
	})

	test("#given a layout probe file #when checked #then layout gates run and the layout field is set", async () => {
		const result = await run(["check", join(FIXTURES, "good-report.html"), "--design-spec", join(FIXTURES, "design-spec.md"), "--layout", join(FIXTURES, "boxes.json")])
		expect(result.json.gatesRun).toContain("layout")
		expect(["pass", "fail"]).toContain(result.json.layout)
	})
})

describe("outcome", () => {
	test("#given a promised pdf and docx #when verified before and after setting them #then verify fails then passes", async () => {
		// given
		const dir = sessionDir()
		const pdf = join(dir, "report.pdf")
		writeFileSync(pdf, "x")
		await run(["outcome", "init", "--session-dir", dir, "--promised", "pdf,docx", "--lane", "no-format"])
		// when
		const before = await run(["outcome", "verify", "--session-dir", dir])
		await run(["outcome", "set", "pdf", "delivered", "--path", pdf, "--session-dir", dir])
		await run(["outcome", "set", "docx", "skipped", "--reason", "no editing audience", "--session-dir", dir])
		await run(["outcome", "gate", "static", "pass", "--session-dir", dir])
		await run(["outcome", "gate", "fidelity", "not_run", "--reason", "Fixture has no factual content", "--session-dir", dir])
		const after = await run(["outcome", "verify", "--session-dir", dir])
		// then
		expect(before.exitCode).toBe(1)
		expect(after.exitCode).toBe(0)
		const manifest = JSON.parse(readFileSync(join(dir, "outcome.json"), "utf8"))
		expect(manifest.deliverables.find((row: { format: string }) => row.format === "pdf").path).toBe(pdf)
		expect(manifest.gates.static).toBe("pass")
	})

	test("#given a ledger and a fixed now #when the briefing is asked as JSON #then counts come from the ledger and the dir stamp", async () => {
		const dir = sessionDir()
		await run(["outcome", "init", "--session-dir", dir, "--promised", "html"])
		writeFileSync(join(dir, "sources-ledger.md"), ["[S1] https://a.example/x", "[S2] https://b.example/y", "[Source 3] https://a.example/z"].join("\n"))
		const start = new Date(2026, 0, 1, 12, 0, 0)
		const now = new Date(start.getTime() + 61 * 60_000).toISOString()
		const result = await run(["outcome", "briefing", "--json", "--session-dir", dir, "--now", now])
		expect(result.json.sources).toBe(3)
		expect(result.json.domains).toBe(2)
		expect(result.json.minutes).toBe(61)
	})
})

describe("repair decide", () => {
	test("#given three minor code sets with the same measure #when decided in turn #then the third call stops on plateau", async () => {
		const dir = sessionDir()
		const state = join(dir, "repair-state.json")
		const reasons = []
		for (const [index, code] of ["heading_generic", "heading_too_long", "en_dash_in_prose"].entries()) {
			const result = await run(["repair", "decide", "--state", state, "--defects", defectsFile(dir, `d${index}.json`, [code]), "--artifact-bytes", "4096", "--renders", "1", "--max-attempts", "5"])
			reasons.push(result.json.decision.reason)
		}
		expect(reasons.at(-1)).toBe("plateau")
	})

	test("#given the same defects twice #when decided #then the second call stops on oscillation", async () => {
		const dir = sessionDir()
		const state = join(dir, "repair-state.json")
		const file = defectsFile(dir, "d.json", ["heading_generic"])
		await run(["repair", "decide", "--state", state, "--defects", file, "--artifact-bytes", "4096", "--renders", "1"])
		const second = await run(["repair", "decide", "--state", state, "--defects", file, "--artifact-bytes", "4096", "--renders", "1"])
		expect(second.json.decision.reason).toBe("oscillation")
		expect(second.json.decision.action).toBe("deliver")
	})

	test("#given no artifact proof #when a stop condition holds #then delivery is blocked (fail closed)", async () => {
		const dir = sessionDir()
		const state = join(dir, "repair-state.json")
		const file = defectsFile(dir, "d.json", ["heading_generic"])
		await run(["repair", "decide", "--state", state, "--defects", file])
		const second = await run(["repair", "decide", "--state", state, "--defects", file])
		expect(second.json.decision.action).toBe("block")
		expect(second.exitCode).toBe(1)
	})
})

describe("layout-probe", () => {
	test("#given --json #when run #then the source is an async IIFE", async () => {
		const result = await run(["layout-probe", "--json", "--cap", "20"])
		expect(result.json.source.startsWith("(async () => {")).toBe(true)
		expect(result.json.source).toContain("const CAP = 20;")
	})
})

describe("manifest bookkeeping", () => {
	test("#given a session manifest #when repair decides deliver-on-exhaustion #then outcome.json carries the repair summary and the residual defects", async () => {
		// given
		const dir = sessionDir()
		await run(["outcome", "init", "--session-dir", dir, "--promised", "html"])
		const state = join(dir, "repair-state.json")
		const file = defectsFile(dir, "d.json", ["heading_generic"])
		const proof = ["--artifact-bytes", "4096", "--renders", "1", "--session-dir", dir]
		// when
		await run(["repair", "decide", "--state", state, "--defects", file, ...proof])
		await run(["repair", "decide", "--state", state, "--defects", file, ...proof])
		// then
		const manifest = JSON.parse(readFileSync(join(dir, "outcome.json"), "utf8"))
		expect(manifest.repair).toEqual({ attempts: 2, action: "deliver", reason: "oscillation" })
		expect(manifest.residualDefects.map((d: { code: string }) => d.code)).toEqual(["heading_generic"])
		const briefing = await run(["outcome", "briefing", "--json", "--session-dir", dir])
		expect(briefing.json.residualDefects).toBe(1)
		expect(briefing.json.repair).toEqual({ attempts: 2, action: "deliver", reason: "oscillation" })
	})

	test("#given a clean repair decision #when recorded #then residual defects are emptied", async () => {
		const dir = sessionDir()
		await run(["outcome", "init", "--session-dir", dir, "--promised", "html"])
		const state = join(dir, "repair-state.json")
		await run(["repair", "decide", "--state", state, "--defects", defectsFile(dir, "a.json", ["heading_generic"]), "--session-dir", dir])
		await run(["repair", "decide", "--state", state, "--defects", defectsFile(dir, "b.json", []), "--session-dir", dir])
		const manifest = JSON.parse(readFileSync(join(dir, "outcome.json"), "utf8"))
		expect(manifest.residualDefects).toEqual([])
		expect(manifest.repair.reason).toBe("clean")
	})

	test("#given a ledger and a fixed now #when the run is finished #then finishedAt, elapsedMinutes and source counts are stamped and still validate", async () => {
		const dir = sessionDir()
		const pdf = join(dir, "report.pdf")
		writeFileSync(pdf, "x")
		await run(["outcome", "init", "--session-dir", dir, "--promised", "pdf"])
		await run(["outcome", "set", "pdf", "delivered", "--path", pdf, "--session-dir", dir])
		writeFileSync(join(dir, "sources-ledger.md"), ["[S1] https://a.example/x", "[S2] https://b.example/y"].join("\n"))
		await run(["outcome", "gate", "fidelity", "not_run", "--reason", "Fixture has no factual content", "--session-dir", dir])
		const now = new Date(new Date(2026, 0, 1, 12, 0, 0).getTime() + 30 * 60_000).toISOString()
		const result = await run(["outcome", "finish", "--session-dir", dir, "--now", now])
		const manifest = JSON.parse(readFileSync(join(dir, "outcome.json"), "utf8"))
		expect(result.exitCode).toBe(0)
		expect(manifest.finishedAt).toBe(now)
		expect(manifest.elapsedMinutes).toBe(30)
		expect(manifest.sources).toEqual({ total: 2, domains: 2 })
		expect((await run(["outcome", "verify", "--session-dir", dir])).exitCode).toBe(0)
	})
})

describe("format-extract exit codes", () => {
	test("#given a pdf reference under node #when extracted #then it exits 2 with the unsupported message", () => {
		const dir = sessionDir()
		const pdf = join(dir, "reference.pdf")
		writeFileSync(pdf, "%PDF-1.7")
		const proc = nodeWithoutBun(["format-extract", pdf, "--out", join(dir, "design-spec.md")])
		expect(proc.exitCode).toBe(2)
		expect(proc.stderr.toString()).toContain("unsupported")
	})

	test("#given an unreachable url #when extracted #then it exits 2", () => {
		const dir = sessionDir()
		const proc = nodeWithoutBun(["format-extract", "http://127.0.0.1:9/report.html", "--from-url", "--out", join(dir, "design-spec.md")])
		expect(proc.exitCode).toBe(2)
	})
})

const FIDELITY = join(FIXTURES, "fidelity")
const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex")

type CliRow = { fact_id: string; kind: string; value: string | null }
type CliJson = { data: { row: CliRow; context: { match: string } }; defects: { code: string }[] }

function nodeJson(args: string[]) {
	const proc = nodeWithoutBun(args)
	const stdout = proc.stdout.toString()
	let json = {} as CliJson
	try {
		json = JSON.parse(stdout) as CliJson
	} catch {}
	return { code: proc.exitCode, json, stdout, stderr: proc.stderr.toString() }
}

/** A session with the locked brief, S4 snapshotted, F1 (span), Q1 (completion), and F<n> (span in mm). */
function fidelitySession() {
	const dir = sessionDir()
	copyFileSync(join(FIXTURES, "fidelity-brief-locked.md"), join(dir, "brief.md"))
	const s = ["--session-dir", dir]
	const snap = nodeJson(["source", "snapshot", "--id", "S4", "--html", join(FIDELITY, "sources", "S4.html"), ...s])
	const add = nodeJson(["fact", "add", "--source", "S4", "--find", "Span length", "--label", "span_len", "--json", ...s])
	const quote = nodeJson(["fact", "quote", "--source", "S4", "--match", "no earlier than 2027", "--label", "completion", "--json", ...s])
	const derive = nodeJson(["fact", "derive", "--op", "convert", "F1", "--to", "mm", "--label", "span_mm", "--json", ...s])
	const mm = derive.json.data?.row?.fact_id
	const source = [
		'<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Bridge</title></head><body><h1>Bridge</h1>',
		"<h2>Findings</h2>",
		"<p>The span length is {{F1:span_len}} [S4].</p>",
		`<p>In millimetres the span is {{${mm}:span_mm}} [S4].</p>`,
		"<p>The operator wrote {{Q1:completion}} [S4].</p>",
		"<h2>How this report was made</h2><p>Collected from one cited public page [S4].</p>",
		'<h2>Sources</h2><ol><li id="s4">[S4] Bridge page, retrieved 2026-10-01.</li></ol></body></html>',
	].join("\n")
	writeFileSync(join(dir, "report.src.html"), source)
	return { dir, s, snap, add, quote, derive, mm }
}

function verify(dir: string, report: string, extra: string[] = []) {
	return nodeJson(["fact", "verify", join(dir, report), "--sources", join(dir, "sources"), "--brief", join(dir, "brief.md"), "--session-dir", dir, ...extra])
}

const codesOf = (json: { defects?: { code: string }[] }) => (json.defects ?? []).map((d) => d.code)

describe("fact, source, and claims under node", () => {
	test("#given a fresh session #when snapshot, add, quote, derive, fill, and verify run #then the filled report verifies clean", () => {
		// given
		const { dir, s, snap, add, quote, derive, mm } = fidelitySession()
		// when
		const filled = nodeJson(["fact", "fill", join(dir, "report.src.html"), "--out", join(dir, "report.html"), ...s])
		const checked = verify(dir, "report.html")
		// then
		expect(snap.code).toBe(0)
		expect(add.code).toBe(0)
		expect(add.json.data.row.value).toBe("320")
		expect(add.json.data.context.match).toBe("320 m")
		expect(quote.code).toBe(0)
		expect(quote.json.data.row.fact_id).toBe("Q1")
		expect(derive.code).toBe(0)
		expect(mm).toBe("F2")
		expect(filled.code).toBe(0)
		expect(readFileSync(join(dir, "report.html"), "utf8")).toContain("320,000 mm (320 m)")
		expect(checked.code).toBe(0)
		expect(checked.json.defects).toEqual([])
		const record = JSON.parse(readFileSync(join(dir, "fidelity-defects.json"), "utf8"))
		expect(record.artifact_sha256).toBe(sha256(join(dir, "report.html")))
	})

	test("#given a filled report #when a value is hand-edited or a number typed #then verify exits 1 with the code", () => {
		const { dir, s } = fidelitySession()
		nodeJson(["fact", "fill", join(dir, "report.src.html"), "--out", join(dir, "report.html"), ...s])
		const html = readFileSync(join(dir, "report.html"), "utf8")
		writeFileSync(join(dir, "unit.html"), html.replace("320 m", "320 mm"))
		writeFileSync(join(dir, "typed.html"), html.replace("<h2>How", "<p>Revenue grew 12% [S4].</p>\n<h2>How"))
		const unit = verify(dir, "unit.html")
		const typed = verify(dir, "typed.html")
		expect(unit.code).toBe(1)
		expect(codesOf(unit.json)).toContain("unit_mismatch")
		expect(typed.code).toBe(1)
		expect(codesOf(typed.json)).toContain("untraceable_number")
	})

	test("#given an anchor that is not in the source #when fact add runs #then it exits 1 with fact_not_located and writes no row", () => {
		const { dir, s } = fidelitySession()
		const proc = nodeJson(["fact", "add", "--source", "S4", "--find", "nope", "--label", "x", ...s])
		expect(proc.code).toBe(1)
		expect(proc.stdout).toContain("fact_not_located")
		expect(JSON.parse(readFileSync(join(dir, "fact-ledger.json"), "utf8")).rows.map((r: { fact_id: string }) => r.fact_id)).toEqual(["F1", "Q1", "F2"])
	})

	test("#given a snapshotted source #when snapshotted again with the same or different content #then same is a no-op and different exits 1", () => {
		const { dir, s } = fidelitySession()
		writeFileSync(join(dir, "other.txt"), "Span length: 999 m\n")
		expect(nodeJson(["source", "snapshot", "--id", "S4", "--html", join(FIDELITY, "sources", "S4.html"), ...s]).code).toBe(0)
		expect(nodeJson(["source", "snapshot", "--id", "S4", "--text", join(dir, "other.txt"), ...s]).code).toBe(1)
	})

	test("#given an assumed value with and without a rationale #when added #then the row is kind assumed, and no rationale exits 2", () => {
		const { s } = fidelitySession()
		const added = nodeJson(["fact", "add", "--assumed", "12", "--unit", "%", "--rationale", "planning share chosen by the requester", "--label", "share_assumed", "--json", ...s])
		expect(added.code).toBe(0)
		expect(added.json.data.row.kind).toBe("assumed")
		expect(nodeJson(["fact", "add", "--assumed", "12", "--label", "x", ...s]).code).toBe(2)
	})

	test("#given the fixture claim graph #when claims index runs #then claims.json lists its claims", () => {
		const dir = sessionDir()
		const proc = nodeJson(["claims", "index", join(FIDELITY, "claim-graph.md"), "--out", join(dir, "claims.json")])
		expect(proc.code).toBe(0)
		expect(JSON.parse(readFileSync(join(dir, "claims.json"), "utf8")).claims.length).toBeGreaterThan(0)
	})

	test("#given a ledger #when exported as csv #then rows carry fact_id and plot_value and stderr has the coverage line", () => {
		const { s } = fidelitySession()
		const proc = nodeJson(["fact", "export", "--csv", ...s])
		expect(proc.code).toBe(0)
		expect(proc.stdout.split("\n")[0]).toContain("fact_id")
		expect(proc.stdout).toContain("F2")
		expect(proc.stderr).toContain("1 of 1 sources snapshotted")
	})
})

type Pair = { pair_id: string; kind: string; fact_ids?: string[]; sentence: string; quote?: string }

/** A filled session plus the pair artifact `fact pairs` wrote for it. */
function pairedSession() {
	const session = fidelitySession()
	const { dir, s } = session
	nodeJson(["fact", "fill", join(dir, "report.src.html"), "--out", join(dir, "report.html"), ...s])
	const pairs = nodeJson(["fact", "pairs", join(dir, "report.html"), "--ledger", join(dir, "fact-ledger.json"), "--out", join(dir, "pairs.json"), ...s])
	return { ...session, pairs }
}

function verdicts(dir: string, name: string, tier: string, list: object[]) {
	const file = join(dir, name)
	writeFileSync(file, JSON.stringify({ model_tier: tier, verdicts: list }))
	return file
}

const calibrationRows = (dir: string) =>
	readFileSync(join(dir, "fidelity-calibration.jsonl"), "utf8")
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line))
		.filter((row) => row.header !== true)

describe("meaning verifier under node", () => {
	test("#given the filled fixture #when fact pairs runs #then pairs.json holds one quote pair per cited ledger quote", () => {
		const { dir, pairs } = pairedSession()
		const written = JSON.parse(readFileSync(join(dir, "pairs.json"), "utf8"))
		expect(pairs.code).toBe(0)
		expect(written.skipped).toBe(false)
		expect(written.pairs.map((p: Pair) => [p.pair_id, p.kind, p.fact_ids])).toEqual([
			["P1", "quote", ["F1"]],
			["P2", "quote", ["Q1"]],
		])
		expect(written.pairs_sha256).toMatch(/^[0-9a-f]{64}$/)
	})

	test("#given cheap and strong verdicts agreeing on hedge_dropped #when meaning-check runs #then it exits 1 with one confirmed defect and one calibration line", () => {
		const { dir, s } = pairedSession()
		const drift = { pair_id: "P2", verdict: "drift", drift_kind: "hedge_dropped", fragment: "no earlier than 2027", source_fragment: "we estimate", explanation: "The estimate reads as a fact." }
		const cheap = verdicts(dir, "cheap.json", "cheap", [drift, { pair_id: "P1", verdict: "ok" }])
		const strong = verdicts(dir, "strong.json", "strong", [drift])
		const checked = nodeJson(["fact", "meaning-check", "--pairs", join(dir, "pairs.json"), "--verdicts", cheap, "--verdicts", strong, ...s])
		const record = JSON.parse(readFileSync(join(dir, "fidelity-meaning-defects.json"), "utf8"))
		expect(checked.code).toBe(1)
		expect(codesOf(checked.json)).toEqual(["meaning_drift_confirmed"])
		expect(codesOf(record)).toEqual(["meaning_drift_confirmed"])
		expect(calibrationRows(dir)).toHaveLength(1)
		expect(calibrationRows(dir)[0]).toMatchObject({ pair_id: "P2", drift_kind: "hedge_dropped", confirmed: true, disputed: false })
		const again = nodeJson(["fact", "meaning-check", "--pairs", join(dir, "pairs.json"), "--verdicts", cheap, "--verdicts", strong, ...s])
		expect(again.code).toBe(1)
		expect(calibrationRows(dir)).toHaveLength(1)
	})

	test("#given a dispute on the confirmed pair #when meaning-check runs #then the defect stays and the calibration line is disputed", () => {
		const { dir, s } = pairedSession()
		const drift = { pair_id: "P2", verdict: "drift", drift_kind: "hedge_dropped", fragment: "no earlier than 2027", source_fragment: "we estimate" }
		const files = ["--verdicts", verdicts(dir, "cheap.json", "cheap", [drift]), "--verdicts", verdicts(dir, "strong.json", "strong", [drift])]
		const checked = nodeJson(["fact", "meaning-check", "--pairs", join(dir, "pairs.json"), ...files, "--dispute", "P2", "--reason", "the operator states it", ...s])
		expect(checked.code).toBe(1)
		expect(codesOf(checked.json)).toEqual(["meaning_drift_confirmed"])
		expect(calibrationRows(dir)[0]).toMatchObject({ pair_id: "P2", disputed: true, reason: "the operator states it" })
	})

	test("#given a verdict whose fragment is not in the sentence #when meaning-check runs #then no defect and stderr JSON counts one dropped verdict", () => {
		const { dir, s } = pairedSession()
		const cheap = verdicts(dir, "cheap.json", "cheap", [{ pair_id: "P2", verdict: "drift", drift_kind: "hedge_dropped", fragment: "certainly by 2027", source_fragment: "we estimate" }])
		const checked = nodeJson(["fact", "meaning-check", "--pairs", join(dir, "pairs.json"), "--verdicts", cheap, ...s])
		const summary = JSON.parse(checked.stderr.trim().split("\n").at(-1) ?? "{}")
		expect(checked.code).toBe(0)
		expect(codesOf(checked.json)).toEqual([])
		expect(summary).toMatchObject({ command: "fact meaning-check", defects: 0, dropped: 1 })
	})

	test("#given a brief with meaning check off #when fact pairs runs #then it exits 0 and writes skipped", () => {
		const { dir, s } = fidelitySession()
		const brief = readFileSync(join(dir, "brief.md"), "utf8").replace("meaning check: on", "meaning check: off")
		writeFileSync(join(dir, "brief.md"), brief)
		nodeJson(["fact", "fill", join(dir, "report.src.html"), "--out", join(dir, "report.html"), ...s])
		const pairs = nodeJson(["fact", "pairs", join(dir, "report.html"), "--out", join(dir, "pairs.json"), ...s])
		expect(pairs.code).toBe(0)
		expect(JSON.parse(readFileSync(join(dir, "pairs.json"), "utf8"))).toMatchObject({ skipped: true })
	})
})

type PolishJson = { data: { out: string; applied: number; rejected: number; unlocated: number }; defects: { code: string; index: number }[] }

/** A filled session whose first finding names an acquirer and a target around F1. */
function polishSession() {
	const session = fidelitySession()
	const { dir, s } = session
	const source = readFileSync(join(dir, "report.src.html"), "utf8").replace("<p>The span length is", "<p>Acme acquired Bolt before the span length reached")
	writeFileSync(join(dir, "report.src.html"), source)
	nodeJson(["fact", "fill", join(dir, "report.src.html"), "--out", join(dir, "report.html"), ...s])
	return session
}

function polishApply(dir: string, edits: string) {
	const args = ["fact", "polish-apply", join(dir, "report.html"), "--edits", edits, "--ledger", join(dir, "fact-ledger.json"), "--out", join(dir, "report.polished.html")]
	const proc = nodeJson(args)
	return { ...proc, json: proc.json as unknown as PolishJson }
}

describe("polish wiring under node", () => {
	test("#given the fixture edits #when fact polish-apply runs #then it exits 0, applies the wording edit, and rejects the numeral edit", () => {
		const { dir } = polishSession()
		const applied = polishApply(dir, join(FIDELITY, "polish-edits.json"))
		const polished = readFileSync(join(dir, "report.polished.html"), "utf8")
		expect(applied.code).toBe(0)
		expect(applied.json.data).toMatchObject({ applied: 1, rejected: 1, unlocated: 0 })
		expect(applied.json.defects.map((d) => [d.code, d.index])).toEqual([["polish_edit_rejected", 1]])
		expect(polished).toContain("Collected from a single cited public page")
		expect(polished).toContain("retrieved 2026-10-01")
		expect(polished).not.toContain("2026-10-02")
	})

	test("#given a polished copy edited by hand #when fact polish-diff runs #then it exits 1 with polish_diff_fail", () => {
		const { dir } = polishSession()
		const html = readFileSync(join(dir, "report.html"), "utf8")
		writeFileSync(join(dir, "hand.html"), html.replace("320 m", "321 m"))
		const diffed = nodeJson(["fact", "polish-diff", "--before", join(dir, "report.html"), "--after", join(dir, "hand.html"), "--ledger", join(dir, "fact-ledger.json")])
		expect(diffed.code).toBe(1)
		expect(codesOf(diffed.json)).toContain("polish_diff_fail")
	})

	test("#given an accepted subject and object swap #when fact pairs runs with --changed-since #then only that sentence's pair is emitted, with the new text", () => {
		const { dir, s } = polishSession()
		const edits = join(dir, "swap.json")
		writeFileSync(edits, JSON.stringify([{ before: "Acme acquired Bolt", after: "Bolt acquired Acme", reason: "word order" }]))
		const applied = polishApply(dir, edits)
		const map = join(dir, "report.html.fill-map.json")
		const changed = nodeJson(["fact", "pairs", join(dir, "report.polished.html"), "--changed-since", map, "--out", join(dir, "pairs-changed.json"), ...s])
		const written = JSON.parse(readFileSync(join(dir, "pairs-changed.json"), "utf8"))
		expect(applied.json.data).toMatchObject({ applied: 1, rejected: 0 })
		expect(changed.code).toBe(0)
		expect(written.pairs.map((p: Pair) => [p.kind, p.fact_ids])).toEqual([["quote", ["F1"]]])
		expect(written.pairs[0].sentence).toContain("Bolt acquired Acme")
	})
})

describe("markdown editions under node", () => {
	const MD = ["# Bridge", "", "## Findings", "", "The span length is {{F1:span_len}} [S4].", "", "The operator wrote {{Q1:completion}} [S4].", "", "## How this report was made", "", "Collected from one cited public page [S4].", "", "## Sources", "", "1. [S4] Bridge page, retrieved 2026-10-01.", ""].join("\n")

	function mdSession() {
		const session = fidelitySession()
		writeFileSync(join(session.dir, "report.src.md"), MD)
		const filled = nodeJson(["fact", "fill", join(session.dir, "report.src.md"), "--format", "md", "--out", join(session.dir, "report.md"), ...session.s])
		return { ...session, filled }
	}

	test("#given a markdown source #when filled and verified as md #then verify passes and records the md bytes", () => {
		const { dir, filled } = mdSession()
		const checked = verify(dir, "report.md", ["--format", "md"])
		expect(filled.code).toBe(0)
		expect(readFileSync(join(dir, "report.md"), "utf8")).toContain("The span length is 320 m [S4].")
		expect(checked.code).toBe(0)
		expect(checked.json.defects).toEqual([])
		expect(JSON.parse(readFileSync(join(dir, "fidelity-defects.json"), "utf8")).artifact_sha256).toBe(sha256(join(dir, "report.md")))
	})

	test("#given a filled markdown edition #when a value is hand-edited or a number typed #then md verify exits 1 with the code", () => {
		const { dir } = mdSession()
		const md = readFileSync(join(dir, "report.md"), "utf8")
		writeFileSync(join(dir, "typed.md"), md.replace("## How", "Revenue grew 12% [S4].\n\n## How"))
		copyFileSync(join(dir, "report.md.fill-map.json"), join(dir, "typed.md.fill-map.json"))
		const typed = verify(dir, "typed.md", ["--format", "md"])
		expect(typed.code).toBe(1)
		expect(codesOf(typed.json)).toContain("untraceable_number")
	})

	test("#given a filled markdown edition #when fact pairs runs on it #then it pairs the same quotes as the html edition", () => {
		const { dir, s } = mdSession()
		const pairs = nodeJson(["fact", "pairs", join(dir, "report.md"), "--out", join(dir, "pairs.json"), ...s])
		expect(pairs.code).toBe(0)
		expect(JSON.parse(readFileSync(join(dir, "pairs.json"), "utf8")).pairs.map((p: Pair) => p.fact_ids)).toEqual([["F1"], ["Q1"]])
	})
})

describe("repair decide with several defect files", () => {
	test("#given two --defects files #when decided #then the attempt signature carries both codes", async () => {
		const dir = sessionDir()
		const state = join(dir, "repair-state.json")
		await run(["repair", "decide", "--state", state, "--defects", defectsFile(dir, "a.json", ["heading_generic"]), "--defects", defectsFile(dir, "b.json", ["untraceable_number"])])
		const signature = JSON.parse(readFileSync(state, "utf8")).attempts[0].signature
		expect(signature).toContain("heading_generic")
		expect(signature).toContain("untraceable_number")
	})
})

describe("fidelity delivery barrier", () => {
	async function deliveredSession(codes: string[]) {
		const { dir, s } = fidelitySession()
		nodeJson(["fact", "fill", join(dir, "report.src.html"), "--out", join(dir, "report.html"), ...s])
		const record = (list: string[]) => writeFileSync(join(dir, "fidelity-defects.json"), JSON.stringify({ command: "fact verify", artifact_sha256: sha256(join(dir, "report.html")), defects: list.map((code) => ({ code, message: code })) }))
		record(codes)
		await run(["outcome", "init", "--session-dir", dir, "--promised", "html"])
		await run(["outcome", "set", "html", "delivered", "--path", join(dir, "report.html"), "--verified-by", join(dir, "fidelity-defects.json"), "--session-dir", dir])
		const decide = ["repair", "decide", "--state", join(dir, "repair-state.json"), "--defects", join(dir, "fidelity-defects.json"), "--artifact-bytes", "4096", "--renders", "1", "--session-dir", dir]
		await run(decide)
		const decision = await run(decide)
		return { dir, record, decision }
	}

	test("#given an unregistered appendix value #when verified #then untraceable_number and outcome verify refuses", async () => {
		const { dir, s } = fidelitySession()
		nodeJson(["fact", "fill", join(dir, "report.src.html"), "--out", join(dir, "report.html"), ...s])
		const html = readFileSync(join(dir, "report.html"), "utf8").replace("<h2>How", "<h2>Appendix</h2>\n<p>Revenue grew 12% [S4].</p>\n<h2>How")
		writeFileSync(join(dir, "report.html"), html)
		const checked = verify(dir, "report.html")
		await run(["outcome", "init", "--session-dir", dir, "--promised", "html"])
		await run(["outcome", "set", "html", "delivered", "--path", join(dir, "report.html"), "--verified-by", join(dir, "fidelity-defects.json"), "--session-dir", dir])
		const outcome = await run(["outcome", "verify", "--session-dir", dir])
		expect(codesOf(checked.json)).toContain("untraceable_number")
		expect(outcome.exitCode).toBe(1)
		expect(outcome.json.problems.map((p: { code: string }) => p.code)).toContain("fidelity_unresolved")
	})

	for (const code of ["untraceable_number", "unbound_sentence"]) {
		test(`#given ${code} left after repair delivers on exhaustion #when verified and finished #then both refuse, and an empty record passes`, async () => {
			const { dir, record, decision } = await deliveredSession([code])
			const refused = await run(["outcome", "verify", "--session-dir", dir])
			const finish = await run(["outcome", "finish", "--session-dir", dir])
			record([])
			const passed = await run(["outcome", "verify", "--session-dir", dir])
			const finished = await run(["outcome", "finish", "--session-dir", dir])
			expect(decision.json.decision.action).toBe("deliver")
			expect(refused.exitCode).toBe(1)
			expect(JSON.stringify(refused.json.problems)).toContain(`fidelity_unresolved: ${code}`)
			expect(finish.exitCode).toBe(1)
			expect(passed.exitCode).toBe(0)
			expect(finished.exitCode).toBe(0)
		})
	}

	test("#given a clean main report and an inline edition #when the edition lacks or mismatches its verify record #then edition_unverified, and its own record passes", async () => {
		// given
		const { dir, s } = fidelitySession()
		nodeJson(["fact", "fill", join(dir, "report.src.html"), "--out", join(dir, "report.html"), ...s])
		expect(verify(dir, "report.html").code).toBe(0)
		expect(nodeJson(["fact", "fill", join(dir, "report.src.html"), "--inline", "--out", join(dir, "report.inline.html"), ...s]).code).toBe(0)
		await run(["outcome", "init", "--session-dir", dir, "--promised", "html,pdf"])
		await run(["outcome", "set", "html", "delivered", "--path", join(dir, "report.html"), "--verified-by", join(dir, "fidelity-defects.json"), "--session-dir", dir])
		const problems = async () => {
			const result = await run(["outcome", "verify", "--session-dir", dir])
			return { exitCode: result.exitCode, codes: result.json.problems.map((p: { code: string }) => p.code) }
		}
		// when: no --verified-by
		await run(["outcome", "set", "pdf", "delivered", "--path", join(dir, "report.inline.html"), "--session-dir", dir])
		const missing = await problems()
		// when: a record for different bytes
		expect(verify(dir, "report.inline.html", ["--out", join(dir, "fidelity-inline.json")]).code).toBe(0)
		const inline = readFileSync(join(dir, "report.inline.html"), "utf8")
		writeFileSync(join(dir, "report.inline.html"), inline.replace("320,000 mm", "330,000 mm"))
		await run(["outcome", "set", "pdf", "delivered", "--path", join(dir, "report.inline.html"), "--verified-by", join(dir, "fidelity-inline.json"), "--session-dir", dir])
		const altered = await problems()
		// when: restored to the verified bytes
		writeFileSync(join(dir, "report.inline.html"), inline)
		const matched = await problems()
		// then
		expect(missing).toEqual({ exitCode: 1, codes: ["edition_unverified"] })
		expect(altered).toEqual({ exitCode: 1, codes: ["edition_unverified"] })
		expect(matched).toEqual({ exitCode: 0, codes: [] })
	})
})
