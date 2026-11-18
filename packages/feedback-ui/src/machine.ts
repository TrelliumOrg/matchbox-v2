import { type FeedbackKind, feedbackLimits } from "@matchbox/contracts/feedback"

/**
 * The panel's state, as a pure reducer (Doop frame jrYjuwcexl, "Panel
 * states"). The draft survives closing the sheet: a report that could not
 * be sent, or was closed while sending, is still there on the next open.
 */

export type ReadyShot = {
  status: "ready"
  blob: Blob
  /** A data: URL for the thumbnail (no blob: URLs, for strict CSPs). */
  preview: string
  /** Typed fields blacked out in a capture; null for an attached file. */
  masked: number | null
}

export type Shot =
  | { status: "none" }
  | { status: "capturing" }
  | ReadyShot
  | { status: "failed" }

export type Notice =
  | { kind: "failed" }
  | { kind: "rate-limited"; until: number }
  | { kind: "check-failed" }

export type Phase =
  | { name: "editing"; notice: Notice | null }
  | { name: "sending" }
  | { name: "sent"; reference: string }

export type Draft = {
  kind: FeedbackKind
  message: string
  includePage: boolean
  includeWallet: boolean
  contactOpen: boolean
  contact: string
  shot: Shot
}

export type FeedbackState = { phase: Phase; draft: Draft }

export type SendOutcome =
  | { result: "sent"; reference: string }
  | { result: "rate-limited"; retryAfterSeconds: number }
  | { result: "check-failed" }
  | { result: "failed" }

export type FeedbackEvent =
  | { type: "open"; kind: FeedbackKind | null }
  | { type: "set-kind"; kind: FeedbackKind }
  | { type: "set-message"; message: string }
  | { type: "remove-page" }
  | { type: "set-include-wallet"; value: boolean }
  | { type: "open-contact" }
  | { type: "set-contact"; contact: string }
  | { type: "capture-started" }
  | { type: "capture-finished"; shot: ReadyShot }
  | { type: "capture-failed" }
  | { type: "remove-shot" }
  | { type: "send"; now: number }
  | { type: "send-finished"; outcome: SendOutcome; now: number }
  | { type: "reset" }

export const emptyDraft: Draft = {
  kind: "bug",
  message: "",
  includePage: true,
  includeWallet: false,
  contactOpen: false,
  contact: "",
  shot: { status: "none" },
}

export const initialState: FeedbackState = {
  phase: { name: "editing", notice: null },
  draft: emptyDraft,
}

function withDraft(state: FeedbackState, draft: Partial<Draft>): FeedbackState {
  return { ...state, draft: { ...state.draft, ...draft } }
}

export function feedbackReducer(
  state: FeedbackState,
  event: FeedbackEvent,
): FeedbackState {
  const { phase } = state
  if (event.type === "reset") return initialState
  if (phase.name === "sent") {
    // A finished report starts over when the panel opens again.
    return event.type === "open"
      ? { ...initialState, draft: { ...emptyDraft, kind: event.kind ?? "bug" } }
      : state
  }
  if (phase.name === "sending") {
    // Fields lock while sending; closing the sheet does not cancel it.
    if (event.type !== "send-finished") return state
    switch (event.outcome.result) {
      case "sent":
        return {
          phase: { name: "sent", reference: event.outcome.reference },
          draft: emptyDraft,
        }
      case "rate-limited":
        return {
          ...state,
          phase: {
            name: "editing",
            notice: {
              kind: "rate-limited",
              until: event.now + event.outcome.retryAfterSeconds * 1000,
            },
          },
        }
      case "check-failed":
        return {
          ...state,
          phase: { name: "editing", notice: { kind: "check-failed" } },
        }
      case "failed":
        return {
          ...state,
          phase: { name: "editing", notice: { kind: "failed" } },
        }
    }
  }
  switch (event.type) {
    case "open":
      // "Report a problem" always opens on Bug; the plain entry keeps the
      // draft's type.
      return event.kind === null
        ? state
        : withDraft(state, { kind: event.kind })
    case "set-kind":
      return withDraft(state, { kind: event.kind })
    case "set-message":
      return withDraft(state, {
        message: event.message.slice(0, feedbackLimits.messageMax),
      })
    case "remove-page":
      return withDraft(state, { includePage: false })
    case "set-include-wallet":
      return withDraft(state, { includeWallet: event.value })
    case "open-contact":
      return withDraft(state, { contactOpen: true })
    case "set-contact":
      return withDraft(state, {
        contact: event.contact.slice(0, feedbackLimits.contactMax),
      })
    case "capture-started":
      return withDraft(state, { shot: { status: "capturing" } })
    case "capture-finished":
      // A capture finished after the user removed it, or attached a file
      // instead, is dropped.
      return state.draft.shot.status === "capturing" ||
        event.shot.masked === null
        ? withDraft(state, { shot: event.shot })
        : state
    case "capture-failed":
      return state.draft.shot.status === "capturing"
        ? withDraft(state, { shot: { status: "failed" } })
        : state
    case "remove-shot":
      return withDraft(state, { shot: { status: "none" } })
    case "send":
      return canSend(state, event.now)
        ? { ...state, phase: { name: "sending" } }
        : state
    case "send-finished":
      return state
  }
}

/** Minutes until a rate limit lifts, rounded up; 0 once it has. */
export function minutesLeft(until: number, now: number): number {
  return Math.max(0, Math.ceil((until - now) / 60_000))
}

function rateLimited(phase: Phase, now: number): boolean {
  return (
    phase.name === "editing" &&
    phase.notice?.kind === "rate-limited" &&
    now < phase.notice.until
  )
}

export function canSend(state: FeedbackState, now: number): boolean {
  const message = state.draft.message.trim()
  return (
    state.phase.name === "editing" &&
    message.length >= feedbackLimits.messageMin &&
    message.length <= feedbackLimits.messageMax &&
    state.draft.shot.status !== "capturing" &&
    !rateLimited(state.phase, now)
  )
}

export function sendLabel(state: FeedbackState, now: number): string {
  const { phase } = state
  if (phase.name === "sending") return "Sending"
  if (phase.name === "editing" && phase.notice !== null) {
    if (phase.notice.kind === "rate-limited" && now < phase.notice.until) {
      return `Send report in ${minutesLeft(phase.notice.until, now)} min`
    }
    if (phase.notice.kind === "failed") return "Try again"
  }
  return "Send report"
}

const kindCopy: Record<FeedbackKind, { label: string; placeholder: string }> = {
  bug: {
    label: "What went wrong?",
    placeholder: "What did you expect, and what happened?",
  },
  idea: {
    label: "What would help?",
    placeholder: "What would make this better?",
  },
  other: {
    label: "Message",
    placeholder: "Anything you want the team to know",
  },
}

export function messageLabel(kind: FeedbackKind): string {
  return kindCopy[kind].label
}

export function messagePlaceholder(kind: FeedbackKind): string {
  return kindCopy[kind].placeholder
}

const counterFrom = 1_500

/** "1,503 of 2,000", shown once the message passes 1,500 characters. */
export function messageCounter(message: string): string | null {
  if (message.length < counterFrom) return null
  const format = new Intl.NumberFormat("en-US")
  return `${format.format(message.length)} of ${format.format(feedbackLimits.messageMax)}`
}
