import { beforeEach, describe, expect, it } from "vitest"
import {
  getWatching,
  parseWatching,
  resetWatching,
  toggled,
  toggleWatching,
  watchLimit,
  watchStorageKey,
} from "./watch-store"

const a = `0x${"a".repeat(40)}`
const b = `0x${"b".repeat(40)}`

describe("the stored watchlist", () => {
  it("is empty for anything that is not a list of addresses", () => {
    for (const raw of [null, "", "{", "{}", '"x"', "[1, null]"]) {
      expect(parseWatching(raw)).toEqual([])
    }
  })

  it("keeps valid addresses once, lower case, up to the cap", () => {
    expect(
      parseWatching(
        JSON.stringify([a.toUpperCase().replace("0X", "0x"), a, "0x12", b]),
      ),
    ).toEqual([a, b])
    const many = Array.from(
      { length: watchLimit + 20 },
      (_, index) => `0x${index.toString(16).padStart(40, "0")}`,
    )
    expect(parseWatching(JSON.stringify(many))).toHaveLength(watchLimit)
  })

  it("adds newest first and removes on a second toggle", () => {
    expect(toggled([], a)).toEqual([a])
    expect(toggled([a], b)).toEqual([b, a])
    expect(toggled([b, a], a.toUpperCase().replace("0X", "0x"))).toEqual([b])
    expect(toggled([a], "not an address")).toEqual([a])
  })
})

describe("watching on this device", () => {
  beforeEach(() => {
    window.localStorage.clear()
    resetWatching()
  })

  it("remembers a starred gauge across loads", () => {
    expect(getWatching()).toEqual([])
    toggleWatching(a)
    expect(getWatching()).toEqual([a])
    expect(window.localStorage.getItem(watchStorageKey)).toBe(
      JSON.stringify([a]),
    )
    resetWatching()
    expect(getWatching()).toEqual([a])
    toggleWatching(a)
    resetWatching()
    expect(getWatching()).toEqual([])
  })
})
