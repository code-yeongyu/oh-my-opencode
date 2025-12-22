import { tool } from "@opencode-ai/plugin/tool"
import { TOOL_DESCRIPTION } from "./constants"
import { callMorphApply, generateDiff, countChanges } from "./utils"

export const morph_edit = tool({
  description: TOOL_DESCRIPTION,
  args: {
    target_filepath: tool.schema
      .string()
      .describe("Path of the file to modify (absolute or relative to project root)"),
    instructions: tool.schema
      .string()
      .describe("Brief first-person description of what you're changing (helps disambiguate)"),
    code_edit: tool.schema
      .string()
      .describe('The code changes with "// ... existing code ..." markers for unchanged sections'),
  },
  execute: async (args) => {
    const { target_filepath, instructions, code_edit } = args

    // Check if API key is available
    if (!process.env.MORPH_API_KEY) {
      return `Error: MORPH_API_KEY not configured.

To use morph_edit, set the MORPH_API_KEY environment variable.
Get your API key at: https://morphllm.com/dashboard/api-keys

Alternatively, use the native 'edit' tool for this change.`
    }

    // Read the original file
    let originalCode: string
    try {
      const file = Bun.file(target_filepath)
      if (!(await file.exists())) {
        // New file - check if this is a creation
        if (!code_edit.includes("// ... existing code ...")) {
          await Bun.write(target_filepath, code_edit)
          return `Created new file: ${target_filepath}\n\nLines: ${code_edit.split("\n").length}`
        }
        return `Error: File not found: ${target_filepath}

The file doesn't exist and the code_edit contains lazy markers.
For new files, provide the complete content without "// ... existing code ..." markers.`
      }
      originalCode = await file.text()
    } catch (err) {
      const error = err as Error
      return `Error reading file ${target_filepath}: ${error.message}`
    }

    // Call Morph API to merge the edit
    const result = await callMorphApply(originalCode, code_edit, instructions)

    if (!result.success || !result.content) {
      return `Morph API failed: ${result.error}

Suggestion: Try using the native 'edit' tool instead with exact string replacement.`
    }

    const mergedCode = result.content

    // Write the merged result
    try {
      await Bun.write(target_filepath, mergedCode)
    } catch (err) {
      const error = err as Error
      return `Error writing file ${target_filepath}: ${error.message}`
    }

    // Generate summary
    const { added, removed } = countChanges(originalCode, mergedCode)
    const originalLines = originalCode.split("\n").length
    const mergedLines = mergedCode.split("\n").length
    const diff = generateDiff(target_filepath, originalCode, mergedCode)

    return `Applied edit to ${target_filepath}

+${added} -${removed} lines | ${originalLines} -> ${mergedLines} total

\`\`\`diff
${diff.slice(0, 2000)}${diff.length > 2000 ? "\n... (truncated)" : ""}
\`\`\``
  },
})
