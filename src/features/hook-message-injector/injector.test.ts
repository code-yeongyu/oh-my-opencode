import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { findNearestMessageWithFields } from "./injector"

const TEST_DIR = "/tmp/test-hook-message-injector"

describe("findNearestMessageWithFields", () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true })
    }
    mkdirSync(TEST_DIR, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true })
    }
  })

  test("returns message with model info when available", () => {
    // #given
    const messageWithModel = {
      id: "msg_001",
      agent: "Sisyphus",
      model: { providerID: "openai", modelID: "gpt-5.2" },
      tools: { write: true },
    }
    writeFileSync(join(TEST_DIR, "msg_001.json"), JSON.stringify(messageWithModel))

    // #when
    const result = findNearestMessageWithFields(TEST_DIR)

    // #then
    expect(result).not.toBeNull()
    expect(result?.agent).toBe("Sisyphus")
    expect(result?.model?.providerID).toBe("openai")
    expect(result?.model?.modelID).toBe("gpt-5.2")
  })

  test("returns most recent message with model info", () => {
    // #given
    const olderMessage = {
      id: "msg_001",
      agent: "Sisyphus",
      model: { providerID: "anthropic", modelID: "claude-opus-4-5" },
    }
    const newerMessage = {
      id: "msg_002",
      agent: "oracle",
      model: { providerID: "openai", modelID: "gpt-5.2" },
    }
    writeFileSync(join(TEST_DIR, "msg_001.json"), JSON.stringify(olderMessage))
    writeFileSync(join(TEST_DIR, "msg_002.json"), JSON.stringify(newerMessage))

    // #when
    const result = findNearestMessageWithFields(TEST_DIR)

    // #then
    expect(result?.agent).toBe("oracle")
    expect(result?.model?.providerID).toBe("openai")
    expect(result?.model?.modelID).toBe("gpt-5.2")
  })

  test("skips messages without complete model info", () => {
    // #given
    const incompleteMessage = {
      id: "msg_002",
      agent: "explore",
      model: { providerID: "openai" },
    }
    const completeMessage = {
      id: "msg_001",
      agent: "Sisyphus",
      model: { providerID: "anthropic", modelID: "claude-opus-4-5" },
    }
    writeFileSync(join(TEST_DIR, "msg_001.json"), JSON.stringify(completeMessage))
    writeFileSync(join(TEST_DIR, "msg_002.json"), JSON.stringify(incompleteMessage))

    // #when
    const result = findNearestMessageWithFields(TEST_DIR)

    // #then
    expect(result?.agent).toBe("Sisyphus")
    expect(result?.model?.providerID).toBe("anthropic")
    expect(result?.model?.modelID).toBe("claude-opus-4-5")
  })

  test("falls back to message with agent only when no model info exists", () => {
    // #given
    const agentOnlyMessage = {
      id: "msg_001",
      agent: "librarian",
    }
    writeFileSync(join(TEST_DIR, "msg_001.json"), JSON.stringify(agentOnlyMessage))

    // #when
    const result = findNearestMessageWithFields(TEST_DIR)

    // #then
    expect(result?.agent).toBe("librarian")
    expect(result?.model).toBeUndefined()
  })

  test("returns null for empty directory", () => {
    // #given - empty directory (already created in beforeEach)

    // #when
    const result = findNearestMessageWithFields(TEST_DIR)

    // #then
    expect(result).toBeNull()
  })

  test("returns null for non-existent directory", () => {
    // #given
    const nonExistentDir = "/tmp/non-existent-test-dir-12345"

    // #when
    const result = findNearestMessageWithFields(nonExistentDir)

    // #then
    expect(result).toBeNull()
  })

  test("preserves tools field from stored message", () => {
    // #given
    const messageWithTools = {
      id: "msg_001",
      agent: "frontend-ui-ux-engineer",
      model: { providerID: "google", modelID: "gemini-3-pro-preview" },
      tools: { write: true, edit: true, bash: false },
    }
    writeFileSync(join(TEST_DIR, "msg_001.json"), JSON.stringify(messageWithTools))

    // #when
    const result = findNearestMessageWithFields(TEST_DIR)

    // #then
    expect(result?.tools).toEqual({ write: true, edit: true, bash: false })
  })

  test("handles malformed JSON files gracefully", () => {
    // #given
    const validMessage = {
      id: "msg_001",
      agent: "Sisyphus",
      model: { providerID: "openai", modelID: "gpt-5.2" },
    }
    writeFileSync(join(TEST_DIR, "msg_001.json"), JSON.stringify(validMessage))
    writeFileSync(join(TEST_DIR, "msg_002.json"), "{ invalid json }")

    // #when
    const result = findNearestMessageWithFields(TEST_DIR)

    // #then
    expect(result?.agent).toBe("Sisyphus")
  })
})
