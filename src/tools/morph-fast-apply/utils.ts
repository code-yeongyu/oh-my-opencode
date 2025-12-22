import { MORPH_API_URL, MORPH_MODEL, MORPH_TIMEOUT } from "./constants"
import type { MorphApplyResult, MorphApiResponse } from "./types"

/**
 * Call Morph's Apply API to merge code edits
 */
export async function callMorphApply(
  originalCode: string,
  codeEdit: string,
  instructions: string
): Promise<MorphApplyResult> {
  const apiKey = process.env.MORPH_API_KEY

  if (!apiKey) {
    return {
      success: false,
      error: "MORPH_API_KEY not set. Get one at https://morphllm.com/dashboard/api-keys",
    }
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), MORPH_TIMEOUT)

  try {
    const response = await fetch(`${MORPH_API_URL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MORPH_MODEL,
        messages: [
          {
            role: "user",
            content: `<instruction>${instructions}</instruction>\n<code>${originalCode}</code>\n<update>${codeEdit}</update>`,
          },
        ],
        temperature: 0,
      }),
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      const errorText = await response.text()
      return {
        success: false,
        error: `Morph API error (${response.status}): ${errorText}`,
      }
    }

    const result = (await response.json()) as MorphApiResponse
    const mergedCode = result.choices?.[0]?.message?.content

    if (!mergedCode) {
      return {
        success: false,
        error: "Morph API returned empty response",
      }
    }

    return {
      success: true,
      content: mergedCode,
    }
  } catch (err) {
    clearTimeout(timeoutId)
    const error = err as Error
    if (error.name === "AbortError") {
      return {
        success: false,
        error: `Morph API timeout after ${MORPH_TIMEOUT}ms`,
      }
    }
    return {
      success: false,
      error: `Morph API request failed: ${error.message}`,
    }
  }
}

/**
 * Generate a simple unified diff for display
 */
export function generateDiff(filepath: string, original: string, modified: string): string {
  const originalLines = original.split("\n")
  const modifiedLines = modified.split("\n")

  let diff = `--- a/${filepath}\n+++ b/${filepath}\n`
  let hasChanges = false

  const maxLines = Math.max(originalLines.length, modifiedLines.length)

  for (let i = 0; i < maxLines; i++) {
    const origLine = originalLines[i]
    const modLine = modifiedLines[i]

    if (origLine !== modLine) {
      hasChanges = true
      if (origLine !== undefined) {
        diff += `-${origLine}\n`
      }
      if (modLine !== undefined) {
        diff += `+${modLine}\n`
      }
    }
  }

  return hasChanges ? diff : "No changes detected"
}

/**
 * Count additions and deletions from diff output
 */
export function countChanges(original: string, modified: string): { added: number; removed: number } {
  const originalLines = original.split("\n")
  const modifiedLines = modified.split("\n")

  let added = 0
  let removed = 0

  const maxLines = Math.max(originalLines.length, modifiedLines.length)

  for (let i = 0; i < maxLines; i++) {
    if (originalLines[i] !== modifiedLines[i]) {
      if (originalLines[i] !== undefined) removed++
      if (modifiedLines[i] !== undefined) added++
    }
  }

  return { added, removed }
}
