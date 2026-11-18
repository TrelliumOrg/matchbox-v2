import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { connectedFlag } from "../wallet/wallet-store"
import {
  classicNoteArrivalScript,
  dismissNote,
  getNote,
  noteEntered,
  noteKeys,
  noteWalletConnected,
  readNote,
  resetNote,
} from "./note-store"

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

describe("readNote", () => {
  const arrived = { [noteKeys.visit]: "show" }

  it("is off without a homepage arrival in this tab", () => {
    expect(readNote({ session: memory(), local: memory() })).toEqual({
      phase: "off",
      entered: false,
    })
    expect(readNote({ session: null, local: null }).phase).toBe("off")
  })

  it("shows for the visit, at rest once it has entered", () => {
    expect(readNote({ session: memory(arrived), local: memory() })).toEqual({
      phase: "showing",
      entered: false,
    })
    expect(
      readNote({
        session: memory({ [noteKeys.visit]: "shown" }),
        local: memory(),
      }),
    ).toEqual({ phase: "showing", entered: true })
  })

  it("never shows again after a dismissal or a wallet connection", () => {
    for (const key of [noteKeys.dismissed, noteKeys.used]) {
      expect(
        readNote({
          session: memory(arrived),
          local: memory({ [key]: "2026-11-12" }),
        }).phase,
      ).toBe("off")
    }
  })

  it("counts a wallet this browser remembers as used, for good", () => {
    const local = memory({ [connectedFlag]: "1" })
    expect(readNote({ session: memory(arrived), local }).phase).toBe("off")
    expect(local.map.get(noteKeys.used)).toBe("1")
  })

  it("does not throw when storage is blocked", () => {
    expect(readNote({ session: blocked, local: blocked }).phase).toBe("off")
    // Arrived, but the device's memory cannot be read: it may show again.
    expect(readNote({ session: memory(arrived), local: blocked }).phase).toBe(
      "showing",
    )
  })
})

describe("the note for this tab", () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    window.localStorage.clear()
    resetNote()
  })
  afterEach(resetNote)

  it("enters once, then is dismissed for good with the date", () => {
    window.sessionStorage.setItem(noteKeys.visit, "show")
    resetNote()
    expect(getNote()).toEqual({ phase: "showing", entered: false })
    noteEntered()
    expect(getNote()).toEqual({ phase: "showing", entered: true })
    expect(window.sessionStorage.getItem(noteKeys.visit)).toBe("shown")
    dismissNote("2026-11-12")
    expect(getNote().phase).toBe("dismissed")
    expect(window.localStorage.getItem(noteKeys.dismissed)).toBe("2026-11-12")
    // A reload, or a later arrival from the homepage: nothing.
    window.sessionStorage.setItem(noteKeys.visit, "show")
    resetNote()
    expect(getNote().phase).toBe("off")
  })

  it("leaves when a wallet connects and skips later arrivals", () => {
    window.sessionStorage.setItem(noteKeys.visit, "show")
    resetNote()
    noteWalletConnected()
    expect(getNote().phase).toBe("used")
    resetNote()
    expect(getNote().phase).toBe("off")
  })

  it("remembers a connection made while the note was not up", () => {
    noteWalletConnected()
    expect(getNote().phase).toBe("off")
    expect(window.localStorage.getItem(noteKeys.used)).toBe("1")
    window.sessionStorage.setItem(noteKeys.visit, "show")
    resetNote()
    expect(getNote().phase).toBe("off")
  })

  it("ignores a dismissal when nothing is showing", () => {
    dismissNote("2026-11-12")
    expect(window.localStorage.getItem(noteKeys.dismissed)).toBeNull()
  })
})

describe("classicNoteArrivalScript", () => {
  function arrive(url: string): string {
    window.history.replaceState(null, "", url)
    new Function(classicNoteArrivalScript)()
    return `${window.location.pathname}${window.location.search}${window.location.hash}`
  }

  beforeEach(() => {
    window.sessionStorage.clear()
  })
  afterEach(() => {
    window.history.replaceState(null, "", "/")
  })

  it("marks the visit and takes from=home out of the address", () => {
    expect(arrive("/?from=home")).toBe("/")
    expect(window.sessionStorage.getItem(noteKeys.visit)).toBe("show")
  })

  it("keeps the rest of the address as it was", () => {
    expect(arrive("/vote?from=home&sort=apy#top")).toBe("/vote?sort=apy#top")
    expect(arrive("/pyke.mezo/rewards?a=1&from=home")).toBe(
      "/pyke.mezo/rewards?a=1",
    )
  })

  it("leaves every other visit alone", () => {
    for (const url of [
      "/",
      "/vote?sort=apy",
      "/?from=docs",
      "/?from=homepage",
    ]) {
      expect(arrive(url)).toBe(url)
    }
    expect(window.sessionStorage.getItem(noteKeys.visit)).toBeNull()
  })

  it("does not replay the entrance on a second arrival in the same tab", () => {
    window.sessionStorage.setItem(noteKeys.visit, "shown")
    expect(arrive("/?from=home")).toBe("/")
    expect(window.sessionStorage.getItem(noteKeys.visit)).toBe("shown")
  })

  it("stays small enough to inline", () => {
    expect(classicNoteArrivalScript.length).toBeLessThan(400)
  })
})
