import { useSyncExternalStore } from "react"
import type { PublicQuestion } from "../data/schema"

/**
 * The published answers, loaded once and shared by every component that
 * shows them. Nothing loads them on first paint: the prerendered page and
 * hydration both render without them (the server snapshot is always
 * "not loaded"), and a reader's step or open starts the one request.
 */

type State = {
  questions: readonly PublicQuestion[] | null
  failed: boolean
}

const initial: State = { questions: null, failed: false }
let state: State = initial
let pending: Promise<readonly PublicQuestion[]> | null = null
const listeners = new Set<() => void>()

function set(next: State): void {
  state = next
  for (const listener of listeners) listener()
}

/** Loads the answers (once), and resolves with them. */
export function loadAnswers(): Promise<readonly PublicQuestion[]> {
  pending ??= import("../data/questions").then(
    (module) => {
      set({ questions: module.default, failed: false })
      return module.default
    },
    (error: unknown) => {
      // Let the next step or open try again.
      pending = null
      set({ questions: null, failed: true })
      throw error
    },
  )
  return pending
}

/** Starts loading on a sign the reader is about to ask (hover, focus). */
export function preloadAnswers(): void {
  loadAnswers().catch(() => undefined)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The answers once loaded, and whether the last load failed. */
export function useAnswers(): State {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => initial,
  )
}
