import { describe, expect, it } from "vitest"
import type { StuartRequest } from "./contract"
import { fixtureTurn } from "./fixtures"
import {
  loadThread,
  MAX_CONVERSATIONS,
  type StorageLike,
  saveThread,
  storageKey,
  walletKey,
} from "./persistence"
import type { Conversation, ThreadState } from "./thread"

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value)
    },
    removeItem: (key) => {
      data.delete(key)
    },
  }
}

const throwing: StorageLike = {
  getItem: () => {
    throw new Error("SecurityError")
  },
  setItem: () => {
    throw new Error("QuotaExceededError")
  },
  removeItem: () => {
    throw new Error("SecurityError")
  },
}

const request: StuartRequest = {
  version: 1,
  query: "Which gauges pay best?",
  sessionId: "6f1c1b8e-3c55-4a3f-9b8a-1d2e3f4a5b6c",
  turn: 0,
  surface: "composer",
  chainId: 31_612,
}

function conversation(index: number): Conversation {
  const hex = index.toString(16).padStart(12, "0")
  return {
    id: `6f1c1b8e-3c55-4a3f-9b8a-${hex}`,
    title: `Question ${index}`,
    createdAt: `2026-11-0${(index % 8) + 1}T10:00:00.000Z`,
    updatedAt: `2026-11-08T10:${String(index).padStart(2, "0")}:00.000Z`,
    turns: [
      {
        id: `t${index}`,
        question: `Question ${index}`,
        entity: null,
        askedAt: "2026-11-08T10:00:00.000Z",
        status: ["Read 34 gauges"],
        outcome: {
          kind: "answered",
          response: fixtureTurn(request).response,
          cached: false,
        },
      },
    ],
  }
}

describe("persistence", () => {
  it("keys by lower-case address or anonymous", () => {
    expect(walletKey("0x7C21095156AB25E989C3C084BCB06037C6539E0B")).toBe(
      "0x7c21095156ab25e989c3c084bcb06037c6539e0b",
    )
    expect(walletKey(null)).toBe("anonymous")
  })

  it("round-trips a thread and settles a streaming turn as stopped", () => {
    const storage = memoryStorage()
    const first = conversation(1)
    const streaming: Conversation = {
      ...conversation(2),
      turns: [
        {
          id: "live",
          question: "Still going",
          entity: { type: "gauge", id: "0x1", label: "Kiln Labs" },
          askedAt: "2026-11-08T10:00:00.000Z",
          status: [],
          outcome: { kind: "streaming" },
        },
      ],
    }
    const state: ThreadState = {
      conversations: [first, streaming],
      activeId: first.id,
    }
    expect(saveThread(storage, "anonymous", state)).toBe(true)
    const loaded = loadThread(storage, "anonymous")
    expect(loaded.activeId).toBe(first.id)
    expect(loaded.conversations).toHaveLength(2)
    const live = loaded.conversations.find((item) => item.id === streaming.id)
    expect(live?.turns[0]?.outcome.kind).toBe("stopped")
  })

  it("survives storage that throws on every call", () => {
    expect(loadThread(throwing, "anonymous")).toEqual({
      conversations: [],
      activeId: null,
    })
    expect(
      saveThread(throwing, "anonymous", {
        conversations: [conversation(1)],
        activeId: null,
      }),
    ).toBe(false)
    expect(loadThread(null, "anonymous").conversations).toEqual([])
  })

  it("ignores corrupt or foreign data", () => {
    const storage = memoryStorage()
    storage.setItem(storageKey("anonymous"), "{not json")
    expect(loadThread(storage, "anonymous").conversations).toEqual([])
    storage.setItem(
      storageKey("anonymous"),
      JSON.stringify({
        version: 1,
        activeId: null,
        conversations: [{ id: 1 }],
      }),
    )
    expect(loadThread(storage, "anonymous").conversations).toEqual([])
  })

  it("caps the number of conversations, newest first", () => {
    const storage = memoryStorage()
    const many = Array.from({ length: MAX_CONVERSATIONS + 5 }, (_, index) =>
      conversation(index),
    )
    saveThread(storage, "anonymous", { conversations: many, activeId: null })
    const loaded = loadThread(storage, "anonymous")
    expect(loaded.conversations).toHaveLength(MAX_CONVERSATIONS)
    expect(loaded.conversations[0]?.title).toBe(
      `Question ${MAX_CONVERSATIONS + 4}`,
    )
  })

  it("keeps wallets apart", () => {
    const storage = memoryStorage()
    saveThread(storage, "0xabc", {
      conversations: [conversation(1)],
      activeId: null,
    })
    expect(loadThread(storage, "anonymous").conversations).toEqual([])
    expect(loadThread(storage, "0xabc").conversations).toHaveLength(1)
  })
})
