export const MORPH_API_URL = process.env.MORPH_API_URL || "https://api.morphllm.com"
export const MORPH_MODEL = process.env.MORPH_MODEL || "morph-v3-fast"
export const MORPH_TIMEOUT = parseInt(process.env.MORPH_TIMEOUT || "30000", 10)

export const TOOL_DESCRIPTION = `Fast code editing using Morph AI (10,500+ tokens/sec).

Use this tool for efficient partial file edits. It handles lazy edit markers
so you don't need to provide the full file content.

FORMAT:
Use "// ... existing code ..." to represent unchanged code blocks.
Include just enough surrounding context to locate each edit precisely.

EXAMPLE:
// ... existing code ...
function updatedFunction() {
  // New implementation with changes
  return "modified";
}
// ... existing code ...

RULES:
- ALWAYS use "// ... existing code ..." for unchanged sections
- Include minimal context around edits for disambiguation
- Preserve exact indentation
- For deletions: show context before and after, omit deleted lines
- Batch multiple edits to the same file in one call

WHEN TO USE:
- Large files (500+ lines)
- Multiple scattered changes
- Complex refactoring
- When exact string matching is fragile

REQUIRES: MORPH_API_KEY environment variable. Get one at https://morphllm.com/dashboard/api-keys`
