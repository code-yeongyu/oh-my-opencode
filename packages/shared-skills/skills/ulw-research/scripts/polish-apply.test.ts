import { describe, expect, test } from "bun:test"

import { renderValueHtml } from "./placeholder.mjs"
import { applyEdits } from "./polish-apply.mjs"

type Row = { fact_id: string; kind: string; quote: string; raw: string; value: string; unit: string | null; qualifier: string | null }
const row = (fact_id: string, quote: string, raw: string, value: string, unit: string | null, qualifier: string | null = null): Row => ({
	fact_id,
	kind: "measured",
	quote,
	raw,
	value,
	unit,
	qualifier,
})
const REVENUE = row("F1", "Revenue was about 10 million USD in 2025.", "10 million USD", "10000000", "USD", "approximate")
const SPAN = row("F2", "The bridge has a main span of 320 m.", "320 m", "320", "m")
const USERS = row("F3", "Usage reached 5,000 users.", "5,000 users", "5000", "users")
const BOUND = row("F4", "The bridge has a main span of up to 320 m.", "320 m", "320", "m", "upper_inclusive")
const LEDGER = { schemaVersion: 1, rows: [REVENUE, SPAN, USERS, BOUND], events: [] }
const f = (r: Row) => renderValueHtml(r, r.raw)
const doc = (body: string) => `<html><body>\n${body}\n</body></html>`
const edit = (before: string, after: string, reason = "polish") => ({ before, after, reason })
const codes = (list: { code: string }[]) => list.map((item) => item.code)

describe("applyEdits: hedges and qualifiers", () => {
	test("removing 'about' that the row quote carries is rejected and leaves the paragraph unchanged", () => {
		const html = doc(`<p>Revenue was about ${f(REVENUE)}.</p>`)
		const result = applyEdits(html, [edit(`Revenue was about ${f(REVENUE)}.`, `Revenue was ${f(REVENUE)}.`)], LEDGER)
		expect(result.applied).toEqual([])
		expect(codes(result.rejected)).toEqual(["polish_edit_rejected"])
		expect(result.rejected[0].reason).toContain("about")
		expect(result.out).toBe(html)
	})

	test("removing a hedge the row quote lacks is applied", () => {
		const html = doc(`<p>The span was about ${f(SPAN)}.</p>`)
		const result = applyEdits(html, [edit(`The span was about ${f(SPAN)}.`, `The span was ${f(SPAN)}.`)], LEDGER)
		expect(result.applied).toEqual([0])
		expect(result.rejected).toEqual([])
		expect(result.out).toBe(doc(`<p>The span was ${f(SPAN)}.</p>`))
	})

	test("dropping the row's qualifier ('up to') is rejected", () => {
		const html = doc(`<p>The main span is up to ${f(BOUND)}.</p>`)
		const result = applyEdits(html, [edit(`The main span is up to ${f(BOUND)}.`, `The main span is ${f(BOUND)}.`)], LEDGER)
		expect(codes(result.rejected)).toEqual(["polish_edit_rejected"])
		expect(result.rejected[0].reason).toContain("up to")
	})

	test("a claim-only sentence keeps the hedges of before", () => {
		const html = doc("<p>Results may improve [S1].</p>")
		expect(codes(applyEdits(html, [edit("Results may improve [S1].", "Results improve [S1].")], LEDGER).rejected)).toEqual(["polish_edit_rejected"])
	})
})

describe("applyEdits: fact spans and numerals", () => {
	test("splitting a sentence with its fact spans intact is applied", () => {
		const html = doc(`<p>The span is ${f(SPAN)} and usage is ${f(USERS)}.</p>`)
		const result = applyEdits(html, [edit(` and usage is ${f(USERS)}.`, `. Usage is ${f(USERS)}.`)], LEDGER)
		expect(result.applied).toEqual([0])
		expect(result.out).toBe(doc(`<p>The span is ${f(SPAN)}. Usage is ${f(USERS)}.</p>`))
	})

	test("swapping two numerals is rejected", () => {
		const html = doc("<p>See Figure 1 and Figure 2 [S1].</p>")
		const result = applyEdits(html, [edit("See Figure 1 and Figure 2 [S1].", "See Figure 2 and Figure 1 [S1].")], LEDGER)
		expect(codes(result.rejected)).toEqual(["polish_edit_rejected"])
		expect(result.rejected[0].reason).toContain("numeral")
	})

	test("moving a decimal point is rejected", () => {
		const html = doc("<p>Throughput grew 3.5 times [S1].</p>")
		expect(codes(applyEdits(html, [edit("grew 3.5 times", "grew 35 times")], LEDGER).rejected)).toEqual(["polish_edit_rejected"])
	})

	test("changing a plain unit ('320 m' to '320 mm') is rejected with a reason", () => {
		const html = doc("<p>The span is 320 m [S1].</p>")
		const result = applyEdits(html, [edit("The span is 320 m [S1].", "The span is 320 mm [S1].")], LEDGER)
		expect(codes(result.rejected)).toEqual(["polish_edit_rejected"])
		expect(result.rejected[0].reason).toContain("numeral")
	})

	test("swapping the order of two fact spans is rejected", () => {
		const html = doc(`<p>The span is ${f(SPAN)} and usage is ${f(USERS)}.</p>`)
		const before = `The span is ${f(SPAN)} and usage is ${f(USERS)}.`
		const after = `Usage is ${f(USERS)} and the span is ${f(SPAN)}.`
		expect(codes(applyEdits(html, [edit(before, after)], LEDGER).rejected)).toEqual(["polish_edit_rejected"])
	})

	test("editing the rendered value inside a fact span is rejected", () => {
		const html = doc(`<p>The span is ${f(SPAN)}.</p>`)
		const changed = f(SPAN).replace(">320 m<", ">321 m<")
		expect(codes(applyEdits(html, [edit(f(SPAN), changed)], LEDGER).rejected)).toEqual(["polish_edit_rejected"])
	})
})

describe("applyEdits: links and location", () => {
	test("changing a link is rejected", () => {
		const html = doc('<p><a href="https://example.invalid/a">Reference</a> [S1].</p>')
		const before = '<a href="https://example.invalid/a">Reference</a>'
		const result = applyEdits(html, [edit(before, before.replace("/a", "/b"))], LEDGER)
		expect(codes(result.rejected)).toEqual(["polish_edit_rejected"])
		expect(result.rejected[0].reason).toContain("href")
	})

	test("changing a data-claim id is rejected", () => {
		const html = doc('<p data-claim="C1">Results improve [S1].</p>')
		const result = applyEdits(html, [edit('data-claim="C1"', 'data-claim="C2"')], LEDGER)
		expect(codes(result.rejected)).toEqual(["polish_edit_rejected"])
		expect(result.rejected[0].reason).toContain("data-claim")
	})

	test("a before that is not found is unlocated", () => {
		const result = applyEdits(doc("<p>Text [S1].</p>"), [edit("ABSENT", "replacement")], LEDGER)
		expect(codes(result.unlocated)).toEqual(["polish_edit_unlocated"])
		expect(result.applied).toEqual([])
	})

	test("a before that occurs twice is unlocated", () => {
		const result = applyEdits(doc("<p>The term and term appear [S1].</p>"), [edit("term", "word")], LEDGER)
		expect(codes(result.unlocated)).toEqual(["polish_edit_unlocated"])
	})

	test("before matches across normalized whitespace", () => {
		const html = doc("<p>Results\n   improve [S1].</p>")
		const result = applyEdits(html, [edit("Results improve [S1].", "Results clearly improve [S1].")], LEDGER)
		expect(result.applied).toEqual([0])
		expect(result.out).toBe(doc("<p>Results clearly improve [S1].</p>"))
	})

	test("edits apply in order; a later edit whose before is gone is unlocated", () => {
		const html = doc("<p>Results improve [S1].</p>")
		const result = applyEdits(
			html,
			[edit("Results improve [S1].", "Results improve steadily [S1]."), edit("Results improve [S1].", "Results improve rapidly [S1].")],
			LEDGER,
		)
		expect(result.applied).toEqual([0])
		expect(result.unlocated.map((item: { index: number }) => item.index)).toEqual([1])
		expect(result.out).toBe(doc("<p>Results improve steadily [S1].</p>"))
	})

	test("a rejected edit does not block a later good edit", () => {
		const html = doc(`<p>Revenue was about ${f(REVENUE)}.</p><p>Results improve [S1].</p>`)
		const result = applyEdits(
			html,
			[edit(`Revenue was about ${f(REVENUE)}.`, `Revenue was ${f(REVENUE)}.`), edit("Results improve [S1].", "Results clearly improve [S1].")],
			LEDGER,
		)
		expect(result.applied).toEqual([1])
		expect(result.rejected.map((item: { index: number }) => item.index)).toEqual([0])
		expect(result.out).toBe(doc(`<p>Revenue was about ${f(REVENUE)}.</p><p>Results clearly improve [S1].</p>`))
	})
})
