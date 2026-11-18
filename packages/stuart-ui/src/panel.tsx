import "./panel.css"
import { fireHaptic, MorphText, SkeletonProvider } from "@matchbox/motion"
import { isDarkPreset } from "@matchbox/tokens"
import * as Avatar from "@matchbox/ui/avatar"
import {
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import {
  dockStuart,
  expandStuart,
  minimizeStuart,
  takeStuartAsk,
} from "./actions"
import { TurnView } from "./answer"
import { type StuartTransport, transportFor } from "./client"
import {
  type AskOptions,
  HostProvider,
  type PanelHost,
  type PanelSigning,
  type PanelWallet,
} from "./host"
import { Glyph, type GlyphName } from "./icons"
import { useKeyboardInset } from "./keyboard-inset"
import { barId, barInputId } from "./launcher"
import { StuartBadge } from "./mark"
import { pastedValue } from "./paste"
import type { StorageLike } from "./persistence"
import { usePresence } from "./presence"
import { useStuartSession } from "./session"
import { closeStuart, openStuart, type StuartEntity, useStuart } from "./store"
import type { Conversation } from "./thread"

/**
 * Stuart's panel (frames -ricVEQRbo docked, DAICnrdo-X expanded, Ahoa9R3Oq1
 * minimized, 41yLhKsfh5 answers, Y66kM_aGtl and D0l2AMBZla on phones).
 * Docked it is a non-modal dialog above the Ctrl K bar's right end: no
 * scrim, no focus trap, the page stays usable. It grows out of the bar and
 * collapses back into it; exits mirror entries. On phones it is a modal
 * bottom sheet that opens at half height and drags to full. It stays
 * mounted while hidden so an answer keeps streaming behind the bar.
 */

export type StuartPanelProps = {
  /** The Stuart Worker's origin. Null or empty plays the Epoch 47 fixtures. */
  endpoint: string | null
  wallet: PanelWallet | null
  /** The current route, sent as page context. */
  route: string
  /** Client navigation for entity links ("/gauges/0x…", "/vote"). */
  navigate: (to: string) => void
  /** The href for an in-app path (keeps the host's search params). */
  hrefFor?: (to: string) => string
  /** Three questions for the empty state. */
  suggestions?: readonly string[]
  /** Matchscan origin for transaction links. */
  scanUrl?: string
  /** The host's Signing setting; Multisig leads with "Export for Safe". */
  signing?: PanelSigning
  /** Tests inject these. */
  transport?: StuartTransport
  storage?: StorageLike | null
}

export const panelId = "stuart-panel"

const walletSigning: PanelSigning = { mode: "wallet" }

const phoneQuery = "(max-width: 767.98px)"

function subscribePhone(onChange: () => void): () => void {
  if (typeof window === "undefined" || window.matchMedia === undefined) {
    return () => {}
  }
  const media = window.matchMedia(phoneQuery)
  media.addEventListener("change", onChange)
  return () => media.removeEventListener("change", onChange)
}

function isPhoneNow(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia !== undefined &&
    window.matchMedia(phoneQuery).matches
  )
}

function useIsPhone(): boolean {
  return useSyncExternalStore(subscribePhone, isPhoneNow, () => false)
}

function focusBar(): void {
  requestAnimationFrame(() => document.getElementById(barInputId)?.focus())
}

const useClientLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect

/** Where the docked panel sits: above the bar, right edges aligned. */
type Anchor = { right: number; bottom: number; origin: string }

const dockedWidth = 400
const dockGap = 12

function measureAnchor(): Anchor | null {
  const bar = document.getElementById(barId)
  if (bar === null) return null
  const rect = bar.getBoundingClientRect()
  if (rect.width === 0) return null
  const width = Math.min(dockedWidth, window.innerWidth - 32)
  const right = Math.max(16, window.innerWidth - rect.right)
  const left = window.innerWidth - right - width
  const centre = rect.left + rect.width / 2 - left
  return {
    right,
    bottom: window.innerHeight - rect.top + dockGap,
    origin: `${Math.round(Math.min(width, Math.max(0, centre)))}px calc(100% + ${dockGap + Math.round(rect.height / 2)}px)`,
  }
}

function themeMode(): "light" | "dark" {
  const painted = document.documentElement.getAttribute("data-theme")
  return isDarkPreset(painted) ? "dark" : "light"
}

function defaultSuggestions(wallet: PanelWallet | null): readonly string[] {
  return wallet === null
    ? [
        "Which gauges pay the most per vote?",
        "Which gauges have most consistently had rewards?",
        "How does boost work?",
      ]
    : [
        "Claim all my rewards",
        "Which gauges pay best for my votes?",
        "When do my locks unlock?",
      ]
}

function IconButton({
  label,
  icon,
  onClick,
  pressed,
}: {
  label: string
  icon: GlyphName
  onClick: () => void
  pressed?: boolean
}): ReactNode {
  return (
    <button
      type="button"
      className="stuart-icon-button"
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
    >
      <Glyph name={icon} size={18} />
    </button>
  )
}

function dayGroup(
  updatedAt: string,
  now: Date,
): "Today" | "This week" | "Earlier" {
  const then = new Date(updatedAt)
  if (Number.isNaN(then.getTime())) return "Earlier"
  if (then.toDateString() === now.toDateString()) return "Today"
  return now.getTime() - then.getTime() < 7 * 86_400_000
    ? "This week"
    : "Earlier"
}

function HistoryList({
  conversations,
  activeId,
  onSelect,
  onNew,
}: {
  conversations: readonly Conversation[]
  activeId: string | null
  onSelect: (id: string) => void
  onNew: () => void
}): ReactNode {
  const groups = useMemo(() => {
    const now = new Date()
    const order = ["Today", "This week", "Earlier"] as const
    return order
      .map((label) => ({
        label,
        items: conversations.filter(
          (conversation) => dayGroup(conversation.updatedAt, now) === label,
        ),
      }))
      .filter((group) => group.items.length > 0)
  }, [conversations])
  return (
    <nav className="stuart-history" aria-label="Conversations">
      <button type="button" className="stuart-new-chat" onClick={onNew}>
        <Glyph name="square-pen" size={18} />
        New chat
      </button>
      {groups.map((group) => (
        <section key={group.label} aria-label={group.label}>
          <h3 className="stuart-history-label">{group.label}</h3>
          <ul>
            {group.items.map((conversation) => (
              <li key={conversation.id}>
                <button
                  type="button"
                  className="stuart-history-item"
                  aria-current={
                    conversation.id === activeId ? "true" : undefined
                  }
                  onClick={() => onSelect(conversation.id)}
                >
                  {conversation.title}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </nav>
  )
}

function EmptyState({
  suggestions,
  onAsk,
}: {
  suggestions: readonly string[]
  onAsk: (question: string) => void
}): ReactNode {
  return (
    <div className="stuart-empty">
      <StuartBadge size={52} className="stuart-empty-mark" />
      <ul className="stuart-rows" aria-label="Suggested questions">
        {suggestions.slice(0, 3).map((question) => (
          <li key={question}>
            <button
              type="button"
              className="stuart-row"
              onClick={() => onAsk(question)}
            >
              <span className="stuart-row-text">{question}</span>
              <Glyph name="arrow-right" size={16} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ContextChip({
  entity,
  onRemove,
}: {
  entity: StuartEntity
  onRemove: () => void
}): ReactNode {
  const hue = useMemo(() => {
    let sum = 0
    for (const char of entity.id) sum = (sum + char.charCodeAt(0)) % 360
    return sum
  }, [entity.id])
  return (
    <p className="stuart-context">
      <Avatar.Root
        initials={entity.label.slice(0, 2).toUpperCase()}
        hue={hue}
        size={24}
      />
      <span className="stuart-context-label">
        <span className="stuart-sr">Using </span>
        {entity.label}
      </span>
      <button
        type="button"
        className="stuart-icon-button"
        aria-label={`Remove ${entity.label}`}
        onClick={onRemove}
      >
        <Glyph name="x" size={16} />
      </button>
    </p>
  )
}

function Composer({
  placeholder,
  answering,
  onAsk,
  onStop,
  inputRef,
}: {
  placeholder: string
  answering: boolean
  onAsk: (question: string) => void
  onStop: () => void
  inputRef: (node: HTMLInputElement | null) => void
}): ReactNode {
  const [text, setText] = useState("")
  const empty = text.trim() === ""
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (empty || answering) return
    onAsk(text)
    setText("")
  }
  return (
    <form className="stuart-composer" onSubmit={submit}>
      <label htmlFor="stuart-input" className="stuart-sr">
        {placeholder}
      </label>
      <span className="stuart-field">
        <input
          ref={inputRef}
          id="stuart-input"
          type="text"
          autoComplete="off"
          enterKeyHint="send"
          maxLength={2_000}
          placeholder={placeholder}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onPaste={(event) => {
            const next = pastedValue({
              value: text,
              pasted: event.clipboardData.getData("text"),
              start: event.currentTarget.selectionStart,
              end: event.currentTarget.selectionEnd,
              max: 2_000,
            })
            if (next === null) return
            event.preventDefault()
            setText(next)
          }}
        />
        {answering ? (
          <button
            type="button"
            className="stuart-send stuart-send-live"
            aria-label="Stop"
            onClick={onStop}
          >
            <Glyph name="stop" size={14} strokeWidth={2.4} />
          </button>
        ) : (
          <button
            type="submit"
            className={`stuart-send ${empty ? "" : "stuart-send-live"}`}
            aria-label="Send"
            aria-disabled={empty || undefined}
          >
            <Glyph name="arrow-up" size={18} strokeWidth={2.2} />
          </button>
        )}
      </span>
    </form>
  )
}

function MinimizedPill({
  question,
  status,
  answering,
  state,
}: {
  question: string
  status: string | null
  answering: boolean
  state: "open" | "closed"
}): ReactNode {
  return (
    <button
      type="button"
      className="stuart-pill"
      data-state={state}
      data-mbx-motion=""
      inert={state === "closed"}
      aria-label={`Open Stuart, ${question}`}
      onClick={() => openStuart()}
    >
      <span className="stuart-pill-ring" aria-hidden="true">
        {answering ? (
          <span className="stuart-spin" data-mbx-motion="" />
        ) : (
          <Glyph name="check" size={16} className="stuart-pos" />
        )}
      </span>
      <span className="stuart-pill-text">
        <span className="stuart-pill-title">{question}</span>
        <MorphText as="span" className="stuart-pill-status" aria-hidden="true">
          {answering ? (status ?? "Reading") : "Ready"}
        </MorphText>
      </span>
      <Glyph name="chevron-up" size={18} />
    </button>
  )
}

/** Tab cycles inside the sheet on phones (it is modal there). */
function trapFocus(event: KeyboardEvent<HTMLElement>): void {
  if (event.key !== "Tab") return
  const focusable = [
    ...event.currentTarget.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
    ),
  ]
  const first = focusable[0]
  const last = focusable.at(-1)
  if (first === undefined || last === undefined) return
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

export function StuartPanel({
  endpoint,
  wallet,
  route,
  navigate,
  hrefFor = (to) => to,
  suggestions,
  scanUrl = "https://scan.matchbox.markets",
  signing = walletSigning,
  transport,
  storage,
}: StuartPanelProps): ReactNode {
  const store = useStuart()
  const phone = useIsPhone()
  const chosenTransport = useMemo(
    () => transport ?? transportFor(endpoint),
    [transport, endpoint],
  )
  const session = useStuartSession({
    transport: chosenTransport,
    wallet,
    route,
    ...(storage === undefined ? {} : { storage }),
  })
  const [pinned, setPinned] = useState<StuartEntity | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [sheet, setSheet] = useState<"half" | "full">("half")
  const [drag, setDrag] = useState<number | null>(null)
  const dragStart = useRef<number | null>(null)
  const dragged = useRef(false)
  const input = useRef<HTMLInputElement | null>(null)
  const thread = useRef<HTMLDivElement | null>(null)
  const [announcement, setAnnouncement] = useState("")
  const view = store.view
  const open = view === "docked" || view === "expanded"
  const expanded = view === "expanded" && !phone
  const showHistoryList = historyOpen && !expanded
  const presence = usePresence(open, 220)
  const pillShown = view === "minimized" && store.question !== null
  const pill = usePresence(pillShown, 180)
  const pillQuestion = useRef<string | null>(null)
  if (pillShown) pillQuestion.current = store.question
  const layout = phone ? "sheet" : expanded ? "expanded" : "docked"
  // On a phone the composer is at the sheet's foot, where the keyboard is.
  useKeyboardInset(
    layout === "sheet" && view !== "hidden" && view !== "minimized",
  )
  const shownLayout = useRef(layout)
  if (open) shownLayout.current = layout
  const [anchor, setAnchor] = useState<Anchor | null>(null)

  useClientLayoutEffect(() => {
    if (!open || phone || expanded) return
    function measure(): void {
      setAnchor(measureAnchor())
    }
    measure()
    window.addEventListener("resize", measure)
    return () => window.removeEventListener("resize", measure)
  }, [open, phone, expanded])

  const { ask: sessionAsk } = session
  const ask = useCallback(
    (question: string, options?: AskOptions) => {
      sessionAsk({
        question,
        entity: pinned,
        surface: "composer",
        ...options,
      })
      setHistoryOpen(false)
    },
    [sessionAsk, pinned],
  )

  const pending = store.ask
  useEffect(() => {
    if (pending === null) return
    takeStuartAsk(pending.id)
    if (pending.entity !== null) setPinned(pending.entity)
    setHistoryOpen(false)
    if (pending.question !== null) {
      sessionAsk({
        question: pending.question,
        entity: pending.entity,
        surface: pending.surface,
      })
    } else {
      requestAnimationFrame(() => input.current?.focus())
    }
  }, [pending, sessionAsk])

  const wasOpen = useRef(false)
  useEffect(() => {
    if (open && !wasOpen.current) {
      setSheet("half")
      requestAnimationFrame(() => input.current?.focus())
    }
    wasOpen.current = open
  }, [open])

  useEffect(() => {
    const root = document.documentElement
    if (expanded) root.setAttribute("data-stuart-expanded", "")
    else root.removeAttribute("data-stuart-expanded")
    return () => {
      root.removeAttribute("data-stuart-expanded")
    }
  }, [expanded])

  const turns = session.conversation?.turns ?? []
  const last = turns.at(-1)
  const lastKey =
    last === undefined
      ? ""
      : `${last.id}:${last.outcome.kind}:${last.status.length}`
  const lastOutcome = last?.outcome
  useEffect(() => {
    if (lastOutcome === undefined) return
    if (lastOutcome.kind === "answered") {
      setAnnouncement(lastOutcome.response.answer.text)
    } else if (lastOutcome.kind === "busy") {
      setAnnouncement("Busy, try again")
    } else if (lastOutcome.kind === "failed") {
      setAnnouncement("Request failed")
    }
  }, [lastOutcome])

  useEffect(() => {
    if (lastKey === "" || !open || showHistoryList) return
    const node = thread.current
    const latest = node?.querySelector<HTMLElement>(".stuart-turn:last-child")
    if (node === null || latest === null || latest === undefined) return
    node.scrollTop = Math.max(0, latest.offsetTop - 8)
  }, [lastKey, open, showHistoryList])

  const host: PanelHost = useMemo(
    () => ({
      endpoint,
      wallet,
      signer: store.signer,
      navigate,
      hrefFor,
      scanUrl,
      ask,
      busy: session.answering,
      signing,
    }),
    [
      endpoint,
      wallet,
      store.signer,
      navigate,
      hrefFor,
      scanUrl,
      ask,
      session.answering,
      signing,
    ],
  )

  function close(): void {
    closeStuart()
    focusBar()
  }

  function minimize(): void {
    minimizeStuart()
    focusBar()
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.key === "Escape") {
      event.stopPropagation()
      if (phone || !session.answering) close()
      else minimize()
      return
    }
    if (phone) trapFocus(event)
  }

  function onDragStart(event: PointerEvent<HTMLElement>): void {
    if (event.pointerType === "mouse" && event.button !== 0) return
    dragStart.current = event.clientY
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function onDragMove(event: PointerEvent<HTMLElement>): void {
    if (dragStart.current === null) return
    setDrag(event.clientY - dragStart.current)
  }

  function onDragEnd(event: PointerEvent<HTMLElement>): void {
    if (dragStart.current === null) return
    const moved = event.clientY - dragStart.current
    dragStart.current = null
    dragged.current = Math.abs(moved) > 6
    setDrag(null)
    if (sheet === "half" && moved < -60) {
      setSheet("full")
      fireHaptic("pick")
    } else if (sheet === "full" && moved > 60) {
      setSheet("half")
      fireHaptic("pick")
    } else if (sheet === "half" && moved > 110) {
      fireHaptic("pick")
      close()
    }
  }

  const placeholder =
    pinned === null ? "Ask Stuart" : `Ask about ${pinned.label}`
  const mode = typeof document === "undefined" ? "light" : themeMode()
  const conversation = session.conversation
  const sheetOffset =
    drag === null ? 0 : sheet === "full" ? Math.max(0, drag) : drag

  const shown = shownLayout.current
  const dockStyle =
    shown === "docked" && anchor !== null
      ? {
          right: anchor.right,
          bottom: anchor.bottom,
          transformOrigin: anchor.origin,
          ["--stuart-dock-bottom" as string]: `${anchor.bottom}px`,
        }
      : undefined
  const surface = !presence.mounted ? null : (
    <>
      {shown === "sheet" ? (
        <button
          type="button"
          className="stuart-scrim"
          data-state={presence.state}
          aria-label="Close Stuart"
          tabIndex={-1}
          onClick={close}
        />
      ) : null}
      <section
        id={panelId}
        role="dialog"
        aria-label="Stuart"
        aria-modal={shown === "sheet" ? "true" : undefined}
        className={`stuart-panel ${shown === "sheet" ? `stuart-sheet stuart-sheet-${sheet}` : shown === "expanded" ? "stuart-expanded" : "stuart-docked"}`}
        data-state={presence.state}
        data-mbx-motion=""
        inert={!open}
        style={
          shown === "sheet" && sheetOffset !== 0
            ? { transform: `translateY(${sheetOffset}px)` }
            : dockStyle
        }
        onKeyDown={onKeyDown}
      >
        {expanded ? (
          <HistoryList
            conversations={session.state.conversations}
            activeId={session.state.activeId}
            onSelect={session.select}
            onNew={session.newChat}
          />
        ) : null}
        <div className="stuart-main">
          {phone ? (
            <button
              type="button"
              className="stuart-grab"
              aria-label={sheet === "half" ? "Full height" : "Half height"}
              onClick={() => {
                if (dragged.current) {
                  dragged.current = false
                  return
                }
                setSheet(sheet === "half" ? "full" : "half")
              }}
              onPointerDown={onDragStart}
              onPointerMove={onDragMove}
              onPointerUp={onDragEnd}
              onPointerCancel={onDragEnd}
            >
              <span aria-hidden="true" />
            </button>
          ) : null}
          <header className="stuart-header">
            <StuartBadge size={28} className="stuart-header-mark" />
            <h2>Stuart</h2>
            <span className="stuart-header-actions">
              {expanded ? null : (
                <IconButton
                  label="History"
                  icon="history"
                  pressed={historyOpen}
                  onClick={() => setHistoryOpen(!historyOpen)}
                />
              )}
              {phone ? null : expanded ? (
                <IconButton
                  label="Collapse"
                  icon="collapse"
                  onClick={dockStuart}
                />
              ) : (
                <IconButton
                  label="Expand"
                  icon="expand"
                  onClick={expandStuart}
                />
              )}
              {phone ? null : (
                <IconButton label="Minimize" icon="minus" onClick={minimize} />
              )}
              <IconButton label="Close" icon="x" onClick={close} />
            </span>
          </header>
          {pinned === null ? null : (
            <ContextChip entity={pinned} onRemove={() => setPinned(null)} />
          )}
          <HostProvider value={host}>
            <SkeletonProvider mode={mode}>
              <div className="stuart-thread" ref={thread}>
                {showHistoryList ? (
                  <HistoryList
                    conversations={session.state.conversations}
                    activeId={session.state.activeId}
                    onSelect={(id) => {
                      session.select(id)
                      setHistoryOpen(false)
                    }}
                    onNew={() => {
                      session.newChat()
                      setHistoryOpen(false)
                    }}
                  />
                ) : conversation === null || conversation.turns.length === 0 ? (
                  <EmptyState
                    suggestions={suggestions ?? defaultSuggestions(wallet)}
                    onAsk={(question) => ask(question)}
                  />
                ) : (
                  <ol className="stuart-turns" aria-label={conversation.title}>
                    {conversation.turns.map((turn) => (
                      <TurnView
                        key={turn.id}
                        turn={turn}
                        onRetry={session.retry}
                      />
                    ))}
                  </ol>
                )}
              </div>
            </SkeletonProvider>
          </HostProvider>
          <Composer
            placeholder={placeholder}
            answering={session.answering}
            onAsk={(question) => ask(question)}
            onStop={session.stop}
            inputRef={(node) => {
              input.current = node
            }}
          />
        </div>
      </section>
    </>
  )

  return (
    <>
      {surface}
      {pill.mounted && pillQuestion.current !== null ? (
        <MinimizedPill
          question={pillQuestion.current}
          status={store.status}
          answering={store.answering}
          state={pill.state}
        />
      ) : null}
      <p className="stuart-sr" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
    </>
  )
}

StuartPanel.displayName = "Stuart.Panel"
