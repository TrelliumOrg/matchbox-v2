import { useSyncExternalStore } from "react"

/**
 * The welcome dialog (Doop frames `mbpWkkU-8d`, `jBvVnutsJi`, phone
 * `51CXh8BRUY`): three steps that introduce the new Matchbox Pro, Matchscan
 * and Matchbox ID with Developer.
 *
 * When it shows: once per browser, on the first Pro page that browser
 * opens, whichever page that is. Closing it any way (the X, Escape, the
 * scrim, Get started, or leaving for Classic) is remembered on this device
 * and it never shows again.
 *
 * When it does not:
 * - storage cannot be read or written (private modes that block it): with
 *   nothing to remember the close in, it would come back on every page;
 * - the browser is driven by automation (`navigator.webdriver`: tests,
 *   Lighthouse, crawlers that render), so measurements see the page itself.
 *
 * `?welcome=show` in the address shows it regardless, and is taken out of
 * the address by the dialog. For previews, tests and screenshots.
 *
 * Tiny and dependency free: the shell reads it on every first paint. The
 * dialog's own code loads only when this says to show it.
 */

export const welcomeKeys = {
  /** localStorage: the local date it was closed. Never show again. */
  seen: "mbx.welcome.seen",
} as const

/** The query that forces the dialog: `?welcome=show`. */
export const welcomeParam = "welcome"

export type WelcomeSnapshot = "off" | "showing"

export type WelcomeInput = {
  /** Null when storage is blocked. */
  local: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null
  /** `location.search`. */
  search: string
  /** `navigator.webdriver`. */
  automated: boolean
}

const probeKey = "mbx.welcome.probe"

/** Whether a close could be remembered: a write that reads back. */
function writable(local: NonNullable<WelcomeInput["local"]>): boolean {
  try {
    local.setItem(probeKey, "1")
    const kept = local.getItem(probeKey) === "1"
    local.removeItem(probeKey)
    return kept
  } catch {
    return false
  }
}

export function forced(search: string): boolean {
  try {
    return new URLSearchParams(search).get(welcomeParam) === "show"
  } catch {
    return false
  }
}

/** What to do on load. */
export function readWelcome(input: WelcomeInput): WelcomeSnapshot {
  if (forced(input.search)) return "showing"
  if (input.automated || input.local === null) return "off"
  try {
    if (input.local.getItem(welcomeKeys.seen) !== null) return "off"
  } catch {
    return "off"
  }
  return writable(input.local) ? "showing" : "off"
}

function browserInput(): WelcomeInput {
  let local: WelcomeInput["local"] = null
  try {
    local = window.localStorage
  } catch {
    local = null
  }
  return {
    local,
    search: window.location.search,
    automated: window.navigator.webdriver === true,
  }
}

let snapshot: WelcomeSnapshot | null = null
const listeners = new Set<() => void>()

function getWelcome(): WelcomeSnapshot {
  snapshot ??= readWelcome(browserInput())
  return snapshot
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const serverSnapshot = (): WelcomeSnapshot => "off"

/** Off on the server and during hydration; storage is read after it. */
export function useWelcome(): WelcomeSnapshot {
  return useSyncExternalStore(subscribe, getWelcome, serverSnapshot)
}

/** Closed, by any route. `today` is the local date, "2026-11-13". */
export function closeWelcome(today: string): void {
  try {
    window.localStorage.setItem(welcomeKeys.seen, today)
  } catch {
    // Blocked since load: it was shown once, and that is all.
  }
  snapshot = "off"
  for (const listener of listeners) listener()
}

/** For tests: forget what this module read. */
export function resetWelcomeForTests(): void {
  snapshot = null
}
