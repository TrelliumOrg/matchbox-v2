import {
  type CspOptions,
  walletConnectFonts,
  walletConnectFrames,
  walletConnectSources,
} from "@matchbox/app-kit/security"
import { feedbackCspSources } from "@matchbox/feedback-ui/csp"
import { cspReportPath } from "./csp-report.server"
import { safeTxServiceOrigin, safeWebOrigin } from "./safe/urls"

/**
 * Pro's Content Security Policy, built from what its pages load. The
 * headers and the nonce come from @matchbox/app-kit/security, as on
 * Matchscan; only the sources differ.
 */

export type ProCspInputs = {
  /** The page's URL: the live head socket is this origin's /live/heads. */
  url: URL
  /** The RPC the wallet reads through (`walletRpcUrl()`). */
  rpcUrl: string
  /** VITE_STUART_URL as built: the Stuart Worker, or "" for none. */
  stuartUrl: unknown
  /** VITE_FEEDBACK_URL as built; the widget is hidden without it. */
  feedbackUrl: unknown
  reportOnly: boolean
}

/**
 * Pro runs inside Safe{Wallet} as a Safe App, so safe.mezo.org may frame
 * it. No other site may.
 */
export const proFrameAncestors = `'self' ${safeWebOrigin}`

/**
 * The Network setting's custom RPC is any URL the person saves (any https
 * host, or a node on this machine, see `isRpcUrl`), and reads go to it
 * straight from the page. 'https:' lets those through; plain http is
 * limited to this machine, which browsers allow from an https page. There
 * is no [::1]: browsers ignore IPv6 addresses in a policy, with a console
 * warning, so the setting refuses them instead.
 */
export const customRpcSources: readonly string[] = [
  "https:",
  "http://localhost:*",
  "http://*.localhost:*",
  "http://127.0.0.1:*",
]

function originOf(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null
  try {
    return new URL(value.trim()).origin
  } catch {
    return null
  }
}

/**
 * What pages reach beyond 'self': the wallet's RPC, the block head socket
 * (named too, since older WebKit does not let 'self' cover wss:), the
 * WalletConnect relay and connection screen (the set Matchscan and Matchbox
 * ID allow), the Safe Transaction Service (multisig proposals), Stuart and
 * the feedback Worker. Token icons and gauge pictures come from many https
 * hosts (Blockscout's lists, the gauge profiles' storage); blob: is the
 * WalletConnect screen's wallet icons and QR code. Frames: WalletConnect's
 * verify frame and Turnstile. WalletConnect's screen keeps its web fonts
 * (Matchscan and Matchbox ID block them): fonts run no code, and blocked
 * they log a violation on every open.
 */
export function proCspOptions(inputs: ProCspInputs): CspOptions {
  const feedback = feedbackCspSources(inputs.feedbackUrl)
  const socket = `${inputs.url.protocol === "https:" ? "wss:" : "ws:"}//${inputs.url.host}`
  const named = [
    originOf(inputs.rpcUrl),
    socket,
    ...walletConnectSources,
    safeTxServiceOrigin,
    originOf(inputs.stuartUrl),
    ...feedback.connect,
    ...customRpcSources,
  ].filter((source): source is string => source !== null)
  return {
    connect: [...new Set(named)],
    images: ["https:", "blob:"],
    frames: [...walletConnectFrames, ...feedback.frames],
    fonts: walletConnectFonts,
    frameAncestors: proFrameAncestors,
    reportOnly: inputs.reportOnly,
    // Report-only mode says what it would have blocked (csp-report.server).
    ...(inputs.reportOnly ? { reportPath: cspReportPath } : {}),
  }
}
