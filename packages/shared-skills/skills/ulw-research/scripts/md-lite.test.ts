import { describe, expect, test } from "bun:test"

import { parseMarkdown, sectionKindsMd } from "./md-lite.mjs"

type Cell = { text: string; start: number; end: number }
type Block = { kind: string; level?: number; text: string; start: number; end: number; cells?: Cell[] }

const FIXTURE = [
	"# 반도체 시장 보고서",
	"",
	"매출은 {{F1}}로 집계됐다. Revenue grew",
	"across two quarters.",
	"",
	"## Findings",
	"",
	"- 첫 번째 항목 120억 원",
	"* Second item 3.2 m",
	"1. Ordered item 45%",
	"",
	"| 지표 | Value |",
	"| --- | ---: |",
	"| 매출 | 100억 원 |",
	"",
	"> 원문 인용 그대로다.",
	"",
	"```js",
	"const total = 9999",
	"```",
	"",
	"## Sources",
	"",
	"S1 example.org",
	"",
	"## 출처",
	"",
	"## Closing",
	"",
	"### Method",
	"",
	"## 마무리",
	"",
].join("\n")

function blocksOf(text: string): Block[] {
	return (parseMarkdown(text) as { blocks: Block[] }).blocks
}

function expectSlices(text: string, blocks: Block[]): void {
	for (const block of blocks) {
		expect(text.slice(block.start, block.end)).toBe(block.text)
		for (const cell of block.cells ?? []) expect(text.slice(cell.start, cell.end)).toBe(cell.text)
	}
}

describe("parseMarkdown", () => {
	test("#given a Korean+English fixture #when parsed #then block kinds come in document order", () => {
		// given
		const text = FIXTURE
		// when
		const blocks = blocksOf(text)
		// then
		expect(blocks.map((b) => b.kind)).toEqual([
			"heading",
			"paragraph",
			"heading",
			"list_item",
			"list_item",
			"list_item",
			"table_row",
			"table_row",
			"blockquote",
			"code",
			"heading",
			"paragraph",
			"heading",
			"heading",
			"heading",
			"heading",
		])
	})

	test("#given the fixture #when parsed #then every block and cell slices exactly from start to end", () => {
		// given
		const text = FIXTURE
		// when
		const blocks = blocksOf(text)
		// then
		expectSlices(text, blocks)
		expect(blocks[0]).toMatchObject({ kind: "heading", level: 1, text: "반도체 시장 보고서" })
		expect(blocks[1]?.text).toBe("매출은 {{F1}}로 집계됐다. Revenue grew\nacross two quarters.")
		expect(blocks.filter((b) => b.kind === "list_item").map((b) => b.text)).toEqual([
			"첫 번째 항목 120억 원",
			"Second item 3.2 m",
			"Ordered item 45%",
		])
		expect(blocks.find((b) => b.kind === "blockquote")?.text).toBe("원문 인용 그대로다.")
	})

	test("#given a table with a separator row #when parsed #then rows carry trimmed cells and the separator is skipped", () => {
		// given
		const text = FIXTURE
		// when
		const rows = blocksOf(text).filter((b) => b.kind === "table_row")
		// then
		expect(rows.map((r) => (r.cells ?? []).map((c) => c.text))).toEqual([
			["지표", "Value"],
			["매출", "100억 원"],
		])
		expectSlices(text, rows)
	})

	test("#given a fenced code block with numerals #when parsed #then the numerals sit only in a block of kind code", () => {
		// given
		const text = FIXTURE
		// when
		const blocks = blocksOf(text)
		// then
		const holders = blocks.filter((b) => b.text.includes("9999"))
		expect(holders.map((b) => b.kind)).toEqual(["code"])
		expect(holders[0]?.text).toBe("const total = 9999")
	})

	test("#given an unterminated code fence #when parsed #then it is code to EOF and nothing throws", () => {
		// given
		const text = "Intro 12.\n\n```\nlet a = 1\n## not a heading\n"
		// when
		const blocks = blocksOf(text)
		// then
		expect(blocks.map((b) => b.kind)).toEqual(["paragraph", "code"])
		expect(blocks[1]?.text).toBe("let a = 1\n## not a heading\n")
		expectSlices(text, blocks)
	})
})

describe("sectionKindsMd", () => {
	test("#given h2 headings in English and Korean #when classified #then sources and closing kinds match gates-static", () => {
		// given
		const blocks = blocksOf(FIXTURE)
		// when
		const kinds = sectionKindsMd(blocks) as (string | null)[]
		// then
		const byHeading: Record<string, string | null | undefined> = {}
		blocks.forEach((b, i) => {
			if (b.kind === "heading") byHeading[b.text] = kinds[i]
		})
		expect(byHeading.Findings).toBeNull()
		expect(byHeading.Sources).toBe("sources")
		expect(byHeading["출처"]).toBe("sources")
		expect(byHeading.Closing).toBe("closing")
		expect(byHeading["마무리"]).toBe("closing")
		expect(kinds).toHaveLength(blocks.length)
	})

	test("#given body blocks under a section #when classified #then they inherit the enclosing h2 kind", () => {
		// given
		const blocks = blocksOf(FIXTURE)
		// when
		const kinds = sectionKindsMd(blocks) as (string | null)[]
		// then
		const codeIndex = blocks.findIndex((b) => b.kind === "code")
		const sourceLine = blocks.findIndex((b) => b.text === "S1 example.org")
		expect(kinds[codeIndex]).toBeNull()
		expect(kinds[sourceLine]).toBe("sources")
		expect(kinds[0]).toBeNull()
	})
})
