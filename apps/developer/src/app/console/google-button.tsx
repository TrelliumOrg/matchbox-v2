import type {
  GoogleNoncePurpose,
  GoogleNonceResponse,
} from "@matchbox/contracts/console"
import { useTheme } from "@matchbox/ui/theme"
import {
  type ReactElement,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"

import { errorMessage } from "../lib/api-error"
import { isEmbeddedBrowser } from "../lib/embedded-browser"
import { type GoogleButtonText, renderGoogleButton } from "../lib/google"
import { EmbeddedBrowserNotice } from "./embedded-browser-notice"

/** Nonces live 10 minutes; refresh before the button goes stale. */
const nonceRefreshMs = 9 * 60_000

/**
 * One nonce request per purpose at a time: an effect that re-runs while a
 * request is in flight (StrictMode, theme change) reuses its nonce.
 */
const pendingNonces = new Map<
  GoogleNoncePurpose,
  Promise<GoogleNonceResponse>
>()

function requestNonce(
  purpose: GoogleNoncePurpose,
): Promise<GoogleNonceResponse> {
  const pending = pendingNonces.get(purpose)
  if (pending !== undefined) return pending
  const request = import("../lib/api")
    .then((api) => api.auth.googleNonce(purpose))
    .finally(() => {
      pendingNonces.delete(purpose)
    })
  pendingNonces.set(purpose, request)
  return request
}

export type GoogleButtonProps = {
  purpose: GoogleNoncePurpose
  text?: GoogleButtonText
  /** Receives the ID token; a rejection re-arms the button with a new nonce. */
  onCredential: (credential: string) => Promise<void>
  /** Reports load and verification errors to the parent. */
  onError: (message: string | null) => void
}

function subscribeNothing(): () => void {
  return () => undefined
}

/**
 * The GIS button, or inside an app's built-in browser (a wallet's, where
 * Google refuses to sign in) a note to open the page in the phone's own
 * browser. The server renders the button's placeholder either way.
 */
export default function GoogleButton(props: GoogleButtonProps): ReactElement {
  const embedded = useSyncExternalStore(
    subscribeNothing,
    () => isEmbeddedBrowser(navigator.userAgent),
    () => false,
  )
  if (embedded) return <EmbeddedBrowserNotice />
  return <GisButton {...props} />
}

/**
 * The GIS button. Each render asks the Worker for a nonce bound to this
 * browser and purpose, so every credential is tied to both. Timers stall in
 * background tabs and during sleep, so the button also re-arms when the page
 * comes back after the nonce has gone stale.
 */
function GisButton({
  purpose,
  text = "continue_with",
  onCredential,
  onError,
}: GoogleButtonProps): ReactElement {
  const container = useRef<HTMLDivElement>(null)
  const { mode } = useTheme()
  const [attempt, setAttempt] = useState(0)
  const [status, setStatus] = useState<"loading" | "ready" | "failed">(
    "loading",
  )
  const handlers = useRef({ onCredential, onError })
  handlers.current = { onCredential, onError }

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` re-arms the button with a new nonce
  useEffect(() => {
    // Hydration renders this first everywhere: no nonce for a webview.
    if (isEmbeddedBrowser(navigator.userAgent)) return
    let active = true
    const armedAt = Date.now()
    setStatus("loading")
    async function arm(): Promise<void> {
      try {
        const { clientId, nonce } = await requestNonce(purpose)
        const parent = container.current
        if (!active || parent === null) return
        await renderGoogleButton(parent, {
          clientId,
          nonce,
          purpose,
          text,
          dark: mode === "dark",
          onCredential(credential) {
            handlers.current.onError(null)
            handlers.current.onCredential(credential).catch((error) => {
              handlers.current.onError(errorMessage(error))
              if (active) setAttempt((value) => value + 1)
            })
          },
        })
        if (active) setStatus("ready")
      } catch (error) {
        if (!active) return
        setStatus("failed")
        handlers.current.onError(errorMessage(error))
      }
    }
    void arm()
    const rearm = () => setAttempt((value) => value + 1)
    const refresh = window.setTimeout(rearm, nonceRefreshMs)
    function rearmIfStale(): void {
      if (
        document.visibilityState === "visible" &&
        Date.now() - armedAt >= nonceRefreshMs
      ) {
        rearm()
      }
    }
    document.addEventListener("visibilitychange", rearmIfStale)
    window.addEventListener("focus", rearmIfStale)
    window.addEventListener("pageshow", rearmIfStale)
    return () => {
      active = false
      window.clearTimeout(refresh)
      document.removeEventListener("visibilitychange", rearmIfStale)
      window.removeEventListener("focus", rearmIfStale)
      window.removeEventListener("pageshow", rearmIfStale)
    }
  }, [attempt, purpose, mode, text])

  return (
    <div className={status === "failed" ? "hidden" : "relative min-h-11"}>
      {status !== "loading" ? null : (
        <span
          aria-hidden="true"
          className="absolute inset-0 h-11 animate-pulse rounded-[22px] bg-skel motion-reduce:animate-none"
        />
      )}
      <div
        ref={container}
        className="flex min-h-11 w-full justify-center [color-scheme:normal]"
      />
    </div>
  )
}
