import { tool } from "@opencode-ai/plugin/tool"
import { DEFAULT_STRATEGY, MAX_OUTPUT_SIZE, TIMEOUT_MS } from "./constants"
import { applyReadability, applyRaw, applyGrep, applySnapshot, applySelector, applyJq, type GrepOptions } from "./strategies"
import type { CompactionStrategy } from "./types"

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; OpenCode/1.0)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    return await response.text()
  } finally {
    clearTimeout(timeoutId)
  }
}

interface StrategyOptions extends GrepOptions {
  pattern?: string
  selector?: string
  query?: string
}

async function applyStrategy(
  content: string,
  url: string,
  strategy: CompactionStrategy,
  options?: StrategyOptions
): Promise<string> {
  switch (strategy) {
    case "readability":
      return applyReadability(content, url)
    case "raw":
      return applyRaw(content)
    case "grep":
      if (!options?.pattern) {
        return "Error: 'pattern' is required for grep strategy"
      }
      return applyGrep(content, options.pattern, options)
    case "snapshot":
      return applySnapshot(content)
    case "selector":
      if (!options?.selector) {
        return "Error: 'selector' is required for selector strategy"
      }
      return applySelector(content, options.selector)
    case "jq":
      if (!options?.query) {
        return "Error: 'query' is required for jq strategy"
      }
      return await applyJq(content, options.query)
    default:
      return applyReadability(content, url)
  }
}

export const webfetch = tool({
  description:
    "Fetch and process web content with compaction strategies.\n\n" +
    "STRATEGY SELECTION GUIDE:\n" +
    "- 'jq': Query JSON APIs with jq syntax. Best for REST APIs, npm registry, GitHub API.\n" +
    "- 'readability': Extracts article content as markdown. Best for blogs, news, documentation pages.\n" +
    "- 'snapshot': ARIA-like semantic tree of page structure. Best for understanding layout, forms, navigation.\n" +
    "- 'selector': Extract elements matching a CSS selector. Best when you know exact element to target.\n" +
    "- 'grep': Filter lines matching a pattern with optional before/after context (like grep -B/-A).\n" +
    "- 'raw': No processing. Returns exact content (truncated to 500KB if larger).",
  args: {
    url: tool.schema.string().describe("The URL to fetch"),
    strategy: tool.schema
      .enum(["readability", "snapshot", "selector", "grep", "jq", "raw"])
      .optional()
      .describe("Compaction strategy (default: raw)."),
    pattern: tool.schema.string().optional().describe("Regex pattern for grep strategy"),
    selector: tool.schema.string().optional().describe("CSS selector for selector strategy"),
    query: tool.schema.string().optional().describe("jq query for JSON APIs (e.g., '.data.items[]', '.name')"),
    limit: tool.schema.number().optional().describe("Max lines to return for grep (default: 100)"),
    offset: tool.schema.number().optional().describe("Skip first N result lines for grep pagination"),
    before: tool.schema.number().optional().describe("Lines of context before each match (like grep -B)"),
    after: tool.schema.number().optional().describe("Lines of context after each match (like grep -A)"),
  },
  execute: async (args) => {
    const strategy = args.strategy ?? DEFAULT_STRATEGY
    const url = args.url.startsWith("http") ? args.url : `https://${args.url}`

    try {
      const rawContent = await fetchWithTimeout(url, TIMEOUT_MS)
      const originalSize = rawContent.length

      let result = await applyStrategy(rawContent, url, strategy, {
        pattern: args.pattern,
        selector: args.selector,
        query: args.query,
        limit: args.limit,
        offset: args.offset,
        before: args.before,
        after: args.after,
      })

      let truncated = false
      if (result.length > MAX_OUTPUT_SIZE) {
        result = result.slice(0, MAX_OUTPUT_SIZE)
        truncated = true
      }

      const compactedSize = result.length
      const reduction = ((1 - compactedSize / originalSize) * 100).toFixed(1)

      const header = [
        `URL: ${url}`,
        `Strategy: ${strategy}`,
        `Size: ${formatBytes(originalSize)} → ${formatBytes(compactedSize)} (${reduction}% reduction)`,
        truncated ? `[Output truncated to ${formatBytes(MAX_OUTPUT_SIZE)}]` : "",
        "---",
      ]
        .filter(Boolean)
        .join("\n")

      return `${header}\n\n${result}`
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === "AbortError") {
          return `Error: Request timed out after ${TIMEOUT_MS / 1000}s`
        }
        return `Error: ${error.message}`
      }
      return `Error: ${String(error)}`
    }
  },
})
