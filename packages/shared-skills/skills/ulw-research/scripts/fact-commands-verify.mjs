// fact-commands-verify.mjs - `fact verify` and the fidelity delivery barrier of `outcome verify`.
//
// fact verify runs the deterministic fidelity gate over one filled HTML or Markdown edition and
// writes a record (default $SESSION_DIR/fidelity-defects.json) carrying the artifact's sha256. It
// exits 1 on any blocker or major defect (the orchestrator then records `outcome gate fidelity
// fail`); minors alone exit 0 and are listed. A Markdown edition is read through md-lite into an
// escaped HTML projection (same line numbers) and checked with its fill map, which is the only
// record of where its values sit; LaTeX is verified through its Markdown source.
//
// fidelityProblems applies the gate's registry policy independently of the repair budget.
// HTML/PDF/DOCX need a gate record or an explicitly logged not_run reason, even without a ledger.
// That logged exemption covers deliveries this harness never gated: once a ledger or a fidelity
// record exists for the session, the barrier refuses the unverified edition regardless of it.
// Recorded editions must match their source bytes (`edition_unverified`).

import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

import { CliError, readJsonFile, writeJsonAtomic } from "./cli-support.mjs"
import { recompute } from "./fact-derive.mjs"
import { LEDGER_FILENAME, readLedger } from "./fact-ledger.mjs"
import { blocksDelivery, checkFidelity, deliveryBlockReason } from "./gates-fidelity.mjs"
import { parseMarkdown } from "./md-lite.mjs"
import { escapeHtml, renderQuote, renderValueHtml } from "./placeholder.mjs"
import { sessionDirOf } from "./source-commands.mjs"

export const FIDELITY_RECORD = "fidelity-defects.json"

const sha256Of = (content) => createHash("sha256").update(content).digest("hex")

function readText(path) {
	try {
		return readFileSync(path, "utf8")
	} catch (error) {
		throw new CliError(`cannot read ${path}: ${error.code ?? error.message}`)
	}
}

const TAG = { heading: null, paragraph: "p", list_item: "li", blockquote: "blockquote", code: "code" }
const GROUP = { list_item: ["<ul>", "</ul>"], table_row: ["<table>", "</table>"] }

/** Escaped text with inline links and code spans kept as elements, so a URL is never read as prose. */
const inline = (text) =>
	escapeHtml(text)
		.replace(/\[([^\]]+)\]\(([^)\s]+)\)/gu, '<a href="$2">$1</a>')
		.replace(/`([^`]+)`/gu, "<code>$1</code>")

const QUOTED = /^"([\s\S]*)" (\[S\d+\])$/u

/** The element the HTML fill writes for one fill-map entry, or null when its bytes were edited since. */
function entryHtml(text, entry, rows) {
	const body = text.slice(entry.start, entry.end)
	if (body !== entry.rendered) return null
	const row = rows.get(entry.fact_id)
	if (entry.translates) return `<span data-translates="${entry.translates}">${inline(body.replace(/^<!--[\s\S]*?-->\s*/u, ""))}</span>`
	if (!row) return `<data data-fact="${entry.fact_id}">${escapeHtml(body)}</data>`
	const quoted = row.kind === "quote" ? QUOTED.exec(body) : null
	if (quoted) return renderQuote(row, entry.selector ?? "full", quoted[1], "html")
	return row.kind === "quote" ? null : renderValueHtml(row, body)
}

/** [from, to) of the filled text as HTML, each intact fill-map entry rebuilt as its fill element. */
function spanHtml(text, from, to, entries, rows, stale) {
	let html = ""
	let cursor = from
	for (const entry of entries) {
		if (entry.start < cursor || entry.end > to || entry.start < from || entry.replaced !== undefined) continue
		const element = entryHtml(text, entry, rows)
		if (element === null) continue
		stale.delete(entry)
		html += inline(text.slice(cursor, entry.start)) + element
		cursor = entry.end
	}
	return html + inline(text.slice(cursor, to))
}

/**
 * An escaped HTML projection of a filled Markdown edition: one element per md-lite block, each on
 * the source line it starts on, lists and table rows grouped. Never a rendering for readers.
 * @param {string} text the filled Markdown
 * @param {{ fact_id: string, start: number, end: number, rendered: string, replaced?: string, translates?: string }[]} entries its fill map
 * @param {{ rows: object[] }} ledger
 * @returns {{ html: string, stale: object[] }} stale: entries whose bytes changed after fill (checked by text)
 */
export function markdownAsHtml(text, entries, ledger) {
	const sorted = [...(entries ?? [])].sort((a, b) => a.start - b.start)
	const rows = new Map((ledger?.rows ?? []).map((row) => [row.fact_id, row]))
	const stale = new Set(sorted.filter((entry) => entry.replaced === undefined))
	const lineAt = (offset) => text.slice(0, offset).split("\n").length
	let html = "<!doctype html><html><head><title>md</title></head><body>"
	let line = 1
	let open = null
	for (const block of parseMarkdown(text).blocks) {
		if (open && open !== block.kind) html += GROUP[open][1]
		const target = lineAt(block.start)
		if (target > line) html += "\n".repeat(target - line)
		line = Math.max(line, target) + (text.slice(block.start, block.end).match(/\n/gu)?.length ?? 0)
		if (GROUP[block.kind] && open !== block.kind) html += GROUP[block.kind][0]
		open = GROUP[block.kind] ? block.kind : null
		const inner = (from, to) => spanHtml(text, from, to, sorted, rows, stale)
		if (block.kind === "table_row") html += `<tr>${block.cells.map((cell) => `<td>${inner(cell.start, cell.end)}</td>`).join("")}</tr>`
		else if (block.kind === "code") html += `<pre><code>${escapeHtml(block.text)}</code></pre>`
		else {
			const tag = TAG[block.kind] ?? `h${block.level}`
			const replaced = block.kind === "blockquote" ? sorted.find((entry) => entry.replaced !== undefined && entry.start <= block.start && entry.end >= block.end) : undefined
			const attrs = replaced ? ` data-fact="${replaced.fact_id}" data-replaced="${escapeHtml(replaced.replaced)}"` : ""
			html += `<${tag}${attrs}>${inner(block.start, block.end)}</${tag}>`
		}
	}
	return { html: `${html}${open ? GROUP[open][1] : ""}</body></html>\n`, stale: [...stale] }
}

/** The report's format (from --format or its extension) and, for Markdown, its fill map entries. */
export function readEdition(report, flags) {
	const format = flags.format ?? (/\.(md|markdown)$/iu.test(report) ? "md" : "html")
	if (format !== "html" && format !== "md") throw new CliError(`--format ${format}: verify html or md (a LaTeX edition is verified through its Markdown source)`)
	const text = readText(report)
	if (format === "html") return { format, text, entries: flags["fill-map"] === undefined ? null : readJsonFile(flags["fill-map"]).entries }
	const map = flags["fill-map"] ?? `${report}.fill-map.json`
	if (!existsSync(map)) throw new CliError(`a Markdown edition needs its fill map: ${map} is missing (pass --fill-map)`)
	return { format, text, entries: readJsonFile(map).entries }
}

/** @param {{ positionals: string[], flags: Record<string, any> }} args parsed by runFact */
export function runFactVerify(args) {
	const [report] = args.positionals
	const { flags } = args
	if (!report) throw new CliError("usage: fact verify <report> [--format html|md] [--sources D] [--claims claims.json] [--fill-map F] [--brief brief.md] [--out fidelity-defects.json]")
	const edition = readEdition(report, flags)
	const sessionDir = sessionDirOf(flags)
	const claimsPath = flags.claims ?? join(sessionDir, "claims.json")
	const briefPath = flags.brief ?? join(sessionDir, "brief.md")
	const ledger = readLedger(sessionDir)
	const projected = edition.format === "md" ? markdownAsHtml(edition.text, edition.entries, ledger) : null
	const result = checkFidelity(projected?.html ?? edition.text, {
		ledger,
		sourcesDir: resolve(flags.sources ?? join(sessionDir, "sources")),
		claims: flags.claims !== undefined || existsSync(claimsPath) ? readJsonFile(claimsPath) : null,
		fillMap: projected?.stale ?? edition.entries,
		brief: existsSync(briefPath) ? readText(briefPath) : "",
		baseDir: dirname(resolve(report)),
		recompute,
	})
	const counts = { blocker: 0, major: 0, minor: 0, total: result.defects.length }
	for (const defect of result.defects) counts[defect.severity] += 1
	const status = result.defects.some(blocksDelivery) ? "fail" : "pass"
	const exitCode = status === "fail" ? 1 : 0
	const record = { command: "fact verify", status, exitCode, format: edition.format, artifact: resolve(report), artifact_sha256: sha256Of(edition.text), defects: result.defects, counts, gatesRun: result.gatesRun }
	const out = resolve(flags.out ?? join(sessionDir, FIDELITY_RECORD))
	writeJsonAtomic(out, record)
	return { json: { ...record, out }, summary: `fact verify: ${status.toUpperCase()} - ${counts.blocker} blocker, ${counts.major} major, ${counts.minor} minor`, exitCode }
}

function unresolvedIn(record) {
	const defects = Array.isArray(record) ? record : record?.defects
	if (!Array.isArray(defects)) throw new CliError("a fidelity record must be a defect array or an object with a defects array")
	return [...new Set(defects.filter(blocksDelivery).map((defect) => defect?.code))].sort()
}

const unresolved = (format, codes, path) => ({ code: "fidelity_unresolved", format, codes, message: codes.map((code) => deliveryBlockReason({ code })).join("; "), path })

/** Barrier problems for `outcome verify` and `outcome finish`; empty when nothing blocks delivery. */
export function fidelityProblems(sessionDir, manifest) {
	const problems = []
	const sessionRecord = join(sessionDir, FIDELITY_RECORD)
	if (existsSync(sessionRecord)) {
		const codes = unresolvedIn(readJsonFile(sessionRecord))
		if (codes.length > 0) problems.push(unresolved(null, codes, sessionRecord))
	}
	const hasFidelity = existsSync(join(sessionDir, LEDGER_FILENAME)) || existsSync(sessionRecord)
	const lastFidelity = manifest.gateHistory?.findLast((entry) => entry.gate === "fidelity")
	const exempt = manifest.gates.fidelity === "not_run" && lastFidelity?.status === "not_run" && lastFidelity.reason?.trim()
	for (const row of manifest.deliverables) {
		if (row.status !== "delivered") continue
		if (!row.verifiedBy && exempt && !hasFidelity) continue
		if (!hasFidelity && !row.verifiedBy) {
			if (["html", "pdf", "docx"].includes(row.format)) problems.push({ code: "edition_unverified", format: row.format, message: `${row.format}: fidelity gate not run`, path: row.path })
			continue
		}
		if (!row.path) continue
		const subject = row.renderedFrom ?? row.path
		const unverified = (message) => problems.push({ code: "edition_unverified", format: row.format, message: `${row.format}: ${message}`, path: subject })
		if (!row.verifiedBy) {
			unverified(`fidelity gate not run; run fact verify on ${subject} and set it with --verified-by`)
			continue
		}
		if (!existsSync(row.verifiedBy)) {
			unverified(`verify record ${row.verifiedBy} is missing`)
			continue
		}
		const record = readJsonFile(row.verifiedBy)
		const actual = existsSync(subject) ? sha256Of(readFileSync(subject)) : null
		if (record.artifact_sha256 !== actual) unverified(`verify record ${row.verifiedBy} is for other bytes than ${subject}`)
		const codes = resolve(row.verifiedBy) === sessionRecord ? [] : unresolvedIn(record)
		if (codes.length > 0) problems.push(unresolved(row.format, codes, row.verifiedBy))
	}
	return problems
}
