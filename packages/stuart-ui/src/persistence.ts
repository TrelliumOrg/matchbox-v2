import { z } from "zod"
import { busyReasonSchema, stuartResponseSchema } from "./contract"
import type { Conversation, ThreadState, Turn } from "./thread"

/**
 * Conversations persist per wallet in localStorage: key by the lower-case
 * address, or "anonymous". Every read and write is wrapped (private mode,
 * quota, disabled storage) and validated with zod on the way back in. Size
 * is capped: the newest conversations and turns win.
 */

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">

export const MAX_CONVERSATIONS = 12
export const MAX_TURNS = 20
export const MAX_BYTES = 400_000

const storagePrefix = "matchbox:stuart:v1:"

const entitySchema = z.object({
  type: z.enum(["gauge", "lock", "trove", "vault", "epoch", "transaction"]),
  id: z.string().max(80),
  label: z.string().max(80),
})

const outcomeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("streaming") }),
  z.object({
    kind: z.literal("answered"),
    response: stuartResponseSchema,
    cached: z.boolean(),
  }),
  z.object({
    kind: z.literal("busy"),
    reason: busyReasonSchema,
    retryAfterSeconds: z.number().int().min(0).nullable(),
  }),
  z.object({
    kind: z.literal("failed"),
    code: z.string().max(40),
    message: z.string().max(200),
  }),
  z.object({ kind: z.literal("stopped") }),
])

const turnSchema = z.object({
  id: z.string().max(80),
  question: z.string().max(2_000),
  entity: entitySchema.nullable(),
  askedAt: z.string().max(40),
  status: z.array(z.string().max(120)).max(8),
  outcome: outcomeSchema,
})

const conversationSchema = z.object({
  id: z.uuid(),
  title: z.string().max(80),
  createdAt: z.string().max(40),
  updatedAt: z.string().max(40),
  turns: z.array(turnSchema).max(MAX_TURNS),
})

const storedSchema = z.object({
  version: z.literal(1),
  activeId: z.string().nullable(),
  conversations: z.array(conversationSchema).max(MAX_CONVERSATIONS),
})

export function walletKey(address: string | null): string {
  return address === null ? "anonymous" : address.toLowerCase()
}

export function storageKey(key: string): string {
  return `${storagePrefix}${key}`
}

/** localStorage, or null where reading it throws. */
export function browserStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage
  } catch {
    return null
  }
}

/** A turn cut off by a reload is stopped, never left streaming. */
function settle(turn: Turn): Turn {
  return turn.outcome.kind === "streaming"
    ? { ...turn, outcome: { kind: "stopped" } }
    : turn
}

function trim(state: ThreadState): ThreadState {
  const conversations = [...state.conversations]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, MAX_CONVERSATIONS)
    .map((conversation) => ({
      ...conversation,
      turns: conversation.turns.slice(-MAX_TURNS).map(settle),
    }))
  return { conversations, activeId: state.activeId }
}

export function loadThread(
  storage: StorageLike | null,
  key: string,
): ThreadState {
  if (storage === null) return { conversations: [], activeId: null }
  try {
    const text = storage.getItem(storageKey(key))
    if (text === null) return { conversations: [], activeId: null }
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch {
      return { conversations: [], activeId: null }
    }
    const parsed = storedSchema.safeParse(value)
    if (!parsed.success) return { conversations: [], activeId: null }
    const conversations: Conversation[] = parsed.data.conversations.map(
      (conversation) => ({
        ...conversation,
        turns: conversation.turns.map(settle),
      }),
    )
    const activeId = conversations.some(
      (conversation) => conversation.id === parsed.data.activeId,
    )
      ? parsed.data.activeId
      : null
    return { conversations, activeId }
  } catch {
    return { conversations: [], activeId: null }
  }
}

/** Writes the thread, dropping the oldest conversations until it fits. */
export function saveThread(
  storage: StorageLike | null,
  key: string,
  state: ThreadState,
): boolean {
  if (storage === null) return false
  const trimmed = trim(state)
  let conversations = trimmed.conversations
  try {
    while (true) {
      const text = JSON.stringify({
        version: 1,
        activeId: trimmed.activeId,
        conversations,
      })
      if (text.length <= MAX_BYTES || conversations.length <= 1) {
        if (conversations.length === 0) {
          storage.removeItem(storageKey(key))
        } else {
          storage.setItem(storageKey(key), text)
        }
        return true
      }
      conversations = conversations.slice(0, -1)
    }
  } catch {
    return false
  }
}
