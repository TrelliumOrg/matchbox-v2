import { useLive } from "@matchbox/live/context"
import { AnimatedNumber, MorphText, whenIdle } from "@matchbox/motion"
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react"
import {
  freshDeadlineMs,
  type HomeFigures,
  mergeFigures,
  type NumberFormat,
  nextEpochAt,
} from "../data/figures"

/**
 * The page goes live after first paint (live-data-spec, "When to fetch"):
 * one fresh request once the page is idle, at most a second after load,
 * then a re-read when a new block lands and the figures are old enough to
 * have changed (blocks every 30 s, so the cards' other figures, read in
 * the same request, every 30 s too), and at each epoch boundary. Only
 * while the tab is visible: a tab coming back re-reads at once if the
 * figures are older than that.
 *
 * Whether the figures are stale is a matter of their own read times
 * (figures.ts, `staleSince`), not of whether a request answered: the edge
 * answers with its last values when its own upstream reads fail. Only the
 * first fresh request holds the "As of" note back, so first paint never
 * flashes it: until it answers, fails or passes its 5 s deadline.
 */

/** A new block re-reads the figures once they are this old. */
export const refreshAfterMs = 30_000

export type LiveFigures = {
  figures: HomeFigures
  /**
   * The first fresh request has not yet answered, failed or run past its
   * 5 s deadline: the "As of" note waits for it.
   */
  waiting: boolean
}

export type FreshRead = () => Promise<HomeFigures>

type Timers = {
  now: () => number
}

/**
 * The refresh rules, apart from React: `read` fetches, `apply` receives
 * each answer. Returns `request(reason)` and `stop()`.
 */
export function createRefresher(options: {
  read: FreshRead
  apply: (update: (current: LiveFigures) => LiveFigures) => void
  visible: () => boolean
  timers?: Timers
}) {
  const now = options.timers?.now ?? Date.now
  let lastAt = Number.NEGATIVE_INFINITY
  let current: Promise<HomeFigures | null> | null = null
  let stopped = false

  async function read(): Promise<HomeFigures | null> {
    let settled = false
    const deadline = setTimeout(() => {
      if (settled || stopped) return
      options.apply((state) => ({ ...state, waiting: false }))
    }, freshDeadlineMs)
    try {
      const fresh = await options.read()
      settled = true
      if (stopped) return null
      options.apply((state) => ({
        figures: mergeFigures(state.figures, fresh),
        waiting: false,
      }))
      return fresh
    } catch {
      settled = true
      if (stopped) return null
      options.apply((state) => ({ ...state, waiting: false }))
      return null
    } finally {
      clearTimeout(deadline)
      current = null
    }
  }

  /** One read at a time: a second ask while one is out shares it. */
  function run(): Promise<HomeFigures | null> {
    if (stopped) return Promise.resolve(null)
    if (current !== null) return current
    lastAt = now()
    // read() runs to its first await before this assignment, and clears
    // it in its finally, in the same turn as the figures land.
    current = read()
    return current
  }

  return {
    /** "first": always. "block" and "visible": only if old enough. */
    request(reason: "first" | "block" | "visible" | "epoch"): void {
      if (!options.visible() && reason !== "first") return
      if (
        (reason === "block" || reason === "visible") &&
        now() - lastAt < refreshAfterMs
      ) {
        return
      }
      void run()
    },
    /**
     * The head fallback's poll (no socket): a read now, whose figures the
     * page takes and whose latest block the poll reports. The new head
     * then finds the figures just read and asks for nothing more.
     */
    poll(): Promise<HomeFigures | null> {
      return run()
    },
    stop(): void {
      stopped = true
    },
  }
}

/**
 * Hands `@matchbox/live`'s fallback poll the page's own figures read, so
 * one request tells the head and refreshes the cards. Before the cards
 * have mounted it reads on its own.
 */
export type PollLink = {
  pollLatest: () => Promise<number>
  attach: (poll: () => Promise<HomeFigures | null>) => () => void
}

export function createPollLink(read: FreshRead): PollLink {
  let poll: (() => Promise<HomeFigures | null>) | null = null
  return {
    async pollLatest(): Promise<number> {
      const figures = poll === null ? await read() : await poll()
      const head = figures?.scan.blocks?.[0]?.number
      // The poll's caller keeps its last head when this throws.
      if (head === undefined) throw new Error("the figures have no blocks")
      return head
    },
    attach(next) {
      poll = next
      return () => {
        if (poll === next) poll = null
      }
    },
  }
}

const LiveFiguresContext = createContext<LiveFigures | null>(null)

export function useFigures(): LiveFigures {
  const value = useContext(LiveFiguresContext)
  if (value === null)
    throw new Error("useFigures must be inside <FiguresProvider>")
  return value
}

function visible(): boolean {
  return (
    typeof document === "undefined" || document.visibilityState !== "hidden"
  )
}

export function FiguresProvider({
  seed,
  read,
  polls,
  children,
}: {
  seed: HomeFigures
  read: FreshRead
  /** The head fallback's poll, served by this provider's reads. */
  polls?: PollLink
  children: ReactNode
}): ReactNode {
  const [state, setState] = useState<LiveFigures>({
    figures: seed,
    waiting: true,
  })
  const { store } = useLive()
  const readRef = useRef(read)

  useEffect(() => {
    const refresher = createRefresher({
      read: () => readRef.current(),
      apply: setState,
      visible,
    })
    const detach = polls?.attach(() => refresher.poll())
    // The first fresh request: when idle, and never later than a second.
    let fired = false
    const first = (): void => {
      if (fired) return
      fired = true
      refresher.request("first")
    }
    const cancelIdle = whenIdle(first)
    const latest = setTimeout(first, 1000)
    const unsubscribe = store.subscribe(() => refresher.request("block"))
    const onVisible = (): void => refresher.request("visible")
    document.addEventListener("visibilitychange", onVisible)
    let epochTimer: ReturnType<typeof setTimeout> | undefined
    const atBoundary = (): void => {
      // Timers clamp at about 24.8 days; an epoch is 7.
      epochTimer = setTimeout(
        () => {
          refresher.request("epoch")
          atBoundary()
        },
        Math.max(1000, nextEpochAt(Date.now()) - Date.now() + 1000),
      )
    }
    atBoundary()
    return () => {
      detach?.()
      refresher.stop()
      cancelIdle()
      clearTimeout(latest)
      clearTimeout(epochTimer)
      unsubscribe()
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [store, polls])

  return (
    <LiveFiguresContext.Provider value={state}>
      {children}
    </LiveFiguresContext.Provider>
  )
}

/* Figures on screen */

const roll = { duration: 300, easing: "cubic-bezier(.2,.8,.2,1)" }
const fade = { duration: 200, easing: "ease-out" }

/**
 * A live number: only changed digits roll, 300 ms (the homepage's
 * ceiling, live-data-spec). The first paint is plain Intl text.
 */
export function LiveNumber({
  value,
  format,
  prefix,
  suffix,
}: {
  value: `${number}` | number
  format: NumberFormat
  prefix?: string
  suffix?: string
}): ReactNode {
  return (
    <AnimatedNumber
      value={value}
      format={format}
      locales="en-US"
      {...(prefix === undefined ? {} : { prefix })}
      {...(suffix === undefined || suffix === "" ? {} : { suffix })}
      transformTiming={roll}
      spinTiming={roll}
      opacityTiming={fade}
    />
  )
}

/** Names that change morph in place, 300 ms. */
export function LiveText({ children }: { children: string }): ReactNode {
  return <MorphText duration={300}>{children}</MorphText>
}

/**
 * A slot that may have no value. "Not available" in secondary text when
 * it has never had one. When a value arrives later it fades in over
 * 200 ms with no roll; on first paint nothing animates.
 */
export function Slot({
  has,
  children,
  className,
}: {
  has: boolean
  children: () => ReactNode
  className?: string
}): ReactNode {
  // Merges never empty a slot, so a slot empty at first paint that has a
  // value now is one whose value arrived later.
  const atFirstPaint = useRef(has)
  const arrived = has && !atFirstPaint.current
  if (!has)
    return <span className={`na ${className ?? ""}`}>Not available</span>
  return (
    <span className={`${className ?? ""} ${arrived ? "arrive" : ""}`}>
      {children()}
    </span>
  )
}
