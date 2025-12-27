import { describe, test, expect } from "bun:test"
import { isToolProtectedByTurn, countTurns, type MessagePart } from "./pruning-utils"

describe("isToolProtectedByTurn", () => {
  test("#given turn protection disabled #when checking any turn #then returns false", () => {
    expect(isToolProtectedByTurn(1, 10, undefined)).toBe(false)
    expect(isToolProtectedByTurn(1, 10, { enabled: false, turns: 3 })).toBe(false)
  })

  test("#given turn protection with 3 turns #when tool is in last 3 turns #then returns true", () => {
    const config = { enabled: true, turns: 3 }
    
    // Current turn is 10, protected threshold = 10 - 3 + 1 = 8
    // Turns 8, 9, 10 are protected
    expect(isToolProtectedByTurn(10, 10, config)).toBe(true)
    expect(isToolProtectedByTurn(9, 10, config)).toBe(true)
    expect(isToolProtectedByTurn(8, 10, config)).toBe(true)
  })

  test("#given turn protection with 3 turns #when tool is before protected range #then returns false", () => {
    const config = { enabled: true, turns: 3 }
    
    // Current turn is 10, protected threshold = 10 - 3 + 1 = 8
    // Turns 7 and earlier are NOT protected
    expect(isToolProtectedByTurn(7, 10, config)).toBe(false)
    expect(isToolProtectedByTurn(1, 10, config)).toBe(false)
  })

  test("#given turn protection with 1 turn #when only current turn #then only current turn protected", () => {
    const config = { enabled: true, turns: 1 }
    
    // Current turn is 5, protected threshold = 5 - 1 + 1 = 5
    expect(isToolProtectedByTurn(5, 5, config)).toBe(true)
    expect(isToolProtectedByTurn(4, 5, config)).toBe(false)
  })

  test("#given small session #when turns less than protection window #then all turns protected", () => {
    const config = { enabled: true, turns: 5 }
    
    // Current turn is 3, protected threshold = 3 - 5 + 1 = -1
    // All turns >= -1 are protected (i.e., all)
    expect(isToolProtectedByTurn(1, 3, config)).toBe(true)
    expect(isToolProtectedByTurn(2, 3, config)).toBe(true)
    expect(isToolProtectedByTurn(3, 3, config)).toBe(true)
  })
})

describe("countTurns", () => {
  test("#given empty messages #when counting #then returns 0", () => {
    expect(countTurns([])).toBe(0)
  })

  test("#given messages with step-start parts #when counting #then returns correct count", () => {
    const messages: MessagePart[] = [
      { type: "message", parts: [{ type: "step-start" }] },
      { type: "message", parts: [{ type: "tool", callID: "1", tool: "read" }] },
      { type: "message", parts: [{ type: "step-start" }] },
    ]
    
    expect(countTurns(messages)).toBe(2)
  })

  test("#given messages without step-start #when counting #then returns 0", () => {
    const messages: MessagePart[] = [
      { type: "message", parts: [{ type: "tool", callID: "1", tool: "read" }] },
    ]
    
    expect(countTurns(messages)).toBe(0)
  })

  test("#given messages with undefined parts #when counting #then handles gracefully", () => {
    const messages: MessagePart[] = [
      { type: "message" },
      { type: "message", parts: [{ type: "step-start" }] },
    ]
    
    expect(countTurns(messages)).toBe(1)
  })
})
