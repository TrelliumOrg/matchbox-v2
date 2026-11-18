import { useSyncExternalStore } from "react"
import { connectedFlag } from "../wallet/wallet-store"

/**
 * The way back to Matchbox Classic, offered to visitors who arrive from the
 * homepage (Doop page "Pro, Classic banner", notes frame `bUZzLubGKg`).
 *
 * The homepage's links to Pro end in `?from=home`. `classicNoteArrivalScript`
 * runs in <head> before first paint: it marks this tab's visit and takes
 * the mark out of the address, so nothing shared or bookmarked carries it.
 * The note then shows on every Pro page of the visit until it is dismissed
 * or a wallet connects. Both are remembered on this device for good.
 *
 * Device only, every storage access in try/catch: with storage blocked the
 * note can show once more, which is acceptable. Tiny and dependency free,
 * because the shell reads it on first paint.
 */

export const classicUrl = "https://app.matchbox.markets"

export const noteKeys = {
  /** sessionStorage: "show" on arrival, "shown" once the note has entered. */
  visit: "mbx.classicNote",
  /** localStorage: the date it was dismissed. Never show again. */
  dismissed: "mbx.classicNote.dismissed",
  /** localStorage: set when a wallet connects in Pro. Never show again. */
  used: "mbx.classicNote.used",
} as const

/**
 * Inline in <head>. ES5, no dependencies. Only `from=home` is taken out:
 * any other query stays as it was. It keeps "shown", so a second arrival in
 * the same tab does not replay the entrance.
 */
export const classicNoteArrivalScript = `(function(){try{var u=new URL(location.href);if(u.searchParams.get("from")!=="home")return;u.searchParams.delete("from");history.replaceState(history.state,"",u.pathname+u.search+u.hash);var s=window.sessionStorage;if(s.getItem("${noteKeys.visit}")===null)s.setItem("${noteKeys.visit}","show")}catch(e){}})()`

export type NoteSnapshot = {
  /**
   * "off": nothing to show. "showing": the note is up. "dismissed" and
   * "used": it was up in this page and is leaving, by its close button or
   * because a wallet connected; they pick the exit.
   */
  phase: "off" | "showing" | "dismissed" | "used"
  /** The entrance already played in this visit: appear without it. */
  entered: boolean
}

const off: NoteSnapshot = { phase: "off", entered: false }

type Stores = {
  session: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null
  local: Pick<Storage, "getItem" | "setItem"> | null
}

function get(store: Pick<Storage, "getItem"> | null, key: string) {
  try {
    return store?.getItem(key) ?? null
  } catch {
    return null
  }
}

function set(
  store: Pick<Storage, "setItem"> | null,
  key: string,
  value: string,
): void {
  try {
    store?.setItem(key, value)
  } catch {
    // Blocked or full: the note may show once more.
  }
}

/** What the stores say on load. A remembered wallet counts as used. */
export function readNote(stores: Stores): NoteSnapshot {
  const visit = get(stores.session, noteKeys.visit)
  if (visit !== "show" && visit !== "shown") return off
  if (get(stores.local, noteKeys.dismissed) !== null) return off
  if (get(stores.local, noteKeys.used) !== null) return off
  if (get(stores.local, connectedFlag) !== null) {
    // A wallet that reconnects on load: the note never appears.
    set(stores.local, noteKeys.used, "1")
    return off
  }
  return { phase: "showing", entered: visit === "shown" }
}

function browserStores(): Stores {
  const store = (name: "sessionStorage" | "localStorage") => {
    try {
      return typeof window === "undefined" ? null : window[name]
    } catch {
      return null
    }
  }
  return { session: store("sessionStorage"), local: store("localStorage") }
}

let snapshot: NoteSnapshot | null = null
const listeners = new Set<() => void>()

function publish(next: NoteSnapshot): void {
  snapshot = next
  for (const listener of listeners) listener()
}

export function getNote(): NoteSnapshot {
  snapshot ??= readNote(browserStores())
  return snapshot
}

export function subscribeNote(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Off on the server and during hydration; the stores are read after it. */
export function useClassicNote(): NoteSnapshot {
  return useSyncExternalStore(subscribeNote, getNote, () => off)
}

/** The entrance has played: later pages and reloads show the note at rest. */
export function noteEntered(): void {
  const current = getNote()
  if (current.phase !== "showing" || current.entered) return
  set(browserStores().session, noteKeys.visit, "shown")
  publish({ phase: "showing", entered: true })
}

/** The close button. `today` is the local date, for example "2026-11-12". */
export function dismissNote(today: string): void {
  if (getNote().phase !== "showing") return
  set(browserStores().local, noteKeys.dismissed, today)
  publish({ phase: "dismissed", entered: true })
}

/**
 * A wallet connected: connecting is the first real choice to use Pro, so
 * the note goes and later homepage arrivals skip it too. Recorded even when
 * the note is not up, since any connection counts.
 */
export function noteWalletConnected(): void {
  // Read before writing: the write is what turns a fresh read off.
  const showing = getNote().phase === "showing"
  set(browserStores().local, noteKeys.used, "1")
  if (showing) publish({ phase: "used", entered: true })
}

/** For tests: forget the cached snapshot so the stores are read again. */
export function resetNote(): void {
  snapshot = null
  for (const listener of listeners) listener()
}
