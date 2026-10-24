// polish-apply.mjs - checked, per-edit application of a proofread lane's polish edits.
//
// applyEdits(html, edits, ledger) applies each {before, after, reason} edit in edits-file order,
// against the output of the edits accepted before it. `before` must occur exactly once (runs of
// whitespace match any whitespace run) and must not cut through a rendered fact span; otherwise
// the edit is polish_edit_unlocated. A located edit is applied whole or not at all: any failed
// check below makes it polish_edit_rejected and leaves the document unchanged at that spot.
//   - fact spans (<data|q|blockquote data-fact>): same ids, same rendered markup, same order;
//   - numerals outside fact spans: same sequence, order-sensitive, with their units;
//   - hrefs and data-claim ids: same sequence;
//   - hedges and qualifiers, sentence by sentence over `before`: a sentence holding fact spans
//     requires the hedges of each referenced row's quote and the row qualifier's forms it shows;
//     a claim-only sentence requires its own hedge and qualifier tokens. `after` must still hold
//     every required token as many times. The union of sentences is compared, so a merge or a
//     split passes when the invariants hold across the edited region.
// The projection helpers are shared with polish-diff.mjs. No IO, no model. Plain Node ESM.

import { decodeEntities } from "./entities.mjs"
import { QUALIFIER_FORMS } from "./fidelity-lexicon.mjs"
import { HEDGES, QUALIFIERS } from "./lexicon.mjs"
import { parseNumeral } from "./numerals.mjs"
import { splitSentences } from "./sentence-split.mjs"
import { normalizeUnit } from "./units.mjs"

const FACT_SPAN = /<(data|q|blockquote)\b[^>]*?\sdata-fact="([^"]+)"[^>]*>[\s\S]*?<\/\1\s*>/gi
const LINK_ATTR = /(?<![\w-])(href|data-claim)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi
const DIGITS = /\d+(?:[.,]\d+)*/g
/** Stands in for one fact span in masked text; a private-use char, so no numeral or word matches it. */
export const SLOT = "\uE000"
const KOREAN = /[\uAC00-\uD7A3]/
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
export const GUARDED_TERMS = Object.freeze([...new Set([...HEDGES, ...QUALIFIERS, ...Object.values(QUALIFIER_FORMS).flat()])])

/** Visible text of an HTML fragment: tags become spaces, entities decoded, whitespace collapsed. */
export function textOf(html) {
	return decodeEntities(html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ")
}

/**
 * The protected projection of a fragment: ordered fact spans {id, html}, the visible text, the
 * masked text (each fact span replaced by SLOT) and the ordered href / data-claim attributes.
 */
export function project(fragment) {
	const facts = []
	let visible = ""
	let masked = ""
	let at = 0
	for (const match of fragment.matchAll(FACT_SPAN)) {
		const outside = textOf(fragment.slice(at, match.index))
		facts.push({ id: match[2], html: match[0].replace(/\s+/g, " ") })
		visible += `${outside}${textOf(match[0])}`
		masked += `${outside} ${SLOT} `
		at = match.index + match[0].length
	}
	const rest = textOf(fragment.slice(at))
	const links = [...fragment.matchAll(LINK_ATTR)].map((match) => `${match[1].toLowerCase()}=${match[2] ?? match[3]}`)
	return { facts, visible: (visible + rest).replace(/\s+/g, " ").trim(), masked: (masked + rest).replace(/\s+/g, " ").trim(), links }
}

const unitKey = (raw) => (raw === null ? "" : (normalizeUnit(raw) ?? raw.toLowerCase()))

/** Ordered numeral keys: a parsed quantity as "value unit" (once), any other digit run as written. */
export function numeralKeys(text) {
	const quantities = []
	for (let found = parseNumeral(text); found !== null; found = parseNumeral(text, found.span[1])) quantities.push(found)
	const keys = []
	let k = 0
	for (const match of text.matchAll(DIGITS)) {
		while (k < quantities.length && quantities[k].span[1] <= match.index) k++
		const quantity = quantities[k]
		if (!quantity || quantity.span[0] > match.index) keys.push(match[0])
		else if (!quantity.counted) {
			quantity.counted = true
			keys.push(`${quantity.value}${quantity.range ? `~${quantity.valueEnd}` : ""} ${unitKey(quantity.unitRaw)}`.trim())
		}
	}
	return keys
}

function termPattern(term) {
	if (KOREAN.test(term)) return new RegExp(escape(term), "gu")
	const tail = term.length >= 4 && !term.includes(" ") ? "\\p{L}*" : ""
	return new RegExp(`(?<![\\p{L}\\p{N}])${escape(term).replace(/ /g, "\\s+")}${tail}(?![\\p{L}\\p{N}])`, "giu")
}

/** term -> occurrence count of each listed term in the text (Latin whole words, Korean substrings). */
export function termCounts(text, terms = GUARDED_TERMS) {
	const counts = new Map()
	for (const term of terms) {
		const n = [...text.matchAll(termPattern(term))].length
		if (n > 0) counts.set(term, n)
	}
	return counts
}

const add = (into, term, n = 1) => into.set(term, (into.get(term) ?? 0) + n)

/**
 * The hedge and qualifier tokens a projection obliges its replacement to keep (term -> count):
 * per sentence of the masked text, the referenced rows' quote hedges and shown qualifier forms
 * when the sentence holds fact spans, else the sentence's own guarded tokens.
 */
export function requiredTerms(projection, rows) {
	const required = new Map()
	let cursor = 0
	for (const { text } of splitSentences(projection.masked)) {
		const slots = text.split(SLOT).length - 1
		const facts = projection.facts.slice(cursor, cursor + slots)
		cursor += slots
		if (slots === 0) {
			for (const [term, n] of termCounts(text)) add(required, term, n)
			continue
		}
		const terms = new Set()
		for (const { id } of facts) {
			const row = rows.get(id)
			for (const term of termCounts(row?.quote ?? "", HEDGES).keys()) terms.add(term)
			for (const form of QUALIFIER_FORMS[row?.qualifier] ?? []) if (termCounts(text, [form]).size > 0) terms.add(form)
		}
		for (const term of terms) add(required, term)
	}
	return required
}

/** Required terms the text no longer holds as many times, as "term" names. */
export function missingTerms(required, text) {
	const have = termCounts(text, [...required.keys()])
	return [...required].filter(([term, n]) => (have.get(term) ?? 0) < n).map(([term]) => term)
}

const same = (a, b) => a.length === b.length && a.every((item, k) => item === b[k])
const rowMap = (ledger) => new Map((ledger?.rows ?? []).map((row) => [row.fact_id, row]))

/** The reasons a located edit must be rejected; empty when every per-edit check passes. */
function rejectReasons(before, after, rows) {
	const from = project(before)
	const to = project(after)
	const reasons = []
	const ids = (p) => p.facts.map((fact) => fact.id)
	if (!same(ids(from), ids(to))) reasons.push(`fact spans changed: [${ids(from).join(", ")}] became [${ids(to).join(", ")}]`)
	else {
		const changed = from.facts.filter((fact, k) => fact.html !== to.facts[k].html).map((fact) => fact.id)
		if (changed.length > 0) reasons.push(`rendered value of ${changed.join(", ")} changed`)
	}
	const [numbersBefore, numbersAfter] = [numeralKeys(from.masked), numeralKeys(to.masked)]
	if (!same(numbersBefore, numbersAfter)) {
		reasons.push(`numeral sequence outside fact spans changed: [${numbersBefore.join(", ")}] became [${numbersAfter.join(", ")}]`)
	}
	if (!same(from.links, to.links)) reasons.push(`href or data-claim changed: [${from.links.join(", ")}] became [${to.links.join(", ")}]`)
	const missing = missingTerms(requiredTerms(from, rows), to.visible)
	if (missing.length > 0) reasons.push(`hedge or qualifier removed: ${missing.map((term) => `"${term}"`).join(", ")}`)
	return reasons
}

/** The single whitespace-normalized match of `before` in html as {start, end}, or {count} otherwise. */
function locate(html, before) {
	if (before.trim() === "") return { count: 0 }
	const pattern = new RegExp(before.split(/\s+/).map(escape).join("\\s+"), "g")
	const hits = [...html.matchAll(pattern)]
	return hits.length === 1 ? { count: 1, start: hits[0].index, end: hits[0].index + hits[0][0].length } : { count: hits.length }
}

/** The id of a fact span the region [start, end) cuts through (overlaps without containing), or null. */
function cutSpan(html, start, end) {
	for (const match of html.matchAll(FACT_SPAN)) {
		const [s, e] = [match.index, match.index + match[0].length]
		if (s < end && e > start && !(start <= s && e <= end)) return match[2]
	}
	return null
}

/**
 * @param {string} html the filled report
 * @param {{ before: string, after: string, reason?: string }[]} edits in edits-file order
 * @param {{ rows: object[] }} ledger
 * @returns {{ out: string, applied: number[], rejected: { index: number, code: string, reason: string }[],
 *   unlocated: { index: number, code: string, reason: string }[] }}
 */
export function applyEdits(html, edits, ledger) {
	if (!Array.isArray(edits)) throw new TypeError("edits must be an array")
	const rows = rowMap(ledger)
	const result = { out: String(html), applied: [], rejected: [], unlocated: [] }
	edits.forEach((edit, index) => {
		if (typeof edit?.before !== "string" || typeof edit?.after !== "string") throw new TypeError(`edit ${index} needs string before and after`)
		const where = locate(result.out, edit.before)
		if (where.count !== 1) {
			result.unlocated.push({ index, code: "polish_edit_unlocated", reason: `before matches ${where.count} times; it must match exactly once` })
			return
		}
		const cut = cutSpan(result.out, where.start, where.end)
		const reasons = cut === null ? rejectReasons(result.out.slice(where.start, where.end), edit.after, rows) : [`the edit cuts through fact span ${cut}`]
		if (reasons.length > 0) {
			result.rejected.push({ index, code: "polish_edit_rejected", reason: reasons.join("; ") })
			return
		}
		result.out = result.out.slice(0, where.start) + edit.after + result.out.slice(where.end)
		result.applied.push(index)
	})
	return result
}
