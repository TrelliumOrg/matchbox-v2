import { BORROW_CONTRACTS, MUSD_CONTRACTS } from "@matchbox/chain"
import type {
  ScanEnclaveEventItem,
  ScanLockItem,
  ScanMorphoMarket,
  ScanMorphoPosition,
  ScanTrove,
} from "@matchbox/contracts/scan"
import {
  formatBtc,
  formatDecimal,
  unitsToDecimal,
} from "@matchbox/domain/format"
import {
  enclaveAmount,
  enclaveHistoryView,
  enclavePositionView,
  type HistoryView,
  loanActionWords,
  marketTokens,
  morphoHistoryView,
  morphoMove,
  morphoRowView,
  troveHistoryView,
  troveRowView,
} from "./borrow-views"
import { formatTokenAmount, type MarketToken } from "./tokens"

/**
 * A loan transaction's own panels (`h3WlmUZS7N`): which position it moved,
 * read from the transaction's logs (a trove's borrower, an Enclave
 * position id, a Morpho market and account), its plain-words title, "What
 * changed" (before and after, from the position's stored events) and the
 * position card (as the position's own page has it, with its latest
 * events). Pure: the reads are in tx-loan.server.
 *
 * Words for what is missing: "Not in the event" for a figure the stored
 * event does not carry, "Not available yet" for one that needs live state
 * the API does not serve (or a read that failed).
 */

export const notInEvent = "Not in the event"
export const notYetText = "Not available yet"

export type LoanRef =
  | { kind: "trove"; borrower: string }
  | { kind: "enclave"; position: string }
  | { kind: "morpho"; market: string; account: string }

type RawLog = { address: string; topics: readonly (string | null)[] }

const troveEmitters = new Set(
  [
    MUSD_CONTRACTS.mainnet.troveManager,
    MUSD_CONTRACTS.mainnet.borrowerOperations,
  ].map((address) => address.toLowerCase()),
)
const debtManager = BORROW_CONTRACTS.mainnet.enclaveDebtManager.toLowerCase()
const morphoBlue = BORROW_CONTRACTS.mainnet.morphoBlue.toLowerCase()

/** TroveUpdated, both forms (musd 1.0.2's eight arguments and the older six). */
const troveTopics = new Set([
  "0x85a52d2a9df6d50beea0d12f454309d08739d01fde1aa65491f68b92367297b4",
  "0xf575eb5cdee005607f56587351e18943ddacd11756b9d37980ec251797ff136c",
])

/**
 * EnclaveDebtManager's position events (the position id is the first
 * indexed topic). Its other events (OriginatorFeeAccrued, InterestAccrued,
 * RoleGranted) name no position.
 */
const enclaveTopics = new Set([
  // PositionOpened, DebtIncreased, DebtRepaid, PositionClosed
  "0x71b8cfcb91be8c2c8670be096e68d6366139b0e2d777e4f77ade632a4d721196",
  "0x2118334e388b7134a6f90e5aaf39ebfd7b72debb8d1c454fbe09d4156482c475",
  "0x868c03be9ffd10b7bd6294b60684c640d935b4f31deaf6662984e7de7da07087",
  "0xb77a99aa6bf8135a033a72ab89373f6f8977dc081d277755b7622c1782a14799",
  // PledgedVeBtcAdded, PledgedVeBtcRemoved
  "0x4847e7e5826ec6214e03626d14dec2d43abd228be3af7578f3a18a65039b1992",
  "0x02403dfe11b4461cb23bc722e800e5bad3ef47f2b1bd6bad6a40289132fd185d",
  // PositionCRThresholdsSet, PositionInterestRateSet,
  // PositionOriginatorFeeRateSet
  "0x82d06806d4681116daeab26dba8123da5d052b917f2b6e6d7a2de1c09df3ba51",
  "0xb393a3069b786b6a3b69171c7aa4df70b1d23b71a3ffde7e19e398e1c49a3264",
  "0x79ceb5b348d77f792cf231e2cc96b3eb0ee412c2fe149d7a3f39b4b9810b11f3",
])

/**
 * Morpho Blue's position events by topic, with the topic holding the
 * account whose position moved (`onBehalf`, a liquidation's borrower).
 */
const morphoAccountTopic: Readonly<Record<string, number>> = {
  // Supply(id, caller, onBehalf, assets, shares)
  "0xedf8870433c83823eb071d3df1caa8d008f12f6440918c20d75a3602cda30fe0": 3,
  // Withdraw(id, caller, onBehalf, receiver, assets, shares)
  "0xa56fc0ad5702ec05ce63666221f796fb62437c32db1aa1aa075fc6484cf58fbf": 2,
  // SupplyCollateral(id, caller, onBehalf, assets)
  "0xa3b9472a1399e17e123f3c2e6586c23e504184d504de59cdaa2b375e880c6184": 3,
  // WithdrawCollateral(id, caller, onBehalf, receiver, assets)
  "0xe80ebd7cc9223d7382aab2e0d1d6155c65651f83d53c8b9b06901d167e321142": 2,
  // Borrow(id, caller, onBehalf, receiver, assets, shares)
  "0x570954540bed6b1304a87dfe815a5eda4a648f7097a16240dcd85c9b5fd42a43": 2,
  // Repay(id, caller, onBehalf, assets, shares)
  "0x52acb05cebbd3cd39715469f22afbf5a17496295ef3bc9bb5944056c63ccaa09": 3,
  // Liquidate(id, caller, borrower, ...)
  "0xa4946ede45d0c6f06a0f5ce92c9ad3b4751452d2fe0e25010783bcab57a67e41": 3,
}

const word = /^0x[0-9a-f]{64}$/

/** An indexed address topic: twelve zero bytes, then the address. */
function topicAddress(topic: string | null | undefined): string | null {
  if (topic === null || topic === undefined) return null
  const lower = topic.toLowerCase()
  if (!word.test(lower) || !lower.startsWith(`0x${"0".repeat(24)}`)) {
    return null
  }
  return `0x${lower.slice(26)}`
}

/**
 * The positions a transaction's logs name, in log order, each once, from
 * the position events only: MUSD's TroveUpdated (its borrower),
 * EnclaveDebtManager's position events (the position id), Morpho Blue's
 * supply, borrow, repay, withdraw and liquidate (market and account). A
 * candidate the position's events do not tie to this transaction is
 * dropped by the reader.
 */
export function loanRefs(logs: readonly RawLog[]): LoanRef[] {
  const refs: LoanRef[] = []
  const seen = new Set<string>()
  const add = (key: string, ref: LoanRef) => {
    if (seen.has(key)) return
    seen.add(key)
    refs.push(ref)
  }
  for (const log of logs) {
    const address = log.address.toLowerCase()
    const [topic0, topic1] = log.topics
    const event = typeof topic0 === "string" ? topic0.toLowerCase() : ""
    if (troveEmitters.has(address) && troveTopics.has(event)) {
      const borrower = topicAddress(topic1)
      if (borrower !== null) {
        add(`trove:${borrower}`, { kind: "trove", borrower })
      }
    } else if (address === debtManager && enclaveTopics.has(event)) {
      const position = topic1?.toLowerCase()
      if (position !== undefined && word.test(position)) {
        add(`enclave:${position}`, { kind: "enclave", position })
      }
    } else if (address === morphoBlue) {
      const at = morphoAccountTopic[event]
      const market = topic1?.toLowerCase()
      const account = at === undefined ? null : topicAddress(log.topics[at])
      if (market !== undefined && word.test(market) && account !== null) {
        add(`morpho:${market}:${account}`, { kind: "morpho", market, account })
      }
    }
  }
  return refs
}

const nouns: Record<LoanRef["kind"], [string, string]> = {
  trove: ["trove", "troves"],
  enclave: ["Enclave position", "Enclave positions"],
  morpho: ["Morpho position", "Morpho positions"],
}

/**
 * "+3 more troves": the other positions of the same kind the logs name
 * (a redemption or a liquidation moves several); null with none.
 */
export function othersText(
  refs: readonly LoanRef[],
  shown: LoanRef["kind"],
): string | null {
  const count = refs.filter((ref) => ref.kind === shown).length - 1
  if (count <= 0) return null
  const [one, many] = nouns[shown]
  return `+${count} more ${count === 1 ? one : many}`
}

// -- views --------------------------------------------------------------------

export type LoanChange = {
  label: string
  value: string
  /** "From 10,000.00 MUSD", "New position". */
  note: string | null
}

export type LoanPositionLink =
  | { kind: "trove"; owner: string }
  | { kind: "enclave"; position: string }
  | { kind: "morpho"; market: string; account: string }

export type TxLoanView = {
  kind: LoanRef["kind"]
  /** "Repaid 5,000.00 MUSD". */
  title: string
  /** "MUSD loan", "Enclave", "BTC / mUSDC". */
  venue: string
  /** Whose position: a borrower, an Enclave, a Morpho account. */
  account: string | null
  /** The veBTC an Enclave position pledges: "veBTC #6033". */
  against: string | null
  /** "+3 more troves": other positions the transaction moved. */
  others: string | null
  changes: LoanChange[]
  /** Figures that need the live position state, not served yet. */
  notYet: string[]
  position: {
    link: LoanPositionLink
    /** "MUSD loan", "Enclave position". */
    title: string
    status: string
    rows: { label: string; value: string }[]
    /** Newest first; `current` for this transaction's events. */
    history: (HistoryView & { current: boolean })[]
    /** More events than shown. */
    more: boolean
  }
}

const musd: MarketToken = { symbol: "MUSD", decimals: 18 }
const btc: MarketToken = { symbol: "BTC", decimals: 18 }

/** History rows the card shows. */
const historyRows = 4

function cardHistory<Event extends { tx_hash: string }>(
  hash: string,
  events: readonly Event[],
  view: (event: Event) => HistoryView,
): { history: (HistoryView & { current: boolean })[]; more: boolean } {
  const index = Math.max(
    0,
    events.findIndex((event) => event.tx_hash === hash),
  )
  // Around this transaction: up to the rows before it, then the rest.
  const start = Math.max(0, Math.min(index - 1, events.length - historyRows))
  const shown = events.slice(start, start + historyRows)
  return {
    history: shown.map((event) => ({
      ...view(event),
      current: event.tx_hash === hash,
    })),
    more: events.length > shown.length,
  }
}

function amountText(units: bigint, token: MarketToken): string {
  return (
    formatTokenAmount((units < 0n ? -units : units).toString(), token) ?? ""
  )
}

const rateText = (bps: number) =>
  `${formatDecimal(unitsToDecimal(String(bps), 2), 2)}% APR`

type TroveEvent = {
  tx_hash: string
  log_index: number
  block_number: number
  timestamp: number
  borrower: string
  action: string
  principal: string
  interest: string
  coll: string
  interest_rate: number | null
  prev_principal: string | null
  prev_interest: string | null
  prev_coll: string | null
  accrued_interest: string | null
  debt_change: string | null
  coll_change: string | null
}

/**
 * A trove's debt or collateral before this transaction's events: after
 * less what the events moved (their own changes), so before plus moved is
 * always after. Without the changes, the stored before (debt with the
 * interest accrued up to the event); without that, the event before.
 */
function troveBefore(
  own: readonly TroveEvent[],
  after: bigint,
  changeOf: (event: TroveEvent) => string | null,
  storedBefore: (event: TroveEvent) => bigint | null,
  older: TroveEvent | undefined,
  olderValue: (event: TroveEvent) => bigint,
): bigint | null {
  if (own.every((event) => changeOf(event) !== null)) {
    return after - own.reduce((sum, e) => sum + BigInt(changeOf(e) ?? "0"), 0n)
  }
  const first = own.at(-1)
  const stored = first === undefined ? null : storedBefore(first)
  if (stored !== null) return stored
  if (older !== undefined) return olderValue(older)
  return first?.action === "LOAN_OPENED" ? 0n : null
}

/**
 * A trove transaction from the trove's events (newest first) and its
 * live row (null when its read failed). Null when none of the events is
 * this transaction's.
 */
export function troveTxLoan(
  hash: string,
  events: readonly TroveEvent[],
  trove: ScanTrove | null,
  more: boolean,
  others: string | null = null,
): TxLoanView | null {
  const own = events.filter((event) => event.tx_hash === hash)
  const last = own[0]
  const first = own.at(-1)
  if (last === undefined || first === undefined) return null
  const older = events[events.indexOf(first) + 1]
  const debtOf = (event: TroveEvent) =>
    BigInt(event.principal) + BigInt(event.interest)
  const debtAfter = debtOf(last)
  const collAfter = BigInt(last.coll)
  const debtBefore = troveBefore(
    own,
    debtAfter,
    (event) => event.debt_change,
    (event) =>
      event.prev_principal === null || event.prev_interest === null
        ? null
        : BigInt(event.prev_principal) +
          BigInt(event.prev_interest) +
          BigInt(event.accrued_interest ?? "0"),
    older,
    debtOf,
  )
  const collBefore = troveBefore(
    own,
    collAfter,
    (event) => event.coll_change,
    (event) => (event.prev_coll === null ? null : BigInt(event.prev_coll)),
    older,
    (event) => BigInt(event.coll),
  )
  const debtMoved = debtBefore === null ? null : debtAfter - debtBefore
  const collMoved = collBefore === null ? null : collAfter - collBefore
  const action = loanActionWords(last.action)
  const amount =
    debtMoved !== null && debtMoved !== 0n
      ? amountText(debtMoved, musd)
      : collMoved !== null && collMoved !== 0n
        ? amountText(collMoved, btc)
        : null
  const opened = first.action === "LOAN_OPENED"
  const from = (before: bigint | null, token: MarketToken) =>
    before === null
      ? null
      : opened && before === 0n
        ? "New loan"
        : `From ${amountText(before, token)}`
  const live = trove === null ? null : troveRowView(trove)
  const { history, more: older_ } = cardHistory(hash, events, troveHistoryView)
  return {
    kind: "trove",
    title: amount === null ? `${action} loan` : `${action} ${amount}`,
    venue: "MUSD loan",
    account: last.borrower,
    against: null,
    others,
    changes: [
      {
        label: "Debt",
        value: amountText(debtAfter, musd),
        note: from(debtBefore, musd),
      },
      {
        label: "Collateral",
        value: amountText(collAfter, btc),
        note: from(collBefore, btc),
      },
      ...(last.interest_rate === null
        ? []
        : [{ label: "Rate", value: rateText(last.interest_rate), note: null }]),
    ],
    notYet: [],
    position: {
      link: { kind: "trove", owner: last.borrower },
      title: "MUSD loan",
      status: live?.status ?? notYetText,
      rows:
        live === null
          ? []
          : [
              { label: "Debt", value: live.debt ?? notYetText },
              { label: "Collateral", value: live.collateral ?? notYetText },
              { label: "Rate", value: live.rate },
              {
                label: "Collateral ratio",
                value: live.collateralRatio ?? notYetText,
              },
              ...(live.health.liquidationPrice === null
                ? []
                : [
                    {
                      label: "Liquidates under",
                      value: live.health.liquidationPrice,
                    },
                  ]),
            ],
      history,
      more: more || older_,
    },
  }
}

/** veBTC locked in the given locks now, BTC base units; null unknown. */
function lockedNow(
  ids: readonly string[],
  locks: readonly ScanLockItem[],
): bigint | null {
  let total = 0n
  for (const id of ids) {
    const lock = locks.find((each) => each.token_id === id)
    if (lock === undefined) return null
    total += BigInt(lock.amount)
  }
  return total
}

const pledgedText = (ids: readonly string[]) =>
  ids.length === 0 ? null : ids.map((id) => `veBTC #${id}`).join(", ")

/** The actions that pledge veBTC: what "What changed" names as pledged. */
const pledging = new Set(["POSITION_OPENED", "COLLATERAL_PLEDGED"])

/**
 * The locks transaction `hash` pledged: each pledging event's own lock
 * (a row per lock), else the locks its event lists. None for an event
 * that pledges nothing (borrowing more, repaying).
 */
function pledgedBy(
  hash: string,
  events: readonly ScanEnclaveEventItem[],
): string[] {
  const rows = events.filter(
    (event) => event.tx_hash === hash && pledging.has(event.action),
  )
  const own = rows.flatMap((event) =>
    event.ve_btc_token_id === null ? [] : [event.ve_btc_token_id],
  )
  return [
    ...new Set(
      own.length > 0 ? own : rows.flatMap((event) => event.pledged_ve_btc),
    ),
  ]
}

/** One item per Enclave event (a row per pledged lock), its amount kept. */
function oneRowPerEvent(
  events: readonly ScanEnclaveEventItem[],
): ScanEnclaveEventItem[] {
  const out: ScanEnclaveEventItem[] = []
  for (const event of events) {
    const index = out.findIndex(
      (other) =>
        other.tx_hash === event.tx_hash && other.log_index === event.log_index,
    )
    const kept = out[index]
    if (kept === undefined) out.push(event)
    else if (kept.amount === null && event.amount !== null) out[index] = event
  }
  return out
}

/**
 * An Enclave transaction from the position's events (newest first) and
 * the position's current locks, read now. The veBTC amount locked is
 * today's, so it is the card's (current) figure; "What changed" names the
 * locks this transaction pledged, when it pledged any. Live debt with interest and the collateral ratio
 * are not served (batch 3): said so, never estimated.
 */
export function enclaveTxLoan(
  hash: string,
  position: string,
  events: readonly ScanEnclaveEventItem[],
  locks: readonly ScanLockItem[],
  more: boolean,
  others: string | null = null,
): TxLoanView | null {
  const unique = oneRowPerEvent(events)
  const own = unique.filter((event) => event.tx_hash === hash)
  const last = own[0]
  const first = own.at(-1)
  const latest = unique[0]
  if (last === undefined || first === undefined || latest === undefined) {
    return null
  }
  const older = unique
    .slice(unique.indexOf(first) + 1)
    .find((event) => event.principal !== null)
  const after =
    last.action === "POSITION_CLOSED"
      ? 0n
      : last.principal === null
        ? null
        : BigInt(last.principal)
  const before =
    first.action === "POSITION_OPENED"
      ? 0n
      : older?.principal === null || older === undefined
        ? null
        : BigInt(older.principal)
  const terms = enclavePositionView(
    position,
    unique.find((event) => event.principal !== null) ?? latest,
  )
  const against =
    last.pledged_ve_btc.length > 0 ? last.pledged_ve_btc : first.pledged_ve_btc
  const pledged = pledgedBy(hash, events)
  const action = loanActionWords(last.action)
  const moved =
    last.amount !== null && last.amount !== "0"
      ? enclaveAmount({ ...last, principal: null })
      : after !== null && before !== null && after !== before
        ? amountText(after - before, musd)
        : null
  const current = latest.action === "POSITION_CLOSED" ? 0n : latest.principal
  const { history, more: older_ } = cardHistory(
    hash,
    unique,
    enclaveHistoryView,
  )
  const nowLocked = lockedNow(latest.pledged_ve_btc, locks)
  return {
    kind: "enclave",
    title:
      moved !== null && last.action === "VEBTC_LOCKED"
        ? `Locked ${moved} in veBTC`
        : moved !== null && last.action === "VEBTC_INCREASED"
          ? `Added ${moved} to veBTC`
          : moved === null
            ? `${action} Enclave position`
            : `${action} ${moved}`,
    venue: "Enclave",
    account: last.enclave,
    against: pledgedText(against),
    others,
    changes: [
      {
        label: "Principal",
        value: after === null ? notInEvent : amountText(after, musd),
        note:
          before === 0n
            ? terms.rate === null
              ? "New position"
              : `New position at ${terms.rate}`
            : before === null
              ? null
              : `From ${amountText(before, musd)}`,
      },
      ...(pledged.length === 0
        ? []
        : [
            {
              label: "Pledged",
              value: pledgedText(pledged) ?? "",
              note: null,
            },
          ]),
      ...(terms.minimumRatio === null
        ? []
        : [
            {
              label: "Minimum ratio",
              value: terms.minimumRatio,
              note:
                terms.warningRatio === null
                  ? null
                  : `Warning at ${terms.warningRatio}`,
            },
          ]),
    ],
    notYet: ["Collateral ratio", "Price at the minimum"],
    position: {
      link: { kind: "enclave", position },
      title: "Enclave position",
      status: latest.action === "POSITION_CLOSED" ? "Closed" : "Active",
      rows: [
        {
          label: "Principal",
          value:
            current === null ? notInEvent : amountText(BigInt(current), musd),
        },
        {
          label: "Collateral now",
          value:
            nowLocked === null
              ? notYetText
              : formatBtc(unitsToDecimal(nowLocked.toString(), 18)).text,
        },
        ...(terms.rate === null ? [] : [{ label: "Rate", value: terms.rate }]),
        { label: "Collateral ratio", value: notYetText },
      ],
      history,
      more: more || older_,
    },
  }
}

type MorphoEvent = Parameters<typeof morphoHistoryView>[0] & {
  on_behalf: string | null
}

/** The live position read: the row, none held, or a read that failed. */
export type MorphoHeld =
  | { status: "ok"; position: ScanMorphoPosition | null }
  | { status: "failed" }

/**
 * A Morpho transaction from the position's events, its live row and the
 * market (for its tokens' decimals; null when its read failed).
 */
export function morphoTxLoan(
  hash: string,
  ref: { market: string; account: string },
  events: readonly MorphoEvent[],
  held: MorphoHeld,
  market: ScanMorphoMarket | null,
  more: boolean,
  others: string | null = null,
): TxLoanView | null {
  const own = events.filter((event) => event.tx_hash === hash)
  const last = own[0]
  if (last === undefined) return null
  const move = morphoMove(last, market)
  const position = held.status === "ok" ? held.position : null
  const live = position === null ? null : morphoRowView(position, market)
  const tokens = market === null ? null : marketTokens(market)
  const { history, more: older } = cardHistory(hash, events, (event) =>
    morphoHistoryView(event, market),
  )
  const owes = position !== null && position.borrow_assets !== "0"
  const holds = position !== null && position.collateral !== "0"
  const status =
    held.status === "failed"
      ? notYetText
      : position === null
        ? "Closed"
        : owes || holds
          ? "Active"
          : "Supplying"
  return {
    kind: "morpho",
    title:
      move.part === "Collateral" && move.amount !== null
        ? `${move.verb} ${move.amount} collateral`
        : move.amount === null
          ? move.verb
          : `${move.verb} ${move.amount}`,
    venue:
      live?.market ??
      (tokens === null
        ? "Morpho market"
        : `${tokens.collateral.symbol} / ${tokens.loan.symbol}`),
    account: ref.account,
    against: null,
    others,
    changes: own.flatMap((event) => {
      const each = morphoMove(event, market)
      if (event.action === "LIQUIDATED") {
        return [
          {
            label: "Collateral seized",
            value: each.seized ?? notInEvent,
            note: null,
          },
          {
            label: "Debt repaid",
            value: each.repaid ?? notInEvent,
            note: null,
          },
        ]
      }
      return [
        {
          label:
            each.part === null
              ? each.verb
              : `${each.part}, ${each.verb.toLowerCase()}`,
          value: each.amount ?? notInEvent,
          note: null,
        },
      ]
    }),
    notYet: [],
    position: {
      link: { kind: "morpho", market: ref.market, account: ref.account },
      title: live?.market ?? "Morpho position",
      status,
      rows:
        live === null
          ? []
          : [
              { label: "Debt", value: live.debt ?? "None" },
              { label: "Collateral", value: live.collateral ?? "None" },
              ...(live.health.ltv === null
                ? []
                : [{ label: "LTV", value: live.health.ltv }]),
              ...(live.health.healthFactor === null
                ? []
                : [{ label: "Health", value: live.health.healthFactor }]),
            ],
      history,
      more: more || older,
    },
  }
}
