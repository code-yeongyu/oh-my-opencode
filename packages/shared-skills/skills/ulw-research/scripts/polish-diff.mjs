// polish-diff.mjs - whole-document backstop between a pre-polish artifact and its polished result.
//
// diffPolish(beforeHtml, afterHtml, ledger) returns one defect per failed code, for the case
// where someone edits by hand instead of through polish-apply:
//   polish_diff_fail (blocker): the multiset of fact spans (id + rendered markup), of numerals
//     outside fact spans (with units), or of tickers (TICKER: 1-5 capitals with an optional
//     ".XX" class suffix, or a 6-digit KRX code) changed, or a table's row count changed;
//   polish_hedging_decreased (major): a hedge or qualifier the before text requires (the
//     source quote's hedges for sentences with fact spans, the sentence's own otherwise) is gone;
//   polish_text_churn (major): more than half of the normalized visible prose changed, measured
//     as character edit distance over the sentences a sentence-level diff does not match;
//   polish_link_changed (minor): the href multiset changed or an internal #target stopped resolving;
//   polish_name_changed (minor): a proper noun from a ledger quote, present before, is absent after.
// Severity is fixed per code. No IO, no model. Plain Node ESM.

import { missingTerms, numeralKeys, project, requiredTerms } from "./polish-apply.mjs"
import { splitSentences } from "./sentence-split.mjs"
import { normalizeText } from "./text-normalize.mjs"

export const POLISH_DIFF_SEVERITY = Object.freeze({
	polish_diff_fail: "blocker",
	polish_hedging_decreased: "major",
	polish_text_churn: "major",
	polish_link_changed: "minor",
	polish_name_changed: "minor",
})
export const TICKER = /(?<![\p{L}\p{N}])(?:[A-Z]{1,5}(?:\.[A-Z]{1,2})?|\d{6})(?![\p{L}\p{N}])/gu
const CHURN_LIMIT = 0.5
/** Above this many cells a gap counts as fully rewritten instead of running the quadratic distance. */
const DISTANCE_CELLS = 25_000_000
const NAME = /\p{Lu}[\p{L}\p{N}&'-]+/gu

/** The body markup with head, script, style and comments removed. */
function bodyOf(html) {
	return String(html).replace(/<!--[\s\S]*?-->/g, " ").replace(/<(head|script|style)\b[\s\S]*?<\/\1\s*>/gi, " ")
}

const sorted = (list) => [...list].sort()
const sameBag = (a, b) => sorted(a).join("\u0000") === sorted(b).join("\u0000")

function bagChange(label, before, after) {
	if (sameBag(before, after)) return null
	const gone = sorted(before)
	const remaining = [...gone]
	const added = []
	for (const item of after) {
		const at = remaining.indexOf(item)
		if (at === -1) added.push(item)
		else remaining.splice(at, 1)
	}
	return `${label} changed: removed [${remaining.join(", ")}], added [${added.join(", ")}]`
}

function tableRows(html) {
	return html.split(/<table\b/i).slice(1).map((part) => (part.split(/<\/table\s*>/i)[0].match(/<tr\b/gi) ?? []).length)
}

function levenshtein(a, b) {
	if (a === b) return 0
	if (a.length * b.length > DISTANCE_CELLS) return Math.max(a.length, b.length)
	let previous = Array.from({ length: b.length + 1 }, (_, k) => k)
	for (let i = 1; i <= a.length; i++) {
		const current = [i]
		for (let j = 1; j <= b.length; j++) {
			current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
		}
		previous = current
	}
	return previous[b.length]
}

/** Changed share of normalized prose: edit distance over unmatched sentence runs / longer length. */
export function churnRatio(beforeText, afterText) {
	const [a, b] = [normalizeText(beforeText), normalizeText(afterText)]
	const longest = Math.max(a.length, b.length)
	if (longest === 0) return 0
	const [sa, sb] = [splitSentences(a).map((s) => s.text), splitSentences(b).map((s) => s.text)]
	const lcs = Array.from({ length: sa.length + 1 }, () => new Array(sb.length + 1).fill(0))
	for (let i = sa.length - 1; i >= 0; i--) {
		for (let j = sb.length - 1; j >= 0; j--) lcs[i][j] = sa[i] === sb[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
	}
	let distance = 0
	let gap = [[], []]
	const flush = () => {
		distance += levenshtein(gap[0].join(" "), gap[1].join(" "))
		gap = [[], []]
	}
	let [i, j] = [0, 0]
	while (i < sa.length || j < sb.length) {
		if (i < sa.length && j < sb.length && sa[i] === sb[j]) {
			flush()
			i++
			j++
		} else if (j >= sb.length || (i < sa.length && lcs[i + 1][j] >= lcs[i][j + 1])) gap[0].push(sa[i++])
		else gap[1].push(sb[j++])
	}
	flush()
	return distance / longest
}

function linkChange(before, after) {
	const hrefs = (html) => [...html.matchAll(/\shref="([^"]*)"/gi)].map((match) => match[1])
	const ids = (html) => new Set([...html.matchAll(/\sid="([^"]*)"/gi)].map((match) => match[1]))
	const change = bagChange("link targets", hrefs(before), hrefs(after))
	if (change) return change
	const [idsBefore, idsAfter] = [ids(before), ids(after)]
	const broken = hrefs(after).filter((href) => href.startsWith("#") && idsBefore.has(href.slice(1)) && !idsAfter.has(href.slice(1)))
	return broken.length > 0 ? `internal link targets stopped resolving: [${[...new Set(broken)].join(", ")}]` : null
}

/** Capitalized tokens of the ledger quotes, minus each sentence's first word. */
function ledgerNames(rows) {
	const names = new Set()
	for (const row of rows) {
		for (const { text } of splitSentences(row.quote ?? "")) {
			const first = text.match(/^\P{L}*\p{L}+/u)?.[0].length ?? 0
			for (const match of text.matchAll(NAME)) if (match.index >= first) names.add(match[0])
		}
	}
	return names
}

const hasWord = (text, word) => new RegExp(`(?<![\\p{L}\\p{N}])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "u").test(text)

/**
 * @param {string} beforeHtml the pre-polish artifact
 * @param {string} afterHtml the polished artifact
 * @param {{ rows: object[] }} ledger
 * @returns {{ code: string, severity: string, message: string }[]} at most one defect per code
 */
export function diffPolish(beforeHtml, afterHtml, ledger) {
	const [before, after] = [bodyOf(beforeHtml), bodyOf(afterHtml)]
	const [from, to] = [project(before), project(after)]
	const rows = ledger?.rows ?? []
	const found = Object.fromEntries(Object.keys(POLISH_DIFF_SEVERITY).map((code) => [code, []]))
	const note = (code, message) => message && found[code].push(message)
	const factKey = (fact) => `${fact.id} ${fact.html}`
	note("polish_diff_fail", bagChange("fact spans", from.facts.map(factKey), to.facts.map(factKey)))
	note("polish_diff_fail", bagChange("numerals outside fact spans", numeralKeys(from.masked), numeralKeys(to.masked)))
	const tickers = (text) => text.match(TICKER) ?? []
	note("polish_diff_fail", bagChange("tickers", tickers(from.masked), tickers(to.masked)))
	const [rowsBefore, rowsAfter] = [tableRows(before), tableRows(after)]
	if (rowsBefore.join(",") !== rowsAfter.join(",")) note("polish_diff_fail", `table row counts changed: [${rowsBefore}] became [${rowsAfter}]`)
	const missing = missingTerms(requiredTerms(from, new Map(rows.map((row) => [row.fact_id, row]))), to.visible)
	if (missing.length > 0) note("polish_hedging_decreased", `required hedges or qualifiers removed: ${missing.map((term) => `"${term}"`).join(", ")}`)
	const ratio = churnRatio(from.visible, to.visible)
	if (ratio > CHURN_LIMIT) note("polish_text_churn", `${(ratio * 100).toFixed(1)} percent of the normalized prose changed`)
	note("polish_link_changed", linkChange(before, after))
	const lost = [...ledgerNames(rows)].filter((name) => hasWord(from.visible, name) && !hasWord(to.visible, name))
	if (lost.length > 0) note("polish_name_changed", `ledger-quote names missing after polish: ${lost.join(", ")}`)
	return Object.entries(found)
		.filter(([, messages]) => messages.length > 0)
		.map(([code, messages]) => ({ code, severity: POLISH_DIFF_SEVERITY[code], message: messages.join("; ") }))
}
