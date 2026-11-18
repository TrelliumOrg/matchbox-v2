import type { BusyReason, StuartResponse, StuartStreamEvent } from "./contract"
import type { StuartEntity } from "./store"

/**
 * The conversation state machine. A turn starts streaming, collects status
 * lines, and ends answered, busy, failed or stopped. The reducer is pure so
 * the session, persistence and tests share one source of truth.
 */

export type TurnOutcome =
  | { kind: "streaming" }
  | { kind: "answered"; response: StuartResponse; cached: boolean }
  | { kind: "busy"; reason: BusyReason; retryAfterSeconds: number | null }
  | { kind: "failed"; code: string; message: string }
  | { kind: "stopped" }

export type Turn = {
  id: string
  question: string
  entity: StuartEntity | null
  askedAt: string
  status: string[]
  outcome: TurnOutcome
}

export type Conversation = {
  /** A UUID, sent as the request's sessionId. */
  id: string
  title: string
  createdAt: string
  updatedAt: string
  turns: Turn[]
}

export type ThreadState = {
  conversations: Conversation[]
  activeId: string | null
}

export type ThreadAction =
  | { type: "load"; state: ThreadState }
  | {
      type: "ask"
      conversationId: string
      turnId: string
      question: string
      entity: StuartEntity | null
      at: string
    }
  | { type: "event"; turnId: string; event: StuartStreamEvent; at: string }
  | { type: "retry"; turnId: string; at: string }
  | { type: "stop"; turnId: string }
  | { type: "fail"; turnId: string; code: string; message: string }
  | { type: "new" }
  | { type: "select"; conversationId: string }

export const emptyThread: ThreadState = { conversations: [], activeId: null }

/** Keep history readable: titles are the first question, shortened. */
export function titleFor(question: string): string {
  const trimmed = question.trim().replace(/\s+/g, " ")
  return trimmed.length > 60 ? `${trimmed.slice(0, 59)}…` : trimmed
}

function mapTurn(
  state: ThreadState,
  turnId: string,
  at: string | null,
  update: (turn: Turn) => Turn,
): ThreadState {
  let changed = false
  const conversations = state.conversations.map((conversation) => {
    if (!conversation.turns.some((turn) => turn.id === turnId)) {
      return conversation
    }
    changed = true
    return {
      ...conversation,
      updatedAt: at ?? conversation.updatedAt,
      turns: conversation.turns.map((turn) =>
        turn.id === turnId ? update(turn) : turn,
      ),
    }
  })
  return changed ? { ...state, conversations } : state
}

function applyEvent(turn: Turn, event: StuartStreamEvent): Turn {
  if (turn.outcome.kind !== "streaming") return turn
  switch (event.type) {
    case "status":
      if (turn.status.at(-1) === event.text) return turn
      return { ...turn, status: [...turn.status, event.text].slice(-8) }
    case "answer":
      return {
        ...turn,
        outcome: {
          kind: "answered",
          response: event.response,
          cached: event.cached,
        },
      }
    case "busy":
      return {
        ...turn,
        outcome: {
          kind: "busy",
          reason: event.reason,
          retryAfterSeconds: event.retryAfterSeconds,
        },
      }
    case "error":
      return {
        ...turn,
        outcome: { kind: "failed", code: event.code, message: event.message },
      }
    case "done":
      return {
        ...turn,
        outcome: { kind: "failed", code: "internal", message: "No answer" },
      }
  }
}

export function threadReducer(
  state: ThreadState,
  action: ThreadAction,
): ThreadState {
  switch (action.type) {
    case "load":
      return action.state
    case "ask": {
      const turn: Turn = {
        id: action.turnId,
        question: action.question,
        entity: action.entity,
        askedAt: action.at,
        status: [],
        outcome: { kind: "streaming" },
      }
      const existing = state.conversations.find(
        (conversation) => conversation.id === action.conversationId,
      )
      if (existing === undefined) {
        const conversation: Conversation = {
          id: action.conversationId,
          title: titleFor(action.question),
          createdAt: action.at,
          updatedAt: action.at,
          turns: [turn],
        }
        return {
          conversations: [conversation, ...state.conversations],
          activeId: conversation.id,
        }
      }
      return {
        activeId: existing.id,
        conversations: state.conversations.map((conversation) =>
          conversation.id === existing.id
            ? {
                ...conversation,
                updatedAt: action.at,
                turns: [...conversation.turns, turn],
              }
            : conversation,
        ),
      }
    }
    case "event":
      return mapTurn(state, action.turnId, action.at, (turn) =>
        applyEvent(turn, action.event),
      )
    case "retry":
      return mapTurn(state, action.turnId, action.at, (turn) => ({
        ...turn,
        status: [],
        outcome: { kind: "streaming" },
      }))
    case "stop":
      return mapTurn(state, action.turnId, null, (turn) =>
        turn.outcome.kind === "streaming"
          ? { ...turn, outcome: { kind: "stopped" } }
          : turn,
      )
    case "fail":
      return mapTurn(state, action.turnId, null, (turn) =>
        turn.outcome.kind === "streaming"
          ? {
              ...turn,
              outcome: {
                kind: "failed",
                code: action.code,
                message: action.message,
              },
            }
          : turn,
      )
    case "new":
      return { ...state, activeId: null }
    case "select":
      return state.conversations.some(
        (conversation) => conversation.id === action.conversationId,
      )
        ? { ...state, activeId: action.conversationId }
        : state
  }
}

export function activeConversation(state: ThreadState): Conversation | null {
  return (
    state.conversations.find(
      (conversation) => conversation.id === state.activeId,
    ) ?? null
  )
}

export function streamingTurn(state: ThreadState): Turn | null {
  for (const conversation of state.conversations) {
    for (const turn of conversation.turns) {
      if (turn.outcome.kind === "streaming") return turn
    }
  }
  return null
}

/** The last answered turn before `turnId`, for the request's `previous`. */
export function previousAnswer(
  conversation: Conversation | null,
  beforeTurnId: string | null,
): StuartResponse | null {
  if (conversation === null) return null
  let previous: StuartResponse | null = null
  for (const turn of conversation.turns) {
    if (turn.id === beforeTurnId) break
    if (turn.outcome.kind === "answered") previous = turn.outcome.response
  }
  return previous
}
