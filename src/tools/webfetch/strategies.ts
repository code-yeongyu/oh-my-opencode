import { JSDOM } from "jsdom"
import { Readability } from "@mozilla/readability"
import TurndownService from "turndown"
import * as cheerio from "cheerio"
import type { Element } from "domhandler"
import * as jq from "jq-wasm"

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
})

export function applyReadability(html: string, url: string): string {
  const dom = new JSDOM(html, { url })
  const reader = new Readability(dom.window.document.cloneNode(true) as Document)
  const article = reader.parse()

  if (!article?.content) {
    return turndown.turndown(html)
  }

  return turndown.turndown(article.content)
}

export function applyRaw(content: string): string {
  return content
}

function truncateAroundMatch(line: string, pattern: RegExp, contextLength: number = 200): string {
  // CRITICAL: Create fresh regex without 'g' flag - RegExp.exec with 'g' flag maintains lastIndex state
  const freshPattern = new RegExp(pattern.source, pattern.flags.replace("g", ""))
  const match = freshPattern.exec(line)

  if (!match) return line.length > contextLength * 2 ? line.slice(0, contextLength * 2) + "..." : line

  const matchStart = match.index
  const matchEnd = matchStart + match[0].length

  const start = Math.max(0, matchStart - contextLength)
  const end = Math.min(line.length, matchEnd + contextLength)

  let result = line.slice(start, end)
  if (start > 0) result = "..." + result
  if (end < line.length) result = result + "..."

  return result
}

export interface GrepOptions {
  limit?: number
  offset?: number
  before?: number
  after?: number
}

export function applyGrep(content: string, pattern: string, options: GrepOptions = {}): string {
  const { limit = 100, offset = 0, before = 0, after = 0 } = options

  let regex: RegExp
  try {
    regex = new RegExp(pattern, "gi")
  } catch {
    return `Error: Invalid regex pattern: ${pattern}`
  }

  const lines = content.split("\n")
  const matchingIndices = new Set<number>()

  for (let i = 0; i < lines.length; i++) {
    if (regex.test(lines[i])) {
      matchingIndices.add(i)
    }
    regex.lastIndex = 0
  }

  if (matchingIndices.size === 0) {
    return `No matches found for pattern: ${pattern}`
  }

  const contextIndices = new Set<number>()
  for (const idx of matchingIndices) {
    for (let i = Math.max(0, idx - before); i <= Math.min(lines.length - 1, idx + after); i++) {
      contextIndices.add(i)
    }
  }

  const sortedIndices = Array.from(contextIndices).sort((a, b) => a - b)
  const paginatedIndices = sortedIndices.slice(offset, offset + limit)

  const resultLines: string[] = []
  let prevIdx = -2

  for (const idx of paginatedIndices) {
    if (prevIdx !== -2 && idx > prevIdx + 1) {
      resultLines.push("--")
    }
    prevIdx = idx

    const line = lines[idx]
    const isMatch = matchingIndices.has(idx)
    const lineNum = String(idx + 1).padStart(4)

    if (isMatch) {
      const truncatedLine = truncateAroundMatch(line, regex, 200)
      resultLines.push(`${lineNum}:${truncatedLine}`)
    } else {
      const truncatedLine = line.length > 450 ? line.slice(0, 450) + "..." : line
      resultLines.push(`${lineNum}-${truncatedLine}`)
    }
  }

  const totalMatches = matchingIndices.size
  const totalWithContext = sortedIndices.length
  const showing = paginatedIndices.length

  const header = [
    `Pattern: ${pattern}`,
    `Matches: ${totalMatches} lines`,
    before > 0 || after > 0 ? `Context: ${before} before, ${after} after (${totalWithContext} total lines)` : "",
    showing < totalWithContext ? `Showing: ${offset + 1}-${offset + showing} of ${totalWithContext}` : "",
    "---",
  ]
    .filter(Boolean)
    .join("\n")

  return `${header}\n${resultLines.join("\n")}`
}

const SEMANTIC_ELEMENTS: Record<string, string> = {
  h1: "heading1",
  h2: "heading2",
  h3: "heading3",
  h4: "heading4",
  h5: "heading5",
  h6: "heading6",
  a: "link",
  button: "button",
  input: "input",
  select: "combobox",
  textarea: "textbox",
  form: "form",
  nav: "navigation",
  main: "main",
  header: "banner",
  footer: "contentinfo",
  aside: "complementary",
  article: "article",
  section: "region",
  img: "image",
  table: "table",
  ul: "list",
  ol: "list",
  li: "listitem",
}

function getAriaRole(el: Element, $: cheerio.CheerioAPI): string | null {
  const $el = $(el)
  const explicitRole = $el.attr("role")
  if (explicitRole) return explicitRole

  const tagName = el.tagName?.toLowerCase()
  return SEMANTIC_ELEMENTS[tagName] || null
}

function getElementLabel(el: Element, $: cheerio.CheerioAPI): string {
  const $el = $(el)
  const tagName = el.tagName?.toLowerCase()

  const ariaLabel = $el.attr("aria-label")
  if (ariaLabel) return ariaLabel

  const title = $el.attr("title")
  if (title) return title

  if (tagName === "img") {
    const alt = $el.attr("alt")
    if (alt) return alt
  }

  if (tagName === "input") {
    const placeholder = $el.attr("placeholder")
    const name = $el.attr("name")
    const type = $el.attr("type") || "text"
    return placeholder || name || `[${type}]`
  }

  const text = $el.clone().children().remove().end().text().trim()
  if (text && text.length <= 100) return text

  return ""
}

function getElementAttrs(el: Element, $: cheerio.CheerioAPI): string {
  const $el = $(el)
  const tagName = el.tagName?.toLowerCase()
  const attrs: string[] = []

  if (tagName === "a") {
    const href = $el.attr("href")
    if (href && !href.startsWith("javascript:")) {
      attrs.push(`href="${href.length > 80 ? href.slice(0, 80) + "..." : href}"`)
    }
  }

  if (tagName === "img") {
    const src = $el.attr("src")
    if (src) attrs.push(`src="${src.length > 80 ? src.slice(0, 80) + "..." : src}"`)
  }

  if (tagName === "input") {
    const type = $el.attr("type")
    if (type) attrs.push(`type="${type}"`)
  }

  const id = $el.attr("id")
  if (id) attrs.push(`id="${id}"`)

  return attrs.join(" ")
}

export function applySnapshot(html: string): string {
  const $ = cheerio.load(html)

  $("script, style, noscript, svg, path").remove()

  const lines: string[] = []

  function traverse(el: Element, depth: number): void {
    if (el.type !== "tag") return

    const role = getAriaRole(el, $)
    if (!role) {
      $(el)
        .children()
        .each((_, child) => traverse(child, depth))
      return
    }

    const label = getElementLabel(el, $)
    const attrs = getElementAttrs(el, $)
    const indent = "  ".repeat(depth)

    let line = `${indent}[${role}]`
    if (label) line += ` "${label.length > 60 ? label.slice(0, 60) + "..." : label}"`
    if (attrs) line += ` (${attrs})`

    lines.push(line)

    $(el)
      .children()
      .each((_, child) => traverse(child, depth + 1))
  }

  $("body")
    .children()
    .each((_, el) => traverse(el, 0))

  if (lines.length === 0) {
    return "No semantic elements found in page"
  }

  return `Page Snapshot (${lines.length} elements)\n---\n${lines.join("\n")}`
}

export function applySelector(html: string, selector: string): string {
  const $ = cheerio.load(html)

  const elements = $(selector)
  if (elements.length === 0) {
    return `No elements found matching selector: ${selector}`
  }

  const results: string[] = []

  elements.each((i, el) => {
    const $el = $(el)
    const tagName = (el as Element).tagName?.toLowerCase() || "unknown"

    const text = $el.text().trim()
    const truncatedText = text.length > 200 ? text.slice(0, 200) + "..." : text

    const attrs: string[] = []
    const href = $el.attr("href")
    if (href) attrs.push(`href="${href.length > 100 ? href.slice(0, 100) + "..." : href}"`)

    const src = $el.attr("src")
    if (src) attrs.push(`src="${src.length > 100 ? src.slice(0, 100) + "..." : src}"`)

    const id = $el.attr("id")
    if (id) attrs.push(`id="${id}"`)

    const className = $el.attr("class")
    if (className) attrs.push(`class="${className.length > 50 ? className.slice(0, 50) + "..." : className}"`)

    let line = `[${i + 1}] <${tagName}>`
    if (attrs.length > 0) line += ` (${attrs.join(", ")})`
    if (truncatedText) line += `\n    ${truncatedText}`

    results.push(line)
  })

  return `Selector: ${selector}\nMatches: ${elements.length}\n---\n${results.join("\n\n")}`
}

export async function applyJq(content: string, query: string): Promise<string> {
  try {
    JSON.parse(content)
  } catch {
    return "Error: Content is not valid JSON. Use 'jq' strategy only for JSON APIs."
  }

  try {
    const result = await jq.raw(content, query)
    if (result.exitCode !== 0) {
      return `Error: jq query failed: ${result.stderr}`
    }
    return result.stdout.trim()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return `Error: Invalid jq query: ${message}`
  }
}
