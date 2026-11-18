import { useSyncExternalStore } from "react"
import type { CallStatus, Proposal } from "./contract"

/**
 * Stuart's shared UI state: one module-level store, so the launcher (first
 * paint), the lazily loaded panel and any page that wants an entry point
 * ("Ask Stuart" in Ctrl K, "Ask about this") talk without a provider. This
 * core is on first paint: React and contract types only, and only what the
 * launcher needs. Everything else lives in ./actions, which ships with the
 * panel or with the route that asks.
 */

export type StuartEntityType =
  | "gauge"
  | "lock"
  | "trove"
  | "vault"
  | "epoch"
  | "transaction"

/** What "Ask about this" pins as context. Label is display text. */
export type StuartEntity = {
  type: StuartEntityType
  id: string
  label: string
}

/** Hidden shows the launcher only. Phones render docked and expanded as a sheet. */
export type StuartView = "hidden" | "docked" | "expanded" | "minimized"

export type StuartSurface = "palette" | "composer" | "canvas"

export type StuartSignOutcome = "success" | "failed" | "partial" | "rejected"

export type StuartSignRequest = {
  proposal: Proposal
  /** Call with the wallet's per-call state as it changes. */
  onStatus: (status: CallStatus) => void
  /** Aborted when the person closes the card or asks something else. */
  signal: AbortSignal
}

export type StuartSignResult = {
  outcome: StuartSignOutcome
  hashes: string[]
}

/**
 * The host app signs. Stuart hands over a refreshed, unsigned proposal and
 * shows what the wallet reports; it never submits anything itself.
 */
export type StuartSigner = (
  request: StuartSignRequest,
) => Promise<StuartSignResult>

/** A question waiting for the panel to pick it up. */
export type StuartAsk = {
  id: number
  question: string | null
  entity: StuartEntity | null
  surface: StuartSurface
}

export type StuartState = {
  view: StuartView
  /** The open view to restore (docked or expanded). */
  lastOpen: "docked" | "expanded"
  /** The panel code was asked for: on intent or on first open. */
  wanted: boolean
  answering: boolean
  /** The latest status line while answering ("Reading 34 gauges"). */
  status: string | null
  /** The question being answered, for the minimized pill. */
  question: string | null
  ask: StuartAsk | null
  signer: StuartSigner | null
  /** The search sheet is open on a phone (the top bar's search icon). */
  searchOpen: boolean
}

const initial: StuartState = {
  view: "hidden",
  lastOpen: "docked",
  wanted: false,
  answering: false,
  status: null,
  question: null,
  ask: null,
  signer: null,
  searchOpen: false,
}

let state: StuartState = initial
const listeners = new Set<() => void>()

/** Internal: the actions module and the panel write through this. */
export function setStuartState(patch: Partial<StuartState>): void {
  state = { ...state, ...patch }
  for (const listener of listeners) listener()
}

export function getStuartState(): StuartState {
  return state
}

export function subscribeStuart(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getServerState(): StuartState {
  return initial
}

/** The store as React state. The server always sees it hidden. */
export function useStuart(): StuartState {
  return useSyncExternalStore(subscribeStuart, getStuartState, getServerState)
}

/** Starts loading the panel code without opening it (hover, focus, touch). */
export function warmStuart(): void {
  if (!state.wanted) setStuartState({ wanted: true })
}

/** Phones: the top bar's search icon opens the sheet; Escape closes it. */
export function openStuartSearch(): void {
  setStuartState({ searchOpen: true, wanted: true })
}

export function closeStuartSearch(): void {
  if (state.searchOpen) setStuartState({ searchOpen: false })
}

export function openStuart(view?: "docked" | "expanded"): void {
  const next = view ?? state.lastOpen
  setStuartState({ view: next, lastOpen: next, wanted: true })
}

export function closeStuart(): void {
  setStuartState({ view: "hidden" })
}

export function toggleStuart(): void {
  if (state.view === "docked" || state.view === "expanded") closeStuart()
  else openStuart()
}

/** Test helper: back to the first state. */
export function resetStuart(): void {
  state = initial
  for (const listener of listeners) listener()
}
