import { easing, prefersReducedMotion, whenIdle } from "@matchbox/motion"
import { Glyph, shapes } from "@matchbox/ui/icons"
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import {
  classicUrl,
  dismissNote,
  noteEntered,
  useClassicNote,
} from "./note-store"

/**
 * The note itself, in its two places (Doop frames `hZK0Inosqx`, `0Fgr6k10J4`,
 * `suAZjIONUA`, states `sfvzgYmngc`, motion in `bUZzLubGKg`):
 *
 * - the full sidebar: a card where the "Matchbox Classic" row sits. Closing
 *   it folds the card back into that row;
 * - phones, and widths where the sidebar is an icon rail: the same card
 *   floating above the bottom chrome. Closing it sinks it away.
 *
 * Both are rendered and CSS shows the one for the width, so nothing here
 * measures the window. This module loads only for a visit that shows the
 * note.
 */

const enterMs = 320
const foldMs = 280
const heldMs = 1200
const heldFadeMs = 400
const connectedFadeMs = 200
const reducedMs = 120
/** The entrance waits this long after load, then for an idle moment. */
const settleMs = 600

/** Runs a Web Animation and resolves when it ends (at once without one). */
function play(
  element: HTMLElement | null,
  keyframes: Keyframe[],
  duration: number,
): Promise<void> {
  if (element === null || typeof element.animate !== "function") {
    return Promise.resolve()
  }
  const animation = element.animate(keyframes, {
    duration,
    easing: easing.roll,
    fill: "both",
  })
  return animation.finished.then(
    () => undefined,
    () => undefined,
  )
}

function fadeFrames(rise: number): Keyframe[] {
  return prefersReducedMotion()
    ? [{ opacity: 0 }, { opacity: 1 }]
    : [
        { opacity: 0, transform: `translateY(${rise}px)` },
        { opacity: 1, transform: "translateY(0)" },
      ]
}

function today(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/**
 * Whether the card is on screen yet. A note that already entered in this
 * visit is simply there; otherwise it waits for the page to settle, enters
 * once (`rise` px up, or opacity alone under reduced motion) and records it.
 */
function useEntrance(
  card: RefObject<HTMLElement | null>,
  entered: boolean,
  rise: number,
): boolean {
  const [up, setUp] = useState(entered)
  const [animate, setAnimate] = useState(false)

  useEffect(() => {
    if (up) return
    let cancelIdle: () => void = () => {}
    const start = () => {
      cancelIdle = whenIdle(() => {
        setAnimate(true)
        setUp(true)
      })
    }
    const wait = Math.max(0, settleMs - performance.now())
    const timer = setTimeout(start, wait)
    return () => {
      clearTimeout(timer)
      cancelIdle()
    }
  }, [up])

  useLayoutEffect(() => {
    if (!up || !animate) return
    setAnimate(false)
    void play(
      card.current,
      fadeFrames(rise),
      prefersReducedMotion() ? reducedMs : enterMs,
    ).then(noteEntered)
  }, [up, animate, card, rise])

  return up
}

const linkClass =
  "group inline-flex items-center gap-1 rounded-[6px] text-[15px] font-semibold text-ink underline decoration-1 underline-offset-[3px] outline-none hover:decoration-2 focus-visible:outline-2 focus-visible:outline-ink"

const closeClass =
  "absolute flex cursor-pointer items-center justify-center rounded-full text-sec outline-none transition-transform duration-100 hover:bg-soft2 hover:text-ink focus-visible:outline-2 focus-visible:outline-ink active:scale-90 active:bg-soft2 active:text-ink motion-reduce:transition-none"

function ArrowOut(): ReactNode {
  return (
    <Glyph
      shape={shapes.arrowUpRight}
      size={15}
      strokeWidth={2}
      className="transition-transform duration-150 group-hover:translate-x-[1.5px] group-hover:-translate-y-[1.5px] motion-reduce:transition-none"
    />
  )
}

/** The "Matchbox Classic" row of the sidebar foot, as it always was. */
export type ClassicRowProps = {
  ref?: RefObject<HTMLAnchorElement | null>
  /** Holds the soft fill, so the eye lands on where the note went. */
  held?: boolean
  /** The fill leaves over 400ms instead of at once. */
  fading?: boolean
  className?: string
}

/**
 * The sidebar's note. `Row` is the sidebar's own Classic row: the note
 * stands in for it at full sidebar width and gives way to it on dismissal.
 */
export function SidebarNote({
  Row,
}: {
  Row: (props: ClassicRowProps) => ReactNode
}): ReactNode {
  const note = useClassicNote()
  const box = useRef<HTMLDivElement | null>(null)
  const card = useRef<HTMLElement | null>(null)
  const row = useRef<HTMLAnchorElement | null>(null)
  const up = useEntrance(card, note.entered, 8)
  // "card" while the note is up, then the row: held, fading, at rest.
  const [stage, setStage] = useState<"card" | "held" | "fading" | "rest">(
    "card",
  )
  const leaving = useRef(false)

  useEffect(() => {
    if (note.phase === "showing" || leaving.current) return
    leaving.current = true
    const reduced = prefersReducedMotion()
    const timers: ReturnType<typeof setTimeout>[] = []
    async function leave(): Promise<void> {
      const height = box.current?.offsetHeight ?? 0
      if (note.phase === "used") {
        // A wallet connected: the person is busy. A plain fade, no fold.
        await play(
          card.current,
          [{ opacity: 1 }, { opacity: 0 }],
          reduced ? reducedMs : connectedFadeMs,
        )
        setStage("rest")
        return
      }
      await play(
        card.current,
        [...fadeFrames(8)].reverse(),
        reduced ? reducedMs : enterMs,
      )
      setStage("held")
      // The row is in the page now: the keyboard lands on the way back.
      requestAnimationFrame(() => {
        row.current?.focus({ preventScroll: true })
        const rest = row.current?.offsetHeight ?? 0
        const element = box.current
        if (reduced || element === null || height <= rest) return
        element.style.overflow = "hidden"
        void play(
          element,
          [{ height: `${height}px` }, { height: `${rest}px` }],
          foldMs,
        ).then(() => {
          element.style.overflow = ""
        })
      })
      timers.push(
        setTimeout(() => {
          if (reduced) {
            setStage("rest")
            return
          }
          setStage("fading")
          timers.push(setTimeout(() => setStage("rest"), heldFadeMs))
        }, heldMs),
      )
    }
    void leave()
    // Not cancelled on re-render: the exit runs once and finishes.
  }, [note.phase])

  const cardUp = up && stage === "card"
  return (
    <div ref={box}>
      {cardUp ? (
        <aside
          ref={card}
          aria-label="Matchbox Classic"
          data-classic-note="sidebar"
          className="relative hidden rounded-[20px] bg-soft px-4 pt-3.5 pb-[15px] lg:block rail:hidden"
        >
          <p className="pr-[26px] text-[14.5px] leading-5 text-ink2">
            Looking for the old Matchbox?
          </p>
          <a href={classicUrl} className={`${linkClass} mt-1.5`}>
            Go to Matchbox Classic
            <ArrowOut />
          </a>
          <button
            type="button"
            aria-label="Dismiss banner"
            onClick={() => dismissNote(today())}
            className={`${closeClass} top-[7px] right-[7px] size-8 focus-visible:outline-offset-1`}
          >
            <Glyph shape={shapes.x} size={16} strokeWidth={2} />
          </button>
        </aside>
      ) : null}
      <Row
        ref={row}
        held={stage === "held"}
        fading={stage === "fading"}
        {...(cardUp ? { className: "lg:hidden rail:flex" } : {})}
      />
    </div>
  )
}

/**
 * The floating card, with the sidebar note's wording. On phones it sits
 * 12px above the tab bar, message over link (`suAZjIONUA`). Where the sidebar is an icon rail it is one line, as wide
 * as the Ctrl K bar, lined up with it and 12px above it (`lrzXRLITK5`). It
 * rises from behind the bottom chrome and sinks back on dismissal. After
 * that the way back is the "Matchbox Classic" row in the Account panel's
 * settings (`93ouLjoxqJ`).
 */
export function FloatingNote(): ReactNode {
  const note = useClassicNote()
  const card = useRef<HTMLElement | null>(null)
  const up = useEntrance(card, note.entered, 12)
  const [gone, setGone] = useState(false)
  const leaving = useRef(false)

  useEffect(() => {
    if (note.phase === "showing" || leaving.current) return
    leaving.current = true
    const reduced = prefersReducedMotion()
    const exit =
      note.phase === "used"
        ? play(
            card.current,
            [{ opacity: 1 }, { opacity: 0 }],
            reduced ? reducedMs : connectedFadeMs,
          )
        : play(
            card.current,
            [...fadeFrames(12)].reverse(),
            reduced ? reducedMs : enterMs,
          )
    void exit.then(() => setGone(true))
  }, [note.phase])

  if (!up || gone) return null
  return (
    <aside
      ref={card}
      aria-label="Matchbox Classic"
      data-classic-note="floating"
      className="fixed inset-x-5 bottom-(--dock) z-20 rounded-[20px] bg-soft pt-3 pr-[52px] pl-4 shadow-[0_0_0_1px_var(--soft2),0_8px_24px_rgb(14_15_12/0.08)] [--sb:72px] md:inset-x-auto md:left-[calc(var(--sb)+(100vw-var(--sb))/2)] [body:has([data-ballot-bar])_&]:bottom-(--over-dock) md:flex md:h-[52px] md:w-[min(600px,calc(100vw-var(--sb)-48px))] md:-translate-x-1/2 md:items-center md:gap-3.5 md:py-0 md:pr-1 md:pl-5 lg:hidden rail:flex stuart-expanded:hidden"
    >
      {/* One wording everywhere (owner, 12 Nov). On a narrow phone it
          wraps to two lines rather than being shortened. */}
      <p className="text-[14.5px] leading-5 text-ink2 md:whitespace-nowrap">
        Looking for the old Matchbox?
      </p>
      <a
        href={classicUrl}
        className={`${linkClass} mt-[3px] min-h-11 px-0.5 md:mt-0 md:whitespace-nowrap`}
      >
        Go to Matchbox Classic
        <ArrowOut />
      </a>
      <button
        type="button"
        aria-label="Dismiss banner"
        onClick={() => dismissNote(today())}
        className={`${closeClass} top-1/2 right-1 -mt-[22px] size-11 focus-visible:-outline-offset-2 md:static md:mt-0 md:ml-auto md:flex-none`}
      >
        <Glyph shape={shapes.x} size={18} strokeWidth={2} />
      </button>
    </aside>
  )
}
