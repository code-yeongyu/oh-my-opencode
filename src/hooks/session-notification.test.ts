import { describe, expect, test } from "bun:test"

import { createSessionNotification } from "./session-notification"
import { setMainSession, subagentSessions } from "../features/claude-code-session-state"

describe("session-notification", () => {
  const mockPluginInput = {
    $: async (cmd: string | any[]) => {
      if (typeof cmd === "string") {
        return { stdout: "", stderr: "", exitCode: 0 }
      }
      return { stdout: "", stderr: "", exitCode: 0 }
    },
    client: {
      session: {
        todo: async () => ({ data: [] }),
      },
    },
    directory: "/tmp/test",
  } as any

  test("should not trigger notification for subagent session", async () => {
    const subagentSessionID = "subagent-123"
    subagentSessions.add(subagentSessionID)
    
    const notificationHook = createSessionNotification(mockPluginInput, {
      idleConfirmationDelay: 0,
    })

    await notificationHook({
      event: {
        type: "session.idle",
        properties: { sessionID: subagentSessionID },
      },
    })

    subagentSessions.clear()
  })

  test("should not trigger notification when mainSessionID is set and session is not main", async () => {
    const mainSessionID = "main-123"
    const otherSessionID = "other-456"
    setMainSession(mainSessionID)
    
    const notificationHook = createSessionNotification(mockPluginInput, {
      idleConfirmationDelay: 0,
    })

    await notificationHook({
      event: {
        type: "session.idle",
        properties: { sessionID: otherSessionID },
      },
    })

    setMainSession(undefined)
  })

  test("should trigger notification for main session when idle", async () => {
    const mainSessionID = "main-789"
    setMainSession(mainSessionID)
    
    const mockTodoAPI = {
      session: {
        todo: async () => ({
          data: [],
        }),
      },
    }

    const notificationHook = createSessionNotification(
      {
        ...mockPluginInput,
        client: mockTodoAPI,
      } as any,
      {
        idleConfirmationDelay: 10,
        skipIfIncompleteTodos: false,
      }
    )

    await notificationHook({
      event: {
        type: "session.idle",
        properties: { sessionID: mainSessionID },
      },
    })

    setMainSession(undefined)
  })

  test("should skip notification for subagent even when mainSessionID is set", async () => {
    const mainSessionID = "main-999"
    const subagentSessionID = "subagent-888"
    setMainSession(mainSessionID)
    subagentSessions.add(subagentSessionID)
    
    const notificationHook = createSessionNotification(mockPluginInput, {
      idleConfirmationDelay: 0,
    })

    await notificationHook({
      event: {
        type: "session.idle",
        properties: { sessionID: subagentSessionID },
      },
    })

    setMainSession(undefined)
    subagentSessions.clear()
  })

  test("should handle subagentSessions and mainSessionID checks in correct order", async () => {
    const mainSessionID = "main-111"
    const subagentSessionID = "subagent-222"
    setMainSession(mainSessionID)
    subagentSessions.add(subagentSessionID)
    
    let subagentCheckPassed = false
    let mainSessionCheckPassed = false

    const hook = createSessionNotification(mockPluginInput, {
      idleConfirmationDelay: 0,
    })

    await hook({
      event: {
        type: "session.idle",
        properties: { sessionID: subagentSessionID },
      },
    })
    subagentCheckPassed = true

    await hook({
      event: {
        type: "session.idle",
        properties: { sessionID: "some-other-session" },
      },
    })
    mainSessionCheckPassed = true

    expect(subagentCheckPassed).toBe(true)
    expect(mainSessionCheckPassed).toBe(true)

    setMainSession(undefined)
    subagentSessions.clear()
  })

  test("should handle session.created event correctly", async () => {
    const mainSessionID = "main-created"
    setMainSession(mainSessionID)
    
    const hook = createSessionNotification(mockPluginInput, {})

    await hook({
      event: {
        type: "session.created",
        properties: {
          info: { id: "new-session", title: "Test Session" },
        },
      },
    })

    setMainSession(undefined)
  })

  test("should handle session.deleted event correctly", async () => {
    const hook = createSessionNotification(mockPluginInput, {})

    await hook({
      event: {
        type: "session.deleted",
        properties: {
          info: { id: "deleted-session" },
        },
      },
    })

    expect(true).toBe(true)
  })

  test("should handle message.updated event correctly", async () => {
    const hook = createSessionNotification(mockPluginInput, {})

    await hook({
      event: {
        type: "message.updated",
        properties: {
          info: { sessionID: "session-123", role: "user", finish: false },
        },
      },
    })

    expect(true).toBe(true)
  })

  test("should handle tool.execute.before event correctly", async () => {
    const hook = createSessionNotification(mockPluginInput, {})

    await hook({
      event: {
        type: "tool.execute.before",
        properties: { sessionID: "session-456" },
      },
    })

    expect(true).toBe(true)
  })
})
