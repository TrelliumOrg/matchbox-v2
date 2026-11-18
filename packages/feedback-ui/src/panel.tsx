import {
  describeFeedbackBrowser,
  type FeedbackKind,
  type FeedbackReportRequest,
  feedbackLimits,
  feedbackSurfaceNames,
} from "@matchbox/contracts/feedback"
import { Dialog } from "radix-ui"
import {
  type ChangeEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from "react"
import { fetchSiteKey, sendReport } from "./client"
import { shortAddress } from "./context"
import { Icon, type IconName } from "./icons"
import { useKeyboardInset } from "./keyboard-inset"
import {
  canSend,
  type FeedbackState,
  messageCounter,
  messageLabel,
  messagePlaceholder,
  minutesLeft,
  type Notice,
  type Shot,
  sendLabel,
} from "./machine"
import { attachedImage, captureViewport } from "./screenshot"
import {
  closePanel,
  dispatch,
  type Session,
  takeReturnFocus,
  useSession,
} from "./store"
import { loadTurnstile, type TurnstileApi } from "./turnstile"
import "./panel.css"

/**
 * The feedback panel (Doop frames nnlk0iw-Z_, jrYjuwcexl, KwA7iaJZr0): a
 * 480 sheet from the right on desktop, a bottom sheet above the keyboard
 * on phones. Radix Dialog gives the focus trap, Escape and the return of
 * focus to the entry. Every colour is a token from @matchbox/tokens.
 */

const kinds: ReadonlyArray<{
  kind: FeedbackKind
  label: string
  icon: IconName
}> = [
  { kind: "bug", label: "Bug", icon: "bug" },
  { kind: "idea", label: "Idea", icon: "bulb" },
  { kind: "other", label: "Other", icon: "message" },
]

const fetchFn: typeof globalThis.fetch = (input, init) =>
  globalThis.fetch(input, init)

const siteKeys = new Map<string, Promise<string | null>>()

function siteKeyFor(endpoint: string): Promise<string | null> {
  const known = siteKeys.get(endpoint)
  if (known !== undefined) return known
  const loading = fetchSiteKey(endpoint, fetchFn).then((key) => {
    if (key === null) siteKeys.delete(endpoint)
    return key
  })
  siteKeys.set(endpoint, loading)
  return loading
}

type Waiting = RefObject<Array<(token: string | null) => void>>

/** Answers every send waiting for a token. */
function settle(waiting: Waiting, token: string | null): void {
  const resolvers = waiting.current
  waiting.current = []
  for (const resolve of resolvers) resolve(token)
}

type TurnstileHandle = {
  container: RefObject<HTMLDivElement | null>
  interactive: boolean
  token: () => Promise<string | null>
  reset: () => void
}

/** Renders Turnstile into the panel and hands out one token per send. */
function useTurnstile(
  siteKey: string | null,
  theme: "light" | "dark",
): TurnstileHandle {
  const container = useRef<HTMLDivElement | null>(null)
  const widget = useRef<{ api: TurnstileApi; id: string } | null>(null)
  const current = useRef<string | null>(null)
  const waiting = useRef<Array<(token: string | null) => void>>([])
  const [interactive, setInteractive] = useState(false)

  useEffect(() => {
    if (siteKey === null) return
    let cancelled = false
    loadTurnstile().then(
      (api) => {
        if (cancelled || container.current === null) return
        const id = api.render(container.current, {
          sitekey: siteKey,
          action: "feedback",
          theme,
          appearance: "interaction-only",
          size: "flexible",
          "refresh-expired": "auto",
          "response-field": false,
          callback: (token) => {
            current.current = token
            settle(waiting, token)
          },
          "error-callback": () => settle(waiting, null),
          "expired-callback": () => {
            current.current = null
          },
          "before-interactive-callback": () => setInteractive(true),
          "after-interactive-callback": () => setInteractive(false),
        })
        widget.current = { api, id }
      },
      () => settle(waiting, null),
    )
    return () => {
      cancelled = true
      const rendered = widget.current
      widget.current = null
      current.current = null
      settle(waiting, null)
      if (rendered !== null) {
        try {
          rendered.api.remove(rendered.id)
        } catch {
          // Already gone with the panel.
        }
      }
    }
  }, [siteKey, theme])

  return {
    container,
    interactive,
    token: () => {
      if (siteKey === null) return Promise.resolve(null)
      const ready = current.current
      if (ready !== null) {
        current.current = null
        return Promise.resolve(ready)
      }
      return new Promise((resolve) => {
        waiting.current.push(resolve)
        setTimeout(() => resolve(null), 90_000)
      })
    },
    reset: () => {
      current.current = null
      const rendered = widget.current
      if (rendered === null) return
      try {
        rendered.api.reset(rendered.id)
      } catch {
        // The panel closed while sending.
      }
    },
  }
}

function NoticeBanner({
  notice,
  now,
}: {
  notice: Notice
  now: number
}): ReactNode {
  if (notice.kind === "rate-limited") {
    if (now >= notice.until) return null
    return (
      <div role="alert" className="fb-banner fb-banner-wait">
        <Icon name="clock" />
        <p>
          <strong>Too many reports</strong>
          You can send again in {minutesLeft(notice.until, now)} min.
        </p>
      </div>
    )
  }
  return (
    <div role="alert" className="fb-banner fb-banner-neg">
      <Icon name="alert" />
      {notice.kind === "failed" ? (
        <p>
          <strong>Could not send</strong>
          Your report is kept. Check your connection and try again.
        </p>
      ) : (
        <p>
          <strong>Check did not pass</strong>
          Try the check again.
        </p>
      )}
    </div>
  )
}

function ShotSlot({
  shot,
  blocked,
  locked,
  onTake,
  onRemove,
}: {
  shot: Shot
  blocked: string | null
  locked: boolean
  onTake: () => void
  onRemove: () => void
}): ReactNode {
  if (blocked !== null) {
    return (
      <div className="fb-slot">
        <span className="fb-slot-icon">
          <Icon name="lock" />
        </span>
        <p className="fb-slot-text">
          <strong>No screenshots on this screen</strong>
          <span>{blocked}</span>
        </p>
      </div>
    )
  }
  switch (shot.status) {
    case "none":
      return (
        <div className="fb-slot">
          <button
            type="button"
            className="fb-pill"
            data-tap=""
            disabled={locked}
            onClick={onTake}
          >
            <Icon name="camera" size={18} />
            Take screenshot
          </button>
          <p className="fb-slot-text">
            <span>Stays on this device until you send</span>
          </p>
        </div>
      )
    case "capturing":
      return (
        <div className="fb-slot" role="status">
          <span className="fb-spinner" aria-hidden="true" />
          <p className="fb-slot-text">
            <strong>Taking screenshot</strong>
            <span>Stays on this device until you send</span>
          </p>
        </div>
      )
    case "failed":
      return (
        <div className="fb-slot" role="alert">
          <span className="fb-slot-icon">
            <Icon name="cameraOff" />
          </span>
          <p className="fb-slot-text">
            <strong>Screenshot not taken</strong>
            <span>This page could not be drawn</span>
          </p>
          <button
            type="button"
            className="fb-link fb-slot-action"
            data-tap=""
            disabled={locked}
            onClick={onTake}
          >
            Try again
          </button>
        </div>
      )
    case "ready": {
      const kilobytes = Math.max(1, Math.round(shot.blob.size / 1024))
      const detail =
        shot.masked === null
          ? `Attached image, ${kilobytes} KB`
          : shot.masked === 0
            ? "No typed fields on this page"
            : shot.masked === 1
              ? "1 typed field hidden"
              : `${shot.masked} typed fields hidden`
      return (
        <div className="fb-shot">
          <img
            className="fb-thumb"
            src={shot.preview}
            alt={
              shot.masked === null
                ? "Attached image"
                : "Screenshot of this page"
            }
          />
          <div className="fb-shot-side">
            <p className="fb-shot-detail">
              {shot.masked !== null && <Icon name="eyeOff" size={16} />}
              {detail}
            </p>
            <button
              type="button"
              className="fb-link fb-link-quiet"
              data-tap=""
              disabled={locked}
              onClick={onRemove}
            >
              Remove
            </button>
          </div>
        </div>
      )
    }
  }
}

function ContextRow({
  icon,
  label,
  children,
  onRemove,
  removeLabel,
}: {
  icon: IconName
  label: string
  children: ReactNode
  onRemove?: () => void
  removeLabel?: string
}): ReactNode {
  return (
    <div className="fb-row">
      <dt>
        <Icon name={icon} size={16} />
        {label}
      </dt>
      <dd>{children}</dd>
      {onRemove === undefined ? (
        <span className="fb-row-spacer" />
      ) : (
        <button
          type="button"
          className="fb-row-remove"
          data-tap=""
          aria-label={removeLabel}
          onClick={onRemove}
        >
          <Icon name="x" size={15} />
        </button>
      )}
    </div>
  )
}

function SentWith({
  session,
  locked,
}: {
  session: Session
  locked: boolean
}): ReactNode {
  const [showAgent, setShowAgent] = useState(false)
  const agentId = useId()
  const { context, wallet } = session
  const { draft } = session.state
  if (context === null) return null
  const product = feedbackSurfaceNames[context.surface]
  return (
    <dl className="fb-context">
      {draft.includePage && context.route !== null && (
        <ContextRow
          icon="globe"
          label="Page"
          removeLabel="Remove page"
          {...(locked
            ? {}
            : { onRemove: () => dispatch({ type: "remove-page" }) })}
        >
          {window.location.host}
          {context.route}
        </ContextRow>
      )}
      <ContextRow icon="app" label="App">
        {context.build === null
          ? product
          : `${product}, build ${context.build}`}
      </ContextRow>
      <ContextRow icon="monitor" label="Screen">
        {context.viewport.width} x {context.viewport.height},{" "}
        {context.theme.mode} theme
      </ContextRow>
      <ContextRow icon="compass" label="Browser">
        <button
          type="button"
          className="fb-expand"
          aria-expanded={showAgent}
          aria-controls={agentId}
          onClick={() => setShowAgent((shown) => !shown)}
        >
          {describeFeedbackBrowser(context.userAgent, context.walletBrowser)}
          <Icon name="chevron" size={15} />
        </button>
        <span id={agentId} className="fb-agent" hidden={!showAgent}>
          {context.userAgent}
        </span>
      </ContextRow>
      {context.chainId !== null && (
        <ContextRow icon="link" label="Chain">
          {context.chainId}
        </ContextRow>
      )}
      {wallet !== null && draft.includeWallet && (
        <ContextRow
          icon="wallet"
          label="Wallet"
          removeLabel="Remove wallet address"
          {...(locked
            ? {}
            : {
                onRemove: () =>
                  dispatch({ type: "set-include-wallet", value: false }),
              })}
        >
          <span className="fb-mono">{shortAddress(wallet.address)}</span>
        </ContextRow>
      )}
    </dl>
  )
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(timer)
  }, [active])
  return active ? now : Date.now()
}

function ReportForm({
  session,
  container,
}: {
  session: Session
  container: HTMLElement
}): ReactNode {
  const { state, options, context, wallet } = session
  const { draft, phase } = state
  const locked = phase.name === "sending"
  const notice = phase.name === "editing" ? phase.notice : null
  const now = useNow(notice?.kind === "rate-limited")
  const [siteKey, setSiteKey] = useState<string | null>(null)
  const [attachRefused, setAttachRefused] = useState(false)
  const theme = context?.theme.mode ?? "light"
  const turnstile = useTurnstile(siteKey, theme)
  const counter = messageCounter(draft.message)
  const ids = {
    message: useId(),
    counter: useId(),
    attach: useId(),
    contact: useId(),
    sentWith: useId(),
  }

  useEffect(() => {
    if (options === null) return
    let cancelled = false
    siteKeyFor(options.endpoint).then((key) => {
      if (!cancelled) setSiteKey(key)
    })
    return () => {
      cancelled = true
    }
  }, [options])

  async function takeScreenshot(): Promise<void> {
    dispatch({ type: "capture-started" })
    setAttachRefused(false)
    try {
      const capture = await captureViewport(container)
      dispatch({
        type: "capture-finished",
        shot: { status: "ready", ...capture },
      })
    } catch {
      dispatch({ type: "capture-failed" })
    }
  }

  async function attach(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const input = event.currentTarget
    const file = input.files?.[0]
    input.value = ""
    if (file === undefined) return
    const image = await attachedImage(file).catch(() => null)
    setAttachRefused(image === null)
    if (image !== null) {
      dispatch({
        type: "capture-finished",
        shot: { status: "ready", ...image, masked: null },
      })
    }
  }

  async function send(current: FeedbackState): Promise<void> {
    if (options === null || context === null) return
    const started = Date.now()
    if (!canSend(current, started)) return
    dispatch({ type: "send", now: started })
    const token = await turnstile.token()
    if (token === null) {
      dispatch({
        type: "send-finished",
        outcome:
          siteKey === null ? { result: "failed" } : { result: "check-failed" },
        now: Date.now(),
      })
      turnstile.reset()
      return
    }
    const { draft: sent } = current
    const contact = sent.contact.trim()
    const report: FeedbackReportRequest = {
      kind: sent.kind,
      message: sent.message.trim(),
      context: { ...context, route: sent.includePage ? context.route : null },
      wallet: sent.includeWallet && wallet !== null ? wallet.address : null,
      contact: contact === "" ? null : contact,
      screenshot: sent.shot.status === "ready",
      turnstileToken: token,
    }
    const outcome = await sendReport({
      endpoint: options.endpoint,
      report,
      screenshot: sent.shot.status === "ready" ? sent.shot.blob : null,
      fetch: fetchFn,
    })
    turnstile.reset()
    dispatch({ type: "send-finished", outcome, now: Date.now() })
  }

  return (
    <form
      className="fb-form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        void send(state)
      }}
    >
      <div className="fb-header">
        <Dialog.Title className="fb-title">Send feedback</Dialog.Title>
        <Dialog.Close className="fb-close" aria-label="Close">
          <Icon name="x" />
        </Dialog.Close>
      </div>
      <div className="fb-body">
        {notice !== null && <NoticeBanner notice={notice} now={now} />}
        <fieldset className="fb-lock" disabled={locked}>
          <ol className="fb-fields">
            <li>
              <fieldset className="fb-kinds">
                <legend className="fb-sr">Type</legend>
                {kinds.map((item) => (
                  <label
                    key={item.kind}
                    className="fb-kind"
                    data-checked={draft.kind === item.kind ? "" : undefined}
                  >
                    <input
                      type="radio"
                      name="fb-kind"
                      className="fb-sr"
                      value={item.kind}
                      checked={draft.kind === item.kind}
                      onChange={() =>
                        dispatch({ type: "set-kind", kind: item.kind })
                      }
                    />
                    <Icon name={item.icon} size={18} />
                    {item.label}
                  </label>
                ))}
              </fieldset>
            </li>
            <li className="fb-field">
              <label htmlFor={ids.message} className="fb-field-label">
                {messageLabel(draft.kind)}
              </label>
              <textarea
                id={ids.message}
                className="fb-textarea"
                data-feedback-autofocus=""
                rows={3}
                required
                minLength={feedbackLimits.messageMin}
                maxLength={feedbackLimits.messageMax}
                placeholder={messagePlaceholder(draft.kind)}
                aria-describedby={counter === null ? undefined : ids.counter}
                value={draft.message}
                onChange={(event) =>
                  dispatch({
                    type: "set-message",
                    message: event.currentTarget.value,
                  })
                }
              />
              {counter !== null && (
                <span id={ids.counter} className="fb-counter">
                  {counter}
                </span>
              )}
            </li>
            <li>
              <fieldset className="fb-section">
                <legend className="fb-section-title">Screenshot</legend>
                {session.screenshotBlocked === null && (
                  <span className="fb-attach">
                    <input
                      id={ids.attach}
                      type="file"
                      className="fb-sr"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={(event) => void attach(event)}
                    />
                    <label htmlFor={ids.attach} className="fb-link" data-tap="">
                      <Icon name="imagePlus" size={16} />
                      Attach an image
                    </label>
                  </span>
                )}
                <ShotSlot
                  shot={draft.shot}
                  blocked={session.screenshotBlocked}
                  locked={locked}
                  onTake={() => void takeScreenshot()}
                  onRemove={() => dispatch({ type: "remove-shot" })}
                />
                {attachRefused && (
                  <p role="alert" className="fb-hint">
                    PNG, JPEG or WebP, up to 5 MB
                  </p>
                )}
              </fieldset>
            </li>
            <li>
              <section className="fb-section" aria-labelledby={ids.sentWith}>
                <h3 id={ids.sentWith} className="fb-section-title">
                  Sent with this report
                </h3>
                <SentWith session={session} locked={locked} />
              </section>
            </li>
            {wallet !== null && (
              <li>
                <label className="fb-check">
                  <input
                    type="checkbox"
                    className="fb-sr"
                    checked={draft.includeWallet}
                    onChange={(event) =>
                      dispatch({
                        type: "set-include-wallet",
                        value: event.currentTarget.checked,
                      })
                    }
                  />
                  <span className="fb-box" aria-hidden="true">
                    <Icon name="check" size={15} strokeWidth={2.5} />
                  </span>
                  Include my wallet address
                  <span className="fb-mono fb-check-address">
                    {shortAddress(wallet.address)}
                  </span>
                </label>
              </li>
            )}
            <li>
              {draft.contactOpen ? (
                <div className="fb-field">
                  <label htmlFor={ids.contact} className="fb-field-label">
                    How can we reach you? Optional
                  </label>
                  <input
                    id={ids.contact}
                    type="text"
                    className="fb-input"
                    autoComplete="off"
                    maxLength={feedbackLimits.contactMax}
                    placeholder="Email, Discord or Telegram"
                    value={draft.contact}
                    onChange={(event) =>
                      dispatch({
                        type: "set-contact",
                        contact: event.currentTarget.value,
                      })
                    }
                  />
                </div>
              ) : (
                <button
                  type="button"
                  className="fb-link"
                  data-tap=""
                  onClick={() => dispatch({ type: "open-contact" })}
                >
                  Add how to reach you
                </button>
              )}
            </li>
          </ol>
        </fieldset>
        <p className="fb-note">
          Only what is listed here is sent. Screenshots are deleted after 90
          days. The Matchbox team reads reports in its own tools.
        </p>
        <div
          className="fb-check-slot"
          data-shown={turnstile.interactive ? "" : undefined}
        >
          {turnstile.interactive && (
            <p className="fb-section-title fb-check-title">
              <Icon name="shield" size={16} />
              One check before sending
            </p>
          )}
          <div ref={turnstile.container} />
        </div>
      </div>
      <div className="fb-footer">
        <button
          type="submit"
          className="fb-send"
          aria-disabled={!canSend(state, now)}
          disabled={locked}
        >
          {locked && (
            <span className="fb-spinner fb-spinner-on-acc" aria-hidden="true" />
          )}
          {sendLabel(state, now)}
        </button>
      </div>
    </form>
  )
}

function SentView({ reference }: { reference: string }): ReactNode {
  const [copied, setCopied] = useState(false)
  const canCopy =
    typeof navigator !== "undefined" &&
    typeof navigator.clipboard?.writeText === "function"
  return (
    <div className="fb-form">
      <div className="fb-header fb-header-end">
        <Dialog.Close className="fb-close" aria-label="Close">
          <Icon name="x" />
        </Dialog.Close>
      </div>
      <div className="fb-body fb-sent">
        <span className="fb-sent-icon">
          <Icon name="check" size={28} strokeWidth={2.25} />
        </span>
        <Dialog.Title className="fb-sent-title">Report sent</Dialog.Title>
        <div className="fb-ref">
          <p>
            <span className="fb-ref-label">Reference</span>
            <span className="fb-ref-code">{reference}</span>
          </p>
          {canCopy && (
            <button
              type="button"
              className="fb-copy"
              onClick={() => {
                navigator.clipboard.writeText(reference).then(
                  () => setCopied(true),
                  () => setCopied(false),
                )
              }}
            >
              <Icon name={copied ? "check" : "copy"} size={16} />
              {copied ? "Copied" : "Copy"}
            </button>
          )}
        </div>
        <p className="fb-sent-hint">Quote it if you contact us about this.</p>
      </div>
      <div className="fb-footer">
        <Dialog.Close className="fb-send">Done</Dialog.Close>
      </div>
    </div>
  )
}

export function FeedbackPanel({
  container,
}: {
  container: HTMLElement
}): ReactNode {
  const session = useSession()
  const sheet = useRef<HTMLDivElement | null>(null)
  useKeyboardInset(sheet, session.open)
  const { phase } = session.state
  return (
    <Dialog.Root
      open={session.open}
      onOpenChange={(open) => {
        if (!open) closePanel()
      }}
    >
      <Dialog.Portal container={container}>
        <Dialog.Overlay className="fb-scrim" />
        <Dialog.Content
          ref={sheet}
          className="fb-sheet"
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            // Radix returns focus to a Dialog.Trigger; the entry lives in
            // the host's tree instead, so it is focused here.
            const target = takeReturnFocus()
            if (target !== null) {
              event.preventDefault()
              target.focus()
            }
          }}
          onOpenAutoFocus={(event) => {
            const field = sheet.current?.querySelector<HTMLElement>(
              "[data-feedback-autofocus]",
            )
            if (field !== null && field !== undefined) {
              event.preventDefault()
              field.focus()
            }
          }}
        >
          <span className="fb-grab" aria-hidden="true" />
          {phase.name === "sent" ? (
            <SentView reference={phase.reference} />
          ) : (
            <ReportForm session={session} container={container} />
          )}
          <p className="fb-sr" role="status">
            {phase.name === "sending"
              ? "Sending"
              : phase.name === "sent"
                ? "Report sent"
                : ""}
          </p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
