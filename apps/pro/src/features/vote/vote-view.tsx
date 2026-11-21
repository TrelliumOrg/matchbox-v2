import { whenIdle } from "@matchbox/motion"
import * as FilterTabs from "@matchbox/ui/filter-tabs"
import { Glyph, shapes } from "@matchbox/ui/icons"
import { clampPage, pageCount } from "@matchbox/ui/pagination"
import * as SelectMenu from "@matchbox/ui/select-menu"
import { Link } from "@tanstack/react-router"
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { island } from "../../components/island"
import type {
  GaugeKind,
  GaugeList,
  GaugeSummary,
  Lock,
  LockKind,
  Voter,
} from "../../data/view-models"
import { weiToWhole } from "../../lib/format"
import { useViewer, useViewingOther } from "../../lib/viewer"
import { useLive } from "../../live/live-context"
import { PageTitle, underlineLink } from "../../shell/page"
import { openTx, txIntent } from "../../tx/tx-store"
import { useWatching } from "../../watchlist/watch-store"
import { escrowGroups, gaugeKinds, kindOrder } from "../gauge/kinds"
import { rememberVoteList } from "../gauge/vote-return"
import {
  type Ballot,
  ballotGauges,
  ownVotes,
  pick,
  powerOf,
  project,
  sameBallot,
  setShare,
  splitEvenly,
  unpick,
  votedIn,
  votesIn,
  voteWeight,
} from "./ballot"
import { BallotBar, type OptimizeState, type OtherBallot } from "./ballot-panel"
import { fundedAlternative } from "./default-kind"
import { listGauges } from "./gauge-filter"
import type { PagerPosition } from "./gauge-pager"
import { GaugeTile } from "./gauge-tile"
import {
  initialSelection,
  loadSelection,
  locksOf,
  saveSelection,
} from "./locks"
import { gaugePageSize } from "./page-size"
import {
  primaryLabel,
  type SavedBallot,
  savedStatus,
  splitByVote,
  startingBallot,
} from "./saved-rules"
import { ViewSwitch } from "./view-switch"
import type { VoteSort, VoteTab } from "./vote-route"

// Hydrates right after the page (it is in view), so its code and the
// sliding indicator stay out of the first-paint JS.
const TypeList = island(
  "vote-types",
  () => import("./type-list").then((module) => module.TypeList),
  undefined,
  true,
)

// The lock row is server HTML until its code arrives, right after the page:
// its arrows, counts and scroll measuring are not needed to paint.
const LockPicker = island(
  "vote-locks",
  () => import("./lock-picker").then((module) => module.LockPicker),
  undefined,
  true,
)

// The pagers draw with the page (server HTML of plain links, which work
// before their code arrives) and hydrate right after it.
const PagesTop = island(
  "vote-pages",
  () => import("./gauge-pager").then((module) => module.GaugePager),
  undefined,
  true,
)

const PagesEnd = island("vote-pages-end", () =>
  import("./gauge-pager").then((module) => module.GaugePager),
)

const Rail = island(
  "ballot-rail",
  () => import("./ballot-rail").then((module) => module.BallotRail),
  // The ballot rail from 1600px; narrower screens use the bottom bar.
  "sticky top-6 hidden self-start min-[100rem]:block",
)

export type { VoteSort, VoteTab }

export const voteSorts: Record<VoteSort, string> = {
  incentives: "Incentives",
  apy: "APY",
  votes: "Votes",
  room: "Room to 5×",
}

export const expiredWarning = "Lock expired, these votes earn no boost"

function gaugeKey(gauge: GaugeSummary): string {
  return gauge.address.toLowerCase()
}

type HapticsModule = typeof import("@matchbox/motion/haptics")

// Haptics load when the page is idle, so the pick tick costs nothing on
// first paint; a pick before then has no tick.
let haptics: HapticsModule | null = null

function loadHaptics(): Promise<void> {
  return import("@matchbox/motion/haptics").then(async (module) => {
    await module.preloadHaptics()
    haptics = module
  })
}

function loadOptimizer() {
  return import("./optimize")
}

function isVoteSort(value: string): value is VoteSort {
  return Object.hasOwn(voteSorts, value)
}

export type VoteViewProps = {
  list: GaugeList
  voter: Voter | null
  epoch: number
  kind: GaugeKind
  tab: VoteTab
  sort: VoteSort
  /** From the URL; past the last page shows the last page. */
  page: number
  /** The search box, from the URL. */
  query: string
  /** A gauge to put on the ballot on arrival (`?pick=`), lower case. */
  arrivalPick: string | null
  /** The arrival pick is on a connected wallet's ballot: drop it from the URL. */
  onArrivalPickDone: () => void
  onTab: (tab: VoteTab) => void
  onSort: (sort: VoteSort) => void
  onQuery: (query: string) => void
  /** Puts the page actually shown into the URL (an out-of-range page). */
  onPageFix: (page: number) => void
}

const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect

const savedKey = (lock: Lock): string => `${lock.kind}:${lock.tokenId}`

const kindsOf = (escrow: LockKind): readonly GaugeKind[] =>
  escrowGroups.find((group) => group.escrow === escrow)?.kinds ?? []

/**
 * Vote (type list `KU0DDjXECD` option 3, locks `VIV1RuryQ3` direction A):
 * the type picks the escrow and the voter contract, and the escrow's
 * selected locks vote one split each. Every type has its own ballot and
 * its own 100%, kept while switching types: a lock's full voting power
 * counts on each of its two voters (see `ballot.ts`).
 */
export function VoteView({
  list,
  voter,
  epoch,
  kind,
  tab,
  sort,
  page,
  query,
  arrivalPick,
  onArrivalPickDone,
  onTab,
  onSort,
  onQuery,
  onPageFix,
}: VoteViewProps): ReactNode {
  const viewer = useViewer()
  // Someone else's locks: their ballot can be explored, never signed.
  const other = useViewingOther()
  const wallet = voter?.address ?? null
  const allLocks = voter?.locks ?? []
  const escrow = gaugeKinds[kind].escrow
  // On this page "voted this epoch" means through this type's voter: a
  // lock that voted on veBTC gauges can still vote on MEZO gauges now.
  const locks = useMemo(
    () =>
      locksOf(allLocks, escrow).map((lock) => ({
        ...lock,
        votedThisEpoch: votedIn(lock, kind),
      })),
    [allLocks, escrow, kind],
  )

  const [selection, setSelection] = useState<Record<LockKind, string[] | null>>(
    { vemezo: null, vebtc: null },
  )
  const [ballots, setBallots] = useState<Record<GaugeKind, Ballot | null>>({
    vebtc: null,
    mezo: null,
    validator: null,
    pool: null,
  })
  // Splits saved for locks that voted this epoch (this browser only), read
  // after hydration and again whenever one is saved or cleared.
  const [saved, setSaved] = useState<ReadonlyMap<string, SavedBallot>>(
    () => new Map(),
  )
  useEffect(() => {
    if (wallet === null) return
    // The storage code loads here, after the page: it is not needed to paint.
    let live = true
    let stop: (() => void) | null = null
    void import("./saved-ballots").then(({ loadSaved, subscribeSaved }) => {
      if (!live) return
      const read = () =>
        setSaved(
          new Map(
            locks.flatMap((lock) => {
              const split = loadSaved(wallet, lock, kind)
              return split === null ? [] : [[savedKey(lock), split] as const]
            }),
          ),
        )
      read()
      stop = subscribeSaved(read)
    })
    return () => {
      live = false
      stop?.()
    }
  }, [wallet, locks, kind])
  const savedOf = (lock: Lock): SavedBallot | null =>
    saved.get(savedKey(lock)) ?? null
  const { market } = useLive()
  // The box answers at once; the URL follows (replace, never a new entry).
  const [draft, setDraft] = useState(query)
  const sentQuery = useRef(query)
  useEffect(() => {
    if (query === sentQuery.current) return
    sentQuery.current = query
    setDraft(query)
  }, [query])
  const [optimized, setOptimized] = useState<Ballot | null>(null)
  // The ballot Optimize replaced, per gauge type, for "Was $X" and Undo.
  const [replaced, setReplaced] = useState<
    Partial<Record<GaugeKind, { ballot: Ballot; projectedMicro: bigint }>>
  >({})

  // The server and the first client render agree: every lock that can vote.
  // The remembered selection for this type applies after hydration.
  useEffect(() => {
    if (wallet === null) return
    const remembered = loadSelection(wallet, kind)
    if (remembered === null) return
    setSelection((current) => ({
      ...current,
      [escrow]: initialSelection(locks, remembered),
    }))
  }, [wallet, kind, escrow, locks])

  const selectedIds = selection[escrow] ?? initialSelection(locks, null)
  const selected = useMemo(
    () => locks.filter((lock) => selectedIds.includes(lock.tokenId)),
    [locks, selectedIds],
  )
  const power = powerOf(selected)
  const byId = useMemo(
    () =>
      new Map(list.gauges.map((gauge) => [gauge.address.toLowerCase(), gauge])),
    [list.gauges],
  )
  const inKind = (id: string): boolean => byId.get(id)?.kind === kind
  const starting = (from: readonly Lock[]): Ballot =>
    startingBallot(from, savedOf, kind, inKind)
  // A gauge named in the URL (`?pick=`) joins this type's ballot on
  // arrival. It is laid over the ballot until the first edit keeps it, so
  // it lands on whatever the locks' votes turn out to be. Signed out, the
  // URL keeps it: connecting a wallet starts this view again, and the pick
  // has to be made again on that wallet's ballot.
  const [arrival, setArrival] = useState<{
    kind: GaugeKind
    address: string
  } | null>(null)
  const arrivalGauge =
    arrivalPick === null ? null : (byId.get(arrivalPick) ?? null)
  const arrivalAddress =
    arrivalGauge !== null && arrivalGauge.kind === kind
      ? arrivalGauge.address
      : null
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the pick or the wallet changes, and the handler is new on every render
  useEffect(() => {
    if (arrivalPick === null) return
    if (arrivalAddress !== null) setArrival({ kind, address: arrivalAddress })
    if (wallet !== null || arrivalAddress === null) onArrivalPickDone()
  }, [arrivalPick, arrivalAddress, wallet])
  const withArrival = (base: Ballot): Ballot =>
    arrival === null ||
    arrival.kind !== kind ||
    base.has(arrival.address.toLowerCase())
      ? base
      : pick(base, arrival.address)
  // A saved split (pending or ready) comes first, else the locks' votes.
  const ballot = withArrival(ballots[kind] ?? starting(selected))

  function setBallot(update: (current: Ballot) => Ballot): void {
    setBallots((current) => ({
      ...current,
      [kind]: update(withArrival(current[kind] ?? starting(selected))),
    }))
    if (arrival?.kind === kind) setArrival(null)
  }

  function select(ids: string[]): void {
    setSelection((current) => ({ ...current, [escrow]: ids }))
    if (wallet !== null) saveSelection(wallet, kind, ids)
    // Picking a lock that voted this epoch loads its split to change.
    const added = locks.find(
      (lock) =>
        ids.includes(lock.tokenId) &&
        !selectedIds.includes(lock.tokenId) &&
        (lock.votedThisEpoch || savedOf(lock) !== null),
    )
    if (added !== undefined) {
      setBallots((current) => ({ ...current, [kind]: starting([added]) }))
    }
  }

  const statuses = selected.map((lock) =>
    savedStatus(savedOf(lock), lock, epoch),
  )
  const pendingIds = new Set(
    locks
      .filter((lock) => savedStatus(savedOf(lock), lock, epoch) === "pending")
      .map((lock) => lock.tokenId),
  )
  const note = statuses.includes("pending")
    ? `Changes saved for Epoch ${epoch + 1}`
    : statuses.includes("ready")
      ? "Saved split"
      : null

  /** Every gauge this ballot can hold: the type's, one voter contract. */
  const typeGauges = useMemo(
    () => list.gauges.filter((gauge) => gauge.kind === kind),
    [list.gauges, kind],
  )
  const targets = useMemo(
    () => ballotGauges(typeGauges, selected),
    [typeGauges, selected],
  )
  // Optimize never puts votes on an expired gauge.
  const liveTargets = useMemo(() => {
    const expired = new Set(
      typeGauges.filter((g) => g.expired).map((g) => g.address.toLowerCase()),
    )
    return targets.filter((target) => !expired.has(target.id))
  }, [targets, typeGauges])
  const own = useMemo(() => ownVotes(selected), [selected])
  const projection = useMemo(
    () => project(targets, power, ballot),
    [targets, power, ballot],
  )
  // Nothing funded in this type: say so, and offer the type that is (P3).
  const unfunded = useMemo(
    () => fundedAlternative(kind, allLocks, list.fundedKinds),
    [kind, allLocks, list.fundedKinds],
  )

  useEffect(() => whenIdle(() => void loadHaptics()), [])

  useEffect(() => {
    if (selected.length === 0) {
      setOptimized(null)
      return
    }
    return whenIdle(() => {
      void loadOptimizer().then(({ optimize }) =>
        setOptimized(optimize(liveTargets, power)),
      )
    })
  }, [selected.length, liveTargets, power])

  const optimizeState: OptimizeState =
    optimized === null
      ? { kind: "idle" }
      : sameBallot(optimized, ballot)
        ? { kind: "optimized", applied: appliedOf(replaced[kind]) }
        : {
            kind: "ready",
            gainMicro:
              project(targets, power, optimized).total - projection.total,
          }

  function toggle(gauge: GaugeSummary, next: boolean): void {
    haptics?.fireHaptic("pick")
    setBallot((current) =>
      next ? pick(current, gauge.address) : unpick(current, gauge.address),
    )
  }

  /** What Optimize changed, while its ballot stands. */
  function appliedOf(
    before: { ballot: Ballot; projectedMicro: bigint } | undefined,
  ): Extract<OptimizeState, { kind: "optimized" }>["applied"] {
    if (before === undefined) return null
    return {
      wasMicro: before.projectedMicro,
      gainMicro: projection.total - before.projectedMicro,
    }
  }

  /**
   * Undo: the ballot Optimize replaced for this gauge type, read when it
   * is pressed. A handler of its own, not a function inside the optimize
   * state, so the panel always calls the latest one.
   */
  function undoOptimize(): void {
    const before = replaced[kind]
    if (before === undefined) return
    haptics?.fireHaptic("nudge")
    setBallot(() => before.ballot)
    setReplaced((current) => {
      const { [kind]: _undone, ...rest } = current
      return rest
    })
  }

  async function runOptimize(): Promise<void> {
    const { optimize } = await loadOptimizer()
    const best = optimized ?? optimize(liveTargets, power)
    if (best === null) return
    setOptimized(best)
    if (!sameBallot(best, ballot)) {
      haptics?.fireHaptic("nudge")
      // Kept until Undo, or until the ballot is changed by hand (then the
      // optimized state itself is gone and nothing shows it).
      setReplaced((current) => ({
        ...current,
        [kind]: { ballot, projectedMicro: projection.total },
      }))
    }
    setBallot(() => best)
  }

  // This device's starred gauges (see watch-store), plus any the wallet's
  // read model names once the API serves a watchlist.
  const starred = useWatching()
  const watching = new Set([
    ...starred,
    ...(voter?.watching ?? []).map((address) => address.toLowerCase()),
  ])
  const { rows: filtered, counts } = listGauges(typeGauges, {
    tab,
    sort,
    needle: draft.trim().toLowerCase(),
    tests: {
      all: () => true,
      picked: (gauge) => ballot.has(gaugeKey(gauge)),
      funded: (gauge) => gauge.funded,
      watching: (gauge) => watching.has(gaugeKey(gauge)),
    },
  })
  const pages = pageCount(filtered.length, gaugePageSize)
  const current = clampPage(page, pages)
  const visible = filtered.slice(
    (current - 1) * gaugePageSize,
    current * gaugePageSize,
  )
  // Past the last page (an old link, or picks that left fewer pages):
  // the last page shows, and the URL says so.
  useEffect(() => {
    if (page !== current) onPageFix(current)
  }, [page, current, onPageFix])

  // After a step from either pager the top of the list is in view, and a
  // step from the bottom pager moves focus to the new page of gauges, so
  // nobody is left at the foot of a page they have not read.
  const listTop = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const stepped = useRef<PagerPosition | null>(null)
  // Stable, so the pager islands only re-render when their pages change.
  const onStep = useCallback((from: PagerPosition) => {
    stepped.current = from
  }, [])
  // Runs when the page shown changes.
  useIsomorphicLayoutEffect(() => {
    const from = stepped.current
    stepped.current = null
    if (from === null) return
    const top = listTop.current
    if (top !== null && top.getBoundingClientRect().top < 0) {
      top.scrollIntoView({ block: "start" })
    }
    if (from === "bottom") listRef.current?.focus({ preventScroll: true })
  }, [current])

  /** Votes on the gauge under this ballot, in wei. */
  function votesWeiFor(gauge: GaugeSummary): bigint {
    const id = gauge.address.toLowerCase()
    const listed = BigInt(gauge.votes)
    const mine = own.get(id) ?? 0n
    const next = voteWeight(power, ballot.get(id) ?? 0)
    return listed - mine + next
  }

  const expiredPicked = [...ballot.keys()].some(
    (id) => byId.get(id)?.expired === true,
  )

  // The other types' ballots that were changed here, one link each.
  const others: OtherBallot[] = kindOrder.flatMap((otherKind) => {
    const otherBallot = ballots[otherKind]
    if (otherKind === kind || otherBallot === null || otherBallot.size === 0) {
      return []
    }
    const otherEscrow = gaugeKinds[otherKind].escrow
    const escrowLocks = locksOf(allLocks, otherEscrow)
    const picked = selection[otherEscrow] ?? initialSelection(escrowLocks, null)
    const otherLocks = escrowLocks.filter((lock) =>
      picked.includes(lock.tokenId),
    )
    return [
      {
        escrow: otherEscrow,
        kind: otherKind,
        locks: otherLocks.length,
        picks: otherBallot.size,
        projectedMicro: project(
          ballotGauges(
            list.gauges.filter((gauge) => gauge.kind === otherKind),
            otherLocks,
          ),
          powerOf(otherLocks),
          otherBallot,
        ).total,
      },
    ]
  })

  // The escrow's other type, when the picked locks hold votes there: this
  // ballot does not touch them, and the panel says so.
  const sibling = kindsOf(escrow).find((each) => each !== kind) ?? null
  const keeps = sibling !== null && votesIn(selected, sibling) ? sibling : null

  const panel = {
    epoch,
    voter,
    escrow,
    kind,
    keeps,
    locks: selected,
    power,
    warning: expiredPicked ? expiredWarning : null,
    others,
    gauges: byId,
    ballot,
    projectedMicro: projection.total,
    perGaugeMicro: projection.perGauge,
    optimize: optimizeState,
    onShare: (address: string, bps: number) =>
      setBallot((current) => setShare(current, address, bps)),
    onOptimize: () => void runOptimize(),
    onUndo: undoOptimize,
    onSplitEvenly: () => setBallot((current) => splitEvenly(current)),
    primary: other ? "Viewing only" : primaryLabel(selected, epoch),
    readOnly: other,
    note,
    onReview: () => {
      if (selected.length === 0 || wallet === null || other) return
      const { sign, save } = splitByVote(selected)
      openTx(viewer, {
        flow: "vote",
        kind,
        keeps,
        locks: sign,
        saveLocks: save,
        wallet,
        epochEndsAt: market.epoch.endsAt,
        picks: [...ballot].flatMap(([id, bps]) => {
          const gauge = byId.get(id)
          return gauge === undefined ? [] : [{ gauge, bps }]
        }),
        projectedMicro: projection.total,
        perGaugeMicro: projection.perGauge,
        epoch,
      })
    },
    reviewIntent: txIntent,
  }

  return (
    <div data-wide="" data-vote="">
      <PageTitle>Vote</PageTitle>
      <div className="mt-6 grid items-start gap-7 min-[834px]:grid-cols-[220px_minmax(0,1fr)] min-[100rem]:grid-cols-[220px_minmax(0,1fr)_336px]">
        <div className="min-w-0 min-[834px]:sticky min-[834px]:top-6">
          <TypeList totals={list.kindTotals} active={kind} />
        </div>
        <section
          aria-label={gaugeKinds[kind].label}
          className="@container min-w-0"
        >
          {voter === null ? null : (
            <LockPicker
              escrow={escrow}
              locks={locks}
              selected={selectedIds}
              onSelectedChange={select}
              saved={[...pendingIds]}
              nextEpoch={epoch + 1}
              onNewLock={() =>
                openTx(viewer, { flow: "new-lock", kind: escrow })
              }
              newLock={!other}
            />
          )}
          {unfunded === null ? null : (
            <p className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-[20px] bg-soft px-5 py-4 text-[15px] text-ink2">
              <span>
                No {gaugeKinds[kind].label} funded in Epoch {epoch}
                {unfunded.needs === null
                  ? null
                  : `. ${gaugeKinds[unfunded.kind].label} are, and voting them needs a ${gaugeKinds[unfunded.kind].unit} lock.`}
              </span>
              <Link
                to="/vote/$type"
                params={{ type: unfunded.kind }}
                className={underlineLink}
              >
                See {gaugeKinds[unfunded.kind].label}
              </Link>
            </p>
          )}
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <FilterTabs.Root
              label="Gauge filter"
              value={tab}
              onValueChange={(value) => {
                if (
                  value === "all" ||
                  value === "picked" ||
                  value === "funded" ||
                  value === "watching"
                ) {
                  onTab(value)
                }
              }}
              className="-ml-0.5"
            >
              <FilterTabs.Item value="all" count={counts.all}>
                All
              </FilterTabs.Item>
              {selected.length === 0 ? null : (
                <FilterTabs.Item value="picked" count={counts.picked}>
                  Picked
                </FilterTabs.Item>
              )}
              <FilterTabs.Item value="funded" count={counts.funded}>
                Funded
              </FilterTabs.Item>
              {voter === null ? null : (
                <FilterTabs.Item value="watching" count={counts.watching}>
                  Watching
                </FilterTabs.Item>
              )}
            </FilterTabs.Root>
            <SelectMenu.Root
              label="Sort by"
              value={sort}
              valueText={voteSorts[sort]}
              onValueChange={(value) => {
                if (isVoteSort(value)) onSort(value)
              }}
              className="ml-auto"
            >
              {Object.entries(voteSorts).map(([value, label]) => (
                <SelectMenu.Item key={value} value={value}>
                  {label}
                </SelectMenu.Item>
              ))}
            </SelectMenu.Root>
            <label className="relative flex h-[42px] w-full items-center gap-2.5 rounded-[21px] bg-soft px-4 text-[15px] text-sec focus-within:outline-2 focus-within:outline-ink sm:w-[220px]">
              <Glyph shape={shapes.search} size={18} />
              <span className="sr-only">Search {gaugeKinds[kind].label}</span>
              <input
                type="search"
                value={draft}
                onChange={(event) => {
                  const next = event.target.value
                  setDraft(next)
                  sentQuery.current = next
                  onQuery(next)
                }}
                placeholder={`Search ${gaugeKinds[kind].label}`}
                className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-sec"
              />
            </label>
          </div>
          <div
            ref={listTop}
            className="mt-4 flex scroll-mt-4 flex-wrap items-center justify-between gap-3"
          >
            <PagesTop
              page={current}
              pageCount={pages}
              total={filtered.length}
              position="top"
              onStep={onStep}
            />
            <ViewSwitch />
          </div>
          {visible.length === 0 ? (
            <p className="mt-6 text-[15px] text-sec">No gauges</p>
          ) : (
            <ul
              ref={listRef}
              tabIndex={-1}
              aria-label={`${gaugeKinds[kind].label}, page ${current} of ${pages}`}
              data-flip-list=""
              data-gauge-list=""
              className="mt-4 grid gap-4 outline-none @[560px]:grid-cols-2 @[880px]:grid-cols-3 @[1240px]:grid-cols-4 in-data-[gauge-view=compact]:grid-cols-1! in-data-[gauge-view=compact]:gap-1"
            >
              {visible.map((gauge) => {
                const id = gaugeKey(gauge)
                return (
                  <li key={id} data-flip={id} className="grid">
                    <GaugeTile
                      gauge={gauge}
                      picked={ballot.has(id)}
                      disabled={selected.length === 0}
                      votes={weiToWhole(`${votesWeiFor(gauge)}`)}
                      votesWei={votesWeiFor(gauge)}
                      onOpen={() =>
                        rememberVoteList(kind, {
                          tab,
                          sort,
                          page: current,
                          q: draft,
                        })
                      }
                      onPickedChange={(next) => toggle(gauge, next)}
                    />
                  </li>
                )
              })}
            </ul>
          )}
          {pages > 1 ? (
            <div className="mt-6 border-t border-line pt-5">
              <PagesEnd
                page={current}
                pageCount={pages}
                total={filtered.length}
                position="bottom"
                onStep={onStep}
              />
            </div>
          ) : null}
        </section>
        <Rail {...panel} />
      </div>
      <div className="h-24 min-[100rem]:hidden" aria-hidden="true" />
      <BallotBar {...panel} />
    </div>
  )
}
