// md-lite.mjs - a light Markdown block model for md/post deliverables.
//
// parseMarkdown(text) returns { blocks } in document order, each block one of heading,
// paragraph, list_item, table_row, code, blockquote, with start/end offsets into the raw text
// so text.slice(start, end) === block.text (table cells carry their own offsets). Headings carry
// level 1-6. Code blocks are fenced (``` or ~~~); an unterminated fence runs to the end of the
// text. Callers skip kind 'code' when they look for numbers. sectionKindsMd(blocks) classifies
// sections by heading text the way gates-static does for HTML h2/h3. It never renders HTML.
// Plain Node ESM, sibling imports only.

import { CLOSING_HEADING, SOURCES_HEADING } from "./gates-static.mjs"

/** Markdown closing headings ("Closing", "maMuRi") on top of the HTML closing heading set. */
const MD_CLOSING_HEADING = /\bclosing\b|\uB9C8\uBB34\uB9AC/i
/** Same order and patterns as OTHER_KINDS in gates-static.mjs. */
const OTHER_KINDS = [
	["toc", /\b(?:contents|toc)\b|\uBAA9\uCC28/i],
	["appendix", /appendix|\uBD80\uB85D/i],
	["glossary", /glossary|\uC6A9\uC5B4/i],
]
const FENCE = /^ {0,3}(`{3,}|~{3,})/
const HEADING = /^ {0,3}(#{1,6})(?=[ \t]|$)/
const BLOCKQUOTE = /^ {0,3}> ?/
const LIST_ITEM = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+/
const TABLE_SEPARATOR = /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/
const CLOSING_HASHES = /[ \t]+#+[ \t]*$|^#+[ \t]*$/
const THEMATIC_BREAK = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/

/** Split into lines with offsets; end excludes the newline and a trailing carriage return. */
function linesOf(text) {
	const lines = []
	let start = 0
	while (start <= text.length) {
		const newline = text.indexOf("\n", start)
		const next = newline === -1 ? text.length + 1 : newline + 1
		let end = newline === -1 ? text.length : newline
		if (end > start && text[end - 1] === "\r") end--
		lines.push({ start, end, next, raw: text.slice(start, end) })
		start = next
	}
	return lines
}

/** Narrow [start, end) to its non-whitespace core. */
function trimRange(text, start, end) {
	let from = start
	let to = end
	while (from < to && /\s/.test(text[from])) from++
	while (to > from && /\s/.test(text[to - 1])) to--
	return { start: from, end: to }
}

function block(text, kind, range, extra = {}) {
	return { kind, ...extra, text: text.slice(range.start, range.end), start: range.start, end: range.end }
}

function isSeparator(line) {
	return line !== undefined && line.raw.includes("-") && TABLE_SEPARATOR.test(line.raw)
}

/** Cells split on unescaped pipes, outer pipes dropped, each cell trimmed with offsets. */
function tableCells(text, range) {
	const bounds = []
	for (let k = range.start; k < range.end; k++) if (text[k] === "|" && text[k - 1] !== "\\") bounds.push(k)
	const edges = [range.start - 1, ...bounds, range.end]
	if (bounds[0] === range.start) edges.shift()
	if (bounds.at(-1) === range.end - 1 && bounds.length > 0) edges.pop()
	const cells = []
	for (let k = 0; k + 1 < edges.length; k++) {
		const cell = trimRange(text, edges[k] + 1, edges[k + 1])
		cells.push({ text: text.slice(cell.start, cell.end), start: cell.start, end: cell.end })
	}
	return cells
}

function headingBlock(text, line, marker) {
	const after = line.start + line.raw.indexOf(marker) + marker.length
	const range = trimRange(text, after, line.end)
	const closing = text.slice(range.start, range.end).match(CLOSING_HASHES)
	if (closing) range.end = trimRange(text, range.start, range.start + (closing.index ?? 0)).end
	return block(text, "heading", range, { level: marker.length })
}

/**
 * Parse Markdown into a flat block list.
 * @param {string} text
 * @returns {{ blocks: { kind: string, level?: number, text: string, start: number, end: number,
 *   cells?: { text: string, start: number, end: number }[] }[] }}
 */
export function parseMarkdown(text) {
	const source = String(text ?? "")
	const lines = linesOf(source)
	const blocks = []
	let paragraph = null
	let inTable = false
	const flush = () => {
		if (paragraph) blocks.push(block(source, "paragraph", paragraph))
		paragraph = null
	}
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]
		const fence = line.raw.match(FENCE)
		if (fence) {
			flush()
			inTable = false
			const open = fence[1]
			const codeStart = Math.min(line.next, source.length)
			let close = lines.length
			for (let k = i + 1; k < lines.length; k++) {
				const candidate = lines[k].raw.trim()
				if (candidate.startsWith(open[0].repeat(open.length)) && /^(`+|~+)$/.test(candidate)) {
					close = k
					break
				}
			}
			let codeEnd = source.length
			if (close < lines.length) {
				codeEnd = Math.max(codeStart, lines[close].start - 1)
				if (codeEnd > codeStart && source[codeEnd - 1] === "\r") codeEnd--
			}
			blocks.push(block(source, "code", { start: codeStart, end: codeEnd }))
			i = close
			continue
		}
		if (line.raw.trim() === "") {
			flush()
			inTable = false
			continue
		}
		const range = trimRange(source, line.start, line.end)
		if (!inTable && line.raw.includes("|") && isSeparator(lines[i + 1])) inTable = true
		if (inTable && line.raw.includes("|")) {
			flush()
			if (!isSeparator(line)) blocks.push(block(source, "table_row", range, { cells: tableCells(source, range) }))
			continue
		}
		inTable = false
		const heading = line.raw.match(HEADING)
		if (heading) {
			flush()
			blocks.push(headingBlock(source, line, heading[1]))
			continue
		}
		if (THEMATIC_BREAK.test(line.raw)) {
			flush()
			continue
		}
		const marker = line.raw.match(BLOCKQUOTE) ?? line.raw.match(LIST_ITEM)
		if (marker) {
			flush()
			const kind = BLOCKQUOTE.test(line.raw) ? "blockquote" : "list_item"
			const content = trimRange(source, line.start + marker[0].length, line.end)
			if (content.end > content.start) blocks.push(block(source, kind, content))
			continue
		}
		if (paragraph) paragraph.end = range.end
		else paragraph = { start: range.start, end: range.end }
	}
	flush()
	return { blocks }
}

function sectionKind(heading, isClosing) {
	if (SOURCES_HEADING.test(heading)) return "sources"
	if (isClosing(heading)) return "closing"
	return OTHER_KINDS.find(([, re]) => re.test(heading))?.[0] ?? null
}

/**
 * Section kind of every block, parallel to blocks: an h2 opens a section whose kind comes from
 * its heading text (sources, closing, toc, appendix, glossary, or null for findings); an h3 that
 * reads as a closing heading marks its blocks closing until the next h2 or h3, as in gates-static.
 * @param {{ kind: string, level?: number, text: string }[]} blocks
 * @param {{ closingPattern?: RegExp }} [options] extra closing heading pattern (the spec's)
 * @returns {(string|null)[]}
 */
export function sectionKindsMd(blocks, options = {}) {
	const extra = options.closingPattern ?? null
	const isClosing = (heading) => CLOSING_HEADING.test(heading) || MD_CLOSING_HEADING.test(heading) || Boolean(extra?.test(heading))
	let section = null
	let closingH3 = false
	return blocks.map((entry) => {
		if (entry.kind === "heading" && entry.level === 2) {
			section = sectionKind(entry.text, isClosing)
			closingH3 = false
		} else if (entry.kind === "heading" && entry.level === 3) {
			closingH3 = isClosing(entry.text)
		}
		return closingH3 ? "closing" : section
	})
}
