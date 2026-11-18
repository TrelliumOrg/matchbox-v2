import { describe, expect, it } from "vitest"
import type { StuartRequest } from "./contract"
import { fixtureTurn } from "./fixtures"
import {
  activeConversation,
  emptyThread,
  previousAnswer,
  streamingTurn,
  type ThreadState,
  threadReducer,
} from "./thread"

const conversationId = "6f1c1b8e-3c55-4a3f-9b8a-1d2e3f4a5b6c"
const at = "2026-11-08T11:53:00.000Z"

const request: StuartRequest = {
  version: 1,
  query: "Which gauges pay best?",
  sessionId: conversationId,
  turn: 0,
  surface: "composer",
  chainId: 31_612,
}

function asked(state: ThreadState = emptyThread, turnId = "t1"): ThreadState {
  return threadReducer(state, {
    type: "ask",
    conversationId,
    turnId,
    question: "Which gauges pay best?",
    entity: null,
    at,
  })
}

describe("threadReducer", () => {
  it("starts a conversation streaming and collects status lines", () => {
    let state = asked()
    expect(state.activeId).toBe(conversationId)
    expect(streamingTurn(state)?.id).toBe("t1")
    state = threadReducer(state, {
      type: "event",
      turnId: "t1",
      event: { type: "status", text: "Reading 34 gauges" },
      at,
    })
    state = threadReducer(state, {
      type: "event",
      turnId: "t1",
      event: { type: "status", text: "Reading 34 gauges" },
      at,
    })
    expect(streamingTurn(state)?.status).toEqual(["Reading 34 gauges"])
  })

  it("settles on answer and ignores later events for the turn", () => {
    const response = fixtureTurn(request).response
    let state = threadReducer(asked(), {
      type: "event",
      turnId: "t1",
      event: { type: "answer", response, cached: false },
      at,
    })
    state = threadReducer(state, {
      type: "event",
      turnId: "t1",
      event: { type: "error", code: "internal", message: "late" },
      at,
    })
    const turn = activeConversation(state)?.turns[0]
    expect(turn?.outcome.kind).toBe("answered")
    expect(streamingTurn(state)).toBeNull()
    expect(previousAnswer(activeConversation(state), null)?.responseId).toBe(
      response.responseId,
    )
  })

  it("records busy, failure, done without answer, stop and retry", () => {
    const busy = threadReducer(asked(), {
      type: "event",
      turnId: "t1",
      event: { type: "busy", reason: "spend_cap", retryAfterSeconds: 60 },
      at,
    })
    expect(activeConversation(busy)?.turns[0]?.outcome).toEqual({
      kind: "busy",
      reason: "spend_cap",
      retryAfterSeconds: 60,
    })
    const done = threadReducer(asked(), {
      type: "event",
      turnId: "t1",
      event: { type: "done" },
      at,
    })
    expect(activeConversation(done)?.turns[0]?.outcome.kind).toBe("failed")
    const stopped = threadReducer(asked(), { type: "stop", turnId: "t1" })
    expect(activeConversation(stopped)?.turns[0]?.outcome.kind).toBe("stopped")
    const retried = threadReducer(busy, { type: "retry", turnId: "t1", at })
    expect(streamingTurn(retried)?.id).toBe("t1")
  })

  it("adds later questions to the active conversation and starts new chats", () => {
    let state = asked()
    state = asked(state, "t2")
    expect(activeConversation(state)?.turns).toHaveLength(2)
    state = threadReducer(state, { type: "new" })
    expect(activeConversation(state)).toBeNull()
    state = threadReducer(state, {
      type: "ask",
      conversationId: "7f1c1b8e-3c55-4a3f-9b8a-1d2e3f4a5b6c",
      turnId: "t3",
      question: "When does #4120 unlock?",
      entity: null,
      at,
    })
    expect(state.conversations).toHaveLength(2)
    state = threadReducer(state, { type: "select", conversationId })
    expect(activeConversation(state)?.turns).toHaveLength(2)
  })
})
