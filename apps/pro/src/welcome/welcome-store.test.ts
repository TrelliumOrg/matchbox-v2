import { describe, expect, it } from "vitest"
import { forced, readWelcome, welcomeKeys } from "./welcome-store"

function memory(entries: Record<string, string> = {}) {
  const map = new Map(Object.entries(entries))
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    map,
  }
}

const blocked = {
  getItem: () => {
    throw new Error("blocked")
  },
  setItem: () => {
    throw new Error("blocked")
  },
  removeItem: () => {
    throw new Error("blocked")
  },
}

/** Reads, but a write is dropped (some private modes). */
const readOnly = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
}

const first = { search: "", automated: false }

describe("readWelcome", () => {
  it("shows to a browser that has not seen it", () => {
    const local = memory()
    expect(readWelcome({ ...first, local })).toBe("showing")
    expect(local.map.size).toBe(0)
  })

  it("never shows again once it was closed", () => {
    const local = memory({ [welcomeKeys.seen]: "2026-11-13" })
    expect(readWelcome({ ...first, local })).toBe("off")
  })

  it("stays off when the close could not be remembered", () => {
    expect(readWelcome({ ...first, local: null })).toBe("off")
    expect(readWelcome({ ...first, local: blocked })).toBe("off")
    expect(readWelcome({ ...first, local: readOnly })).toBe("off")
  })

  it("stays off for an automated browser", () => {
    expect(readWelcome({ ...first, automated: true, local: memory() })).toBe(
      "off",
    )
  })

  it("shows on ?welcome=show whatever else is true", () => {
    const search = "?address=0x1&welcome=show"
    const seen = memory({ [welcomeKeys.seen]: "2026-11-13" })
    expect(readWelcome({ search, automated: false, local: seen })).toBe(
      "showing",
    )
    expect(readWelcome({ search, automated: true, local: null })).toBe(
      "showing",
    )
  })

  it("takes only welcome=show as the override", () => {
    expect(forced("?welcome=show")).toBe(true)
    expect(forced("?welcome=1")).toBe(false)
    expect(forced("?welcomes=show")).toBe(false)
    expect(forced("")).toBe(false)
  })
})
