import { describe, expect, test } from "bun:test"

import { renderValueHtml } from "./placeholder.mjs"
import { diffPolish } from "./polish-diff.mjs"

const SPAN = { fact_id: "F2", kind: "measured", quote: "The bridge has a main span of 320 m.", raw: "320 m", value: "320", unit: "m", qualifier: null }
const MAKER = { fact_id: "F5", kind: "measured", quote: "In May, Samsung Electronics shipped 12 units.", raw: "12 units", value: "12", unit: "units", qualifier: null }
const LEDGER = { schemaVersion: 1, rows: [SPAN, MAKER], events: [] }
const span = renderValueHtml(SPAN, SPAN.raw)
const doc = (body: string) => `<html><body>\n${body}\n</body></html>`
const codes = (list: { code: string }[]) => list.map((item) => item.code)

describe("diffPolish: protected content", () => {
	test("identical documents have no defects", () => {
		const html = doc(`<p>The span was about ${span} [S1].</p><table><tr><td>A</td></tr></table>`)
		expect(diffPolish(html, html, LEDGER)).toEqual([])
	})

	test("one numeral that differs inside a fact span is polish_diff_fail", () => {
		const before = doc(`<p>The span is ${span} [S1].</p>`)
		const after = doc(`<p>The span is ${span.replace(">320 m<", ">321 m<")} [S1].</p>`)
		expect(codes(diffPolish(before, after, LEDGER))).toEqual(["polish_diff_fail"])
	})

	test("one numeral that differs outside fact spans is polish_diff_fail", () => {
		const before = doc("<p>Throughput grew 3.5 times in the pilot [S1].</p>")
		const after = doc("<p>Throughput grew 35 times in the pilot [S1].</p>")
		expect(codes(diffPolish(before, after, LEDGER))).toEqual(["polish_diff_fail"])
	})

	test("a dropped table row is polish_diff_fail", () => {
		const before = doc("<table><tr><td>A</td></tr><tr><td>B</td></tr></table>")
		const after = doc("<table><tr><td>A</td></tr></table>")
		expect(codes(diffPolish(before, after, LEDGER))).toContain("polish_diff_fail")
	})

	test("a changed ticker or six-digit exchange code is polish_diff_fail", () => {
		expect(codes(diffPolish(doc("<p>AAPL [S1].</p>"), doc("<p>MSFT [S1].</p>"), LEDGER))).toEqual(["polish_diff_fail"])
		expect(codes(diffPolish(doc("<p>Code 005930 [S1].</p>"), doc("<p>Code 000660 [S1].</p>"), LEDGER))).toEqual(["polish_diff_fail"])
	})
})

describe("diffPolish: hedges, churn, links and names", () => {
	test("two hedges removed from claim-only text is polish_hedging_decreased", () => {
		const before = doc("<p>Results may improve and are provisional. The study covered the pilot only.</p>")
		const after = doc("<p>Results improve and are final. The study covered the pilot only.</p>")
		expect(codes(diffPolish(before, after, LEDGER))).toEqual(["polish_hedging_decreased"])
	})

	test("deleting a writer-added hedge the source lacks is not a hedge loss", () => {
		const before = doc(`<p>The span was about ${span} [S1].</p>`)
		const after = doc(`<p>The span was ${span} [S1].</p>`)
		expect(diffPolish(before, after, LEDGER)).toEqual([])
	})

	test("a 60 percent rewrite is polish_text_churn and 50 percent is not", () => {
		expect(codes(diffPolish(doc("<p>abcdefghij</p>"), doc("<p>klmnopghij</p>"), LEDGER))).toEqual(["polish_text_churn"])
		expect(diffPolish(doc("<p>abcdefghij</p>"), doc("<p>klmnofghij</p>"), LEDGER)).toEqual([])
	})

	test("a changed link target or an internal link that stops resolving is polish_link_changed", () => {
		const link = (href: string) => doc(`<p id="top"><a href="${href}">Reference</a> [S1].</p>`)
		expect(codes(diffPolish(link("https://example.invalid/a"), link("https://example.invalid/b"), LEDGER))).toEqual(["polish_link_changed"])
		const before = doc('<h2 id="m">Method</h2><p><a href="#m">Method</a> [S1].</p>')
		const after = doc('<h2 id="method">Method</h2><p><a href="#m">Method</a> [S1].</p>')
		expect(codes(diffPolish(before, after, LEDGER))).toEqual(["polish_link_changed"])
	})

	test("a ledger-quote name present before and absent after is polish_name_changed", () => {
		const before = doc("<p>Samsung Electronics shipped more units in the quarter [S1].</p>")
		const after = doc("<p>The company shipped more units in the quarter [S1].</p>")
		expect(codes(diffPolish(before, after, LEDGER))).toEqual(["polish_name_changed"])
	})

	test("every defect carries its fixed severity", () => {
		const before = doc("<p>Results may improve and are provisional [S1].</p><table><tr><td>A</td></tr><tr><td>B</td></tr></table>")
		const after = doc("<p>Results improve and are final [S1].</p><table><tr><td>A</td></tr></table>")
		const bySeverity = Object.fromEntries(diffPolish(before, after, LEDGER).map((d: { code: string; severity: string }) => [d.code, d.severity]))
		expect(bySeverity).toEqual({ polish_diff_fail: "blocker", polish_hedging_decreased: "major" })
	})
})
