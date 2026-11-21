import { EPOCH_ZERO_START, epochIndexFor, epochStartOf } from "@matchbox/domain"
import type { ActivityRow, ClaimTokenValue } from "./activity"
import type { LockRef, TokenAmount } from "./primitives"

// A wallet's activity or claims as CSV, for tax tools: one line per token
// per event, amounts as the exact decimals the read models hold, times in
// UTC (ISO 8601). Claims carry their value when claimed
// (`atClaim`); other rows carry no USD. Served by the API's
// `/internal/pro/wallets/{address}/activity.csv` and `rewards.csv`.
//
// Every cell is guarded against formula injection: a value a spreadsheet
// would run gets a leading single quote. That is one starting with =, +,
// - or @ (or their full-width forms ＝ ＋ － ＠), after any spaces, or with
// a tab, a carriage return or a line feed. Token symbols and gauge names
// come from contracts anyone can deploy, so they are never trusted. The
// amounts, hashes and addresses are the read models' own digits and hex,
// which no rule touches.
//
// The file starts with a UTF-8 byte order mark, so Excel reads non-ASCII
// symbols and names as UTF-8 rather than the system's code page.

export type HistoryCsvKind = "activity" | "rewards"

export const historyCsvColumns = [
  "date_utc",
  "epoch",
  "claimed_in_epoch",
  "type",
  "tx_hash",
  "token_symbol",
  "token_address",
  "amount",
  "usd_value_at_time",
  "price_usd",
  "price_source",
  "price_date_utc",
  "gauge",
  "lock_id",
] as const

const lineEnd = "\r\n"

/** A start a spreadsheet runs (see the note at the top); `\s` takes in
 * the ideographic space too. */
const formulaStart = /^(?:[\t\r\n]|\s*[=+\-@＝＋－＠])/

/** One cell, guarded and quoted as RFC 4180 asks. */
export function csvCell(value: string): string {
  const guarded = formulaStart.test(value) ? `'${value}` : value
  return /[",\r\n]|^\s|\s$/.test(guarded)
    ? `"${guarded.replaceAll('"', '""')}"`
    : guarded
}

function line(cells: readonly string[]): string {
  return `${cells.map(csvCell).join(",")}${lineEnd}`
}

export const historyCsvHeader = line(historyCsvColumns)

/** UTF-8's byte order mark: Excel then reads the file as UTF-8. */
export const historyCsvBom = String.fromCharCode(0xfeff)

/** What a file starts with: the byte order mark, then the header. */
export const historyCsvStart = `${historyCsvBom}${historyCsvHeader}`

function isoUtc(seconds: number): string {
  return `${new Date(seconds * 1000).toISOString().slice(0, 19)}Z`
}

function epochOf(seconds: number): string {
  return seconds < EPOCH_ZERO_START
    ? ""
    : String(epochIndexFor(epochStartOf(seconds)))
}

/**
 * The epoch Pro shows for a row: a claim's is the epoch it paid out (the
 * one before it was claimed in), a vote's and an incentive's the epoch
 * they are for, anything else the epoch it happened in. Numbered from the
 * epoch's start, never a stored index.
 */
function shownEpoch(row: ActivityRow): string {
  switch (row.type) {
    case "claim":
      return row.epoch === null
        ? epochOf(row.timestamp)
        : epochOf(row.epoch.start)
    case "vote":
    case "incentive":
      return epochOf(row.epoch.start)
    default:
      return epochOf(row.timestamp)
  }
}

function lockLabel(lock: LockRef): string {
  return `${lock.escrow === "vebtc" ? "veBTC" : "veMEZO"} #${lock.tokenId}`
}

function joined(values: readonly string[]): string {
  return [...new Set(values)].join(" | ")
}

type Valued = {
  usd: string
  price: string
  source: string
  date: string
}

const notValued: Valued = { usd: "", price: "", source: "", date: "" }

/** Every `price_source` a line can carry (the Pro docs list them all). */
export const historyCsvPriceSources = {
  peg: "USD peg",
  daily: "CoinGecko daily",
  btcDaily: "CoinGecko daily, BTC price",
  none: "No price",
  estimate: "Estimate, not final",
  pending: "Not priced yet",
} as const

const sources = historyCsvPriceSources

function sourceLabel(value: ClaimTokenValue, symbol: string): string {
  switch (value.source) {
    case "usd-peg":
      return sources.peg
    case "coingecko":
      // A BTC wrapper takes BTC's price.
      return value.pricedAs === "btc" && symbol !== "BTC"
        ? sources.btcDaily
        : sources.daily
    default:
      return sources.none
  }
}

/**
 * A claimed token's value when claimed, by address, else by position. An
 * estimate whose day to be final has passed (a stored row the fill has not
 * reached) is not one any more: the claim is not priced yet.
 */
function claimValue(
  row: Extract<ActivityRow, { type: "claim" }>,
  amount: TokenAmount,
  index: number,
  today: string,
): Valued {
  if (row.atClaim === undefined) {
    // Settling: the estimate, said to be one. Its price is not a day's.
    const current =
      row.estimate !== undefined && row.estimate.finalOn >= today
        ? row.estimate
        : undefined
    const estimate = current?.tokens[index]
    if (estimate === undefined) {
      return { ...notValued, source: sources.pending }
    }
    return {
      usd: estimate.usd ?? "",
      price: estimate.price ?? "",
      source: estimate.price === null ? sources.none : sources.estimate,
      date: "",
    }
  }
  const address = amount.token.address.toLowerCase()
  const value =
    row.atClaim.tokens.find((each) => each.token === address) ??
    row.atClaim.tokens[index]
  if (value === undefined) return { ...notValued, source: sources.none }
  return {
    usd: value.usd ?? "",
    price: value.price ?? "",
    source: sourceLabel(value, amount.token.symbol),
    date: value.price === null ? "" : `${value.day}T00:00:00Z`,
  }
}

type Parts = {
  tokens: { amount: TokenAmount; valued: Valued }[]
  gauge: string
  lock: string
}

function partsOf(row: ActivityRow, today: string): Parts {
  switch (row.type) {
    case "claim":
      return {
        tokens: row.rewards.tokens.map((amount, index) => ({
          amount,
          valued: claimValue(row, amount, index, today),
        })),
        gauge: joined(row.gauges.map((gauge) => gauge.name)),
        lock: joined(row.locks.map(lockLabel)),
      }
    case "vote":
      return {
        tokens: [],
        gauge: joined(
          row.allocations.map((allocation) => allocation.gauge.name),
        ),
        lock: lockLabel(row.lock),
      }
    case "lock-create":
    case "lock-add":
    case "lock-withdraw":
      return {
        tokens: [{ amount: row.amount, valued: notValued }],
        gauge: "",
        lock: lockLabel(row.lock),
      }
    case "lock-extend":
      return { tokens: [], gauge: "", lock: lockLabel(row.lock) }
    case "lock-merge":
      return {
        tokens: [{ amount: row.amount, valued: notValued }],
        gauge: "",
        lock: `${lockLabel(row.from)} into ${lockLabel(row.into)}`,
      }
    case "incentive":
      return {
        tokens: [{ amount: row.amount, valued: notValued }],
        gauge: row.gauge.name,
        lock: "",
      }
    case "boost":
      return { tokens: [], gauge: row.gauge.name, lock: lockLabel(row.lock) }
    case "boost-refresh":
      return { tokens: [], gauge: "", lock: "" }
  }
}

/**
 * A row's lines: one a token, or one without a token. `nowSeconds` is when
 * the file is made: an estimate is shown only until its day to be final.
 */
export function historyCsvLines(row: ActivityRow, nowSeconds: number): string {
  const today = new Date(nowSeconds * 1000).toISOString().slice(0, 10)
  const parts = partsOf(row, today)
  const base = [
    isoUtc(row.timestamp),
    shownEpoch(row),
    // A claim also says the epoch it was claimed in, one after the epoch
    // it paid out.
    row.type === "claim" ? epochOf(row.timestamp) : "",
    row.type,
    row.txHash,
  ]
  const tail = [parts.gauge, parts.lock]
  if (parts.tokens.length === 0) {
    return line([...base, "", "", "", "", "", "", "", ...tail])
  }
  return parts.tokens
    .map(({ amount, valued }) =>
      line([
        ...base,
        amount.token.symbol,
        amount.token.address.toLowerCase(),
        amount.amount,
        valued.usd,
        valued.price,
        valued.source,
        valued.date,
        ...tail,
      ]),
    )
    .join("")
}

/**
 * The file's last line when it is not the whole history: rows not stored
 * yet, or more rows than one file holds.
 */
export function historyCsvNote(
  reason: { kind: "pending" } | { kind: "capped"; rows: number },
): string {
  return line([
    reason.kind === "pending"
      ? "Note: history still being added. Older rows are not in this file yet."
      : `Note: this file stops at ${reason.rows} rows. Older rows are not in it.`,
  ])
}

/** `matchbox-0x50d4-c139-rewards-2026-11-20.csv` */
export function historyCsvFileName(
  wallet: string,
  kind: HistoryCsvKind,
  nowSeconds: number,
): string {
  const lower = wallet.toLowerCase()
  const short = `${lower.slice(0, 6)}-${lower.slice(-4)}`
  const date = new Date(nowSeconds * 1000).toISOString().slice(0, 10)
  return `matchbox-${short}-${kind}-${date}.csv`
}
