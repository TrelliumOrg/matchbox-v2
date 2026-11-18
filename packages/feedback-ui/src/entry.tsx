import type {
  FeedbackKind,
  FeedbackSurface,
} from "@matchbox/contracts/feedback"
import type { ReactNode } from "react"
import { feedbackEndpoint } from "./csp"

export { feedbackEndpoint }

/**
 * The Feedback entry: the one piece of the widget a page loads up front, a
 * plain button and a dynamic import. The panel, Turnstile and the
 * screenshot library load on first intent (hover, focus or touch) and on
 * first use. Without an endpoint (a build without VITE_FEEDBACK_URL) the
 * entry renders nothing.
 */

export type FeedbackWallet = { address: string; chainId: number | null }

export type FeedbackOptions = {
  /** The matchbox-feedback Worker's origin. */
  endpoint: string
  surface: FeedbackSurface
  /** Read when the panel opens: the connected wallet, or null. */
  wallet?: () => FeedbackWallet | null
  /**
   * Read when the panel opens: why screenshots are not offered right now
   * (one line, such as "A signing review is open"), or null.
   */
  screenshotBlocked?: () => string | null
}

let host: Promise<typeof import("./host")> | null = null

/** Starts loading the panel. Safe to call on every hover. */
export function preloadFeedback(): Promise<typeof import("./host")> {
  host ??= import("./host").catch((error: unknown) => {
    host = null
    throw error
  })
  return host
}

/** Opens the panel; `kind` "bug" is for Report a problem entries. */
export function openFeedback(
  options: FeedbackOptions & { kind?: FeedbackKind },
): void {
  preloadFeedback().then(
    (module) => module.showFeedback(options),
    () => undefined,
  )
}

export type FeedbackEntryProps = Omit<FeedbackOptions, "endpoint"> & {
  /** The raw build-time value, such as import.meta.env.VITE_FEEDBACK_URL. */
  endpoint: unknown
  kind?: FeedbackKind
  className?: string
  "aria-label"?: string
  /** Runs before the panel opens, e.g. to close a popover menu. */
  onOpen?: () => void
  children: ReactNode
}

/** The message icon the frames draw beside the word Feedback. */
export function FeedbackIcon({
  size = 20,
  strokeWidth = 1.7,
}: {
  size?: number
  strokeWidth?: number
}): ReactNode {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flex: "none" }}
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  )
}

function preload(): void {
  preloadFeedback().catch(() => undefined)
}

export function FeedbackEntry({
  endpoint,
  kind,
  className,
  children,
  "aria-label": ariaLabel,
  onOpen,
  ...options
}: FeedbackEntryProps): ReactNode {
  const origin = feedbackEndpoint(endpoint)
  if (origin === null) return null
  return (
    <button
      type="button"
      data-tap=""
      aria-haspopup="dialog"
      aria-label={ariaLabel}
      className={className}
      onPointerEnter={preload}
      onFocus={preload}
      onTouchStart={preload}
      onClick={() => {
        onOpen?.()
        openFeedback({
          ...options,
          endpoint: origin,
          ...(kind === undefined ? {} : { kind }),
        })
      }}
    >
      {children}
    </button>
  )
}

FeedbackEntry.displayName = "FeedbackEntry"
