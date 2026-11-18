import type {
  FeedbackContext,
  FeedbackKind,
} from "@matchbox/contracts/feedback"
import { useSyncExternalStore } from "react"
import { collectContext, withoutAddress } from "./context"
import type { FeedbackOptions, FeedbackWallet } from "./entry"
import {
  type FeedbackEvent,
  type FeedbackState,
  feedbackReducer,
  initialState,
} from "./machine"
import { pageBlocksCapture } from "./screenshot"

/**
 * One feedback session per page: the panel's open state, what it was
 * opened with, the context read at that moment, and the draft. Kept
 * outside React so the draft outlives the sheet closing.
 */

export type Session = {
  open: boolean
  options: FeedbackOptions | null
  context: FeedbackContext | null
  wallet: FeedbackWallet | null
  /** Why screenshots are not offered right now (one line), or null. */
  screenshotBlocked: string | null
  state: FeedbackState
}

const initialSession: Session = {
  open: false,
  options: null,
  context: null,
  wallet: null,
  screenshotBlocked: null,
  state: initialState,
}

let session = initialSession
/** Where focus goes back to when the panel closes: the entry pressed. */
let returnFocus: HTMLElement | null = null
const listeners = new Set<() => void>()

function publish(next: Session): void {
  session = next
  for (const listener of listeners) listener()
}

export function getSession(): Session {
  return session
}

export function subscribeSession(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useSession(): Session {
  return useSyncExternalStore(subscribeSession, getSession, getSession)
}

export function dispatch(event: FeedbackEvent): void {
  publish({ ...session, state: feedbackReducer(session.state, event) })
}

function walletOf(options: FeedbackOptions): FeedbackWallet | null {
  try {
    const wallet = options.wallet?.() ?? null
    return wallet !== null && /^0x[0-9a-fA-F]{40}$/.test(wallet.address)
      ? wallet
      : null
  } catch {
    return null
  }
}

function blockedReason(options: FeedbackOptions): string | null {
  try {
    return options.screenshotBlocked?.() ?? pageBlocksCapture(document)
  } catch {
    return pageBlocksCapture(document)
  }
}

/** Opens the panel, reading the page's context now. */
export function openPanel(
  options: FeedbackOptions & { kind?: FeedbackKind },
): void {
  if (!session.open) {
    const active = document.activeElement
    returnFocus =
      active instanceof HTMLElement && active !== document.body ? active : null
  }
  const wallet = walletOf(options)
  const state = feedbackReducer(session.state, {
    type: "open",
    kind: options.kind ?? null,
  })
  const blocked = blockedReason(options)
  const context = collectContext({
    surface: options.surface,
    chainId: wallet?.chainId ?? null,
  })
  publish({
    open: true,
    options,
    wallet,
    screenshotBlocked: blocked,
    context:
      wallet === null || context.route === null
        ? context
        : { ...context, route: withoutAddress(context.route, wallet.address) },
    state: {
      ...state,
      // A screenshot taken before this screen blocked them is dropped.
      draft:
        blocked !== null && state.draft.shot.status !== "none"
          ? { ...state.draft, shot: { status: "none" } }
          : state.draft,
    },
  })
}

/** Closes the sheet. A sent report is cleared; anything else is kept. */
export function closePanel(): void {
  publish({
    ...session,
    open: false,
    state: session.state.phase.name === "sent" ? initialState : session.state,
  })
}

/** The element focused before the panel opened, once. */
export function takeReturnFocus(): HTMLElement | null {
  const target = returnFocus
  returnFocus = null
  return target?.isConnected === true ? target : null
}

/** For tests. */
export function resetSession(): void {
  publish(initialSession)
}
