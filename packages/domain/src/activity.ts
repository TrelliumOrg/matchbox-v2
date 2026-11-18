import { BORROW_CONTRACTS, CONTRACTS } from "@matchbox/chain"

/**
 * Plain-words sentences for decoded activity rows (matchbox-scan
 * `activity`, `@matchbox/contracts/scan` ScanActivityItem), keyed by the
 * row's action type, falling back to Blockscout's decoded method when the
 * row has no sentence of its own. Shared by Matchscan, Pro and Stuart.
 *
 * A sentence is a list of segments, so each product links what it can (a
 * lock, a gauge, an address) and formats amounts its own way; `sentenceText`
 * renders it as text, for Stuart and for accessible names. Pure: no
 * formatting of money here beyond what a segment carries, no I/O.
 */

/** The fields of an activity row a sentence reads. */
export type ActivityInput = {
  action_type: string
  /** Unix seconds. */
  timestamp: number
  epoch_start: number
  actor: string | null
  recipient: string | null
  lock_escrow: string | null
  token_id: string | null
  /** Base units of `token`. */
  amount: string | null
  token: string | null
  gauge: string | null
  pool: string | null
  /** Vote weight, base units (18 decimals). */
  weight: string | null
  /** Decoded extra fields: decimal strings and flags. */
  extra: Readonly<Record<string, string | boolean>>
}

export type Escrow = "vebtc" | "vemezo"

export type SentenceSegment =
  | { kind: "text"; text: string }
  /** A token amount in base units; `token` null when unknown. */
  | { kind: "amount"; amount: string; token: string | null }
  /** Voting power in the lock's unit (veBTC or veMEZO), 18 decimals. */
  | { kind: "votes"; weight: string; escrow: Escrow | null }
  | { kind: "lock"; escrow: Escrow | null; id: string }
  | { kind: "gauge"; address: string }
  | { kind: "pool"; address: string }
  | { kind: "address"; address: string }
  | { kind: "epoch"; start: number }
  /** A date, unix seconds. */
  | { kind: "date"; at: number }
  /** A contract method name from the chain (untrusted text). */
  | { kind: "method"; name: string }

export type ActivitySentence = {
  /** The action type it was built from, or "method" for the fallback. */
  key: string
  segments: SentenceSegment[]
}

const escrows: Readonly<Record<string, Escrow>> = {
  [CONTRACTS.mainnet.veBTC.toLowerCase()]: "vebtc",
  [CONTRACTS.mainnet.veMEZO.toLowerCase()]: "vemezo",
  [CONTRACTS.testnet.veBTC.toLowerCase()]: "vebtc",
  [CONTRACTS.testnet.veMEZO.toLowerCase()]: "vemezo",
}

/** veBTC or veMEZO for a voting-escrow address; null for any other. */
export function escrowOf(address: string | null): Escrow | null {
  if (address === null) return null
  return escrows[address.toLowerCase()] ?? null
}

const text = (value: string): SentenceSegment => ({ kind: "text", text: value })

function extraString(row: ActivityInput, key: string): string | null {
  const value = row.extra[key]
  return typeof value === "string" ? value : null
}

function lockOf(row: ActivityInput, id = row.token_id): SentenceSegment[] {
  if (id === null) return []
  return [{ kind: "lock", escrow: escrowOf(row.lock_escrow), id }]
}

/**
 * What each escrow locks: veBTC BTC, veMEZO MEZO (Mezo precompiles, one
 * address on mainnet and testnet).
 */
const lockedTokens: Readonly<Record<Escrow, string>> = {
  vebtc: BORROW_CONTRACTS.mainnet.btc.toLowerCase(),
  vemezo: CONTRACTS.mainnet.mezoToken.toLowerCase(),
}

/**
 * The token of a row's amount. An escrow's own rows (LOCK_*) name no
 * token, since the indexer never records one for them: their amount is
 * always the escrow's locked token.
 */
function tokenOf(row: ActivityInput): string | null {
  if (row.token !== null) return row.token
  if (!row.action_type.startsWith("LOCK_")) return null
  const escrow = escrowOf(row.lock_escrow)
  return escrow === null ? null : lockedTokens[escrow]
}

function amountOf(row: ActivityInput): SentenceSegment[] {
  if (row.amount === null) return []
  return [{ kind: "amount", amount: row.amount, token: tokenOf(row) }]
}

const mezoToken = CONTRACTS.mainnet.mezoToken.toLowerCase()
const musdToken = BORROW_CONTRACTS.mainnet.musd.toLowerCase()

/**
 * The amount in a token the row's source always pays in, where the
 * indexer records none: gauge emissions, rebases and Mezo's reward
 * distributions in MEZO, MUSD savings in MUSD.
 */
function amountIn(row: ActivityInput, token: string): SentenceSegment[] {
  if (row.amount === null) return []
  return [{ kind: "amount", amount: row.amount, token: row.token ?? token }]
}

function poolOf(row: ActivityInput): SentenceSegment[] {
  return row.pool === null ? [] : [{ kind: "pool", address: row.pool }]
}

/** A preposition and a gauge or pool, or nothing without one. */
function toPlace(word: string, place: SentenceSegment[]): SentenceSegment[] {
  return place.length === 0 ? [] : [text(word), text(" "), ...place]
}

function gaugeOf(row: ActivityInput): SentenceSegment[] {
  return row.gauge === null ? [] : [{ kind: "gauge", address: row.gauge }]
}

/** Joins parts with spaces, dropping empty ones. */
/**
 * A preposition and the lock it leads to ("on veBTC #604"), or nothing when
 * the row names no lock: a sentence never ends on a dangling "on".
 */
function toLock(
  word: string,
  row: ActivityInput,
  lock: SentenceSegment[] = lockOf(row),
): SentenceSegment[] {
  return lock.length === 0 ? [] : [text(word), text(" "), ...lock]
}

/**
 * The lock a poke recalculated: its own lock when the row has one, else
 * the BoostVoter's `boostableTokenId` (always a veBTC lock), which the
 * indexer keeps in `extra` rather than in `token_id`.
 */
function pokedLock(row: ActivityInput): SentenceSegment[] {
  if (row.token_id !== null) return lockOf(row)
  const boostable = extraString(row, "boostable_token_id")
  return boostable === null
    ? []
    : [{ kind: "lock", escrow: "vebtc", id: boostable }]
}

function words(
  ...parts: (SentenceSegment | SentenceSegment[] | null)[]
): SentenceSegment[] {
  const out: SentenceSegment[] = []
  for (const part of parts) {
    if (part === null) continue
    const list = Array.isArray(part) ? part : [part]
    if (list.length === 0) continue
    if (out.length > 0) out.push(text(" "))
    out.push(...list)
  }
  return out
}

/** "until Thu 2 Mar 2028" for a lock whose new duration is known. */
function until(row: ActivityInput): SentenceSegment[] {
  const duration = extraString(row, "post_duration")
  if (duration === null || !/^[0-9]+$/.test(duration)) return []
  return [
    text("until"),
    text(" "),
    { kind: "date", at: row.timestamp + Number(duration) },
  ]
}

/**
 * `viewer`: the address whose list the sentence is in, if any; a
 * two-sided row (a lock transfer) reads from that side.
 */
type Builder = (
  row: ActivityInput,
  viewer: string | null,
) => SentenceSegment[] | null

const builders: Readonly<Record<string, Builder>> = {
  LOCK_CREATED: (row) =>
    row.amount === null
      ? null
      : words(
          text("Locked"),
          amountOf(row),
          lockOf(row).length > 0 ? text("in") : null,
          lockOf(row),
        ),
  LOCK_AMOUNT_INCREASED: (row) =>
    row.amount === null
      ? null
      : words(text("Added"), amountOf(row), toLock("to", row)),
  LOCK_EXTENDED: (row) => words(text("Extended"), lockOf(row), until(row)),
  LOCK_PERMANENT: (row) => words(text("Set"), lockOf(row), text("to auto max")),
  LOCK_PERMANENT_UNLOCKED: (row) =>
    words(text("Turned off auto max"), toLock("on", row)),
  LOCK_MERGED: (row) => {
    const from = extraString(row, "merge_source_token_id") ?? row.token_id
    const into = extraString(row, "merge_dest_token_id")
    if (from === null || into === null) return null
    return words(
      text("Merged"),
      lockOf(row, from),
      text("into"),
      lockOf(row, into),
    )
  },
  LOCK_WITHDRAWN: (row) =>
    words(text("Withdrew"), amountOf(row), toLock("from", row)),
  BOOST_VOTE: (row) => {
    const votes: SentenceSegment[] =
      row.weight === null
        ? []
        : [
            {
              kind: "votes",
              weight: row.weight,
              escrow: escrowOf(row.lock_escrow),
            },
          ]
    return words(
      text("Voted"),
      votes,
      row.gauge === null ? null : text("for"),
      gaugeOf(row),
      lockOf(row).length > 0 ? text("with") : null,
      lockOf(row),
    )
  },
  BOOST_ABSTAIN: (row) => words(text("Reset votes"), toLock("on", row)),
  BOOST_POKE: (row) =>
    words(text("Refreshed votes"), toLock("on", row, pokedLock(row))),
  VOTE_BRIBE_CLAIMED: (row) =>
    words(
      text("Claimed"),
      amountOf(row),
      text("in incentives"),
      lockOf(row).length > 0 ? text("for") : null,
      lockOf(row),
    ),
  VOTE_FEE_CLAIMED: (row) =>
    words(
      text("Claimed"),
      amountOf(row),
      text("in fees"),
      lockOf(row).length > 0 ? text("for") : null,
      lockOf(row),
    ),
  INCENTIVE_ADDED: (row) =>
    words(
      text("Added"),
      amountOf(row),
      text("in incentives"),
      row.gauge === null ? null : text("to"),
      gaugeOf(row),
    ),
  GAUGE_KILLED: (row) =>
    row.gauge === null ? null : words(text("Stopped gauge"), gaugeOf(row)),
  GAUGE_REVIVED: (row) =>
    row.gauge === null ? null : words(text("Revived gauge"), gaugeOf(row)),
  POOL_CREATED: (row) =>
    row.pool === null
      ? null
      : words(text("Created pool"), { kind: "pool", address: row.pool }),
  SWAP: (row) =>
    words(
      text("Swapped"),
      amountOf(row),
      row.pool === null ? null : text("in"),
      row.pool === null ? null : { kind: "pool", address: row.pool },
    ),
  EPOCH_PROCESSED: (row) =>
    words(text("Started"), { kind: "epoch", start: row.epoch_start }),
  // Pools and their gauges. A pool's two amounts are in its own tokens,
  // which the row does not name, and staked amounts are LP tokens.
  LP_ADDED: (row) => words(text("Added liquidity"), toPlace("to", poolOf(row))),
  LP_REMOVED: (row) =>
    words(text("Removed liquidity"), toPlace("from", poolOf(row))),
  LP_STAKED: (row) =>
    words(text("Staked liquidity"), toPlace("in", gaugeOf(row))),
  LP_UNSTAKED: (row) =>
    words(text("Unstaked liquidity"), toPlace("from", gaugeOf(row))),
  // A gauge paying its staker (reward type Gauge), or a voter sending a
  // gauge its emissions.
  REWARD_DISTRIBUTED: (row) =>
    row.amount === null
      ? null
      : extraString(row, "reward_type") === "Gauge"
        ? words(
            text("Claimed"),
            amountIn(row, mezoToken),
            toPlace("from", gaugeOf(row)),
          )
        : words(
            text("Distributed"),
            amountIn(row, mezoToken),
            text("in emissions"),
            toPlace("to", gaugeOf(row)),
          ),
  REBASE_CLAIMED: (row) =>
    row.amount === null
      ? null
      : words(
          text("Claimed"),
          amountIn(row, mezoToken),
          text("in rebase"),
          toLock("for", row),
        ),
  MERKLE_CLAIMED: (row) =>
    row.amount === null
      ? null
      : words(text("Claimed"), amountIn(row, mezoToken), text("in rewards")),
  SAVINGS_DEPOSIT: (row) =>
    row.amount === null
      ? null
      : words(text("Deposited"), amountIn(row, musdToken), text("in savings")),
  SAVINGS_WITHDRAW: (row) =>
    row.amount === null
      ? null
      : words(text("Withdrew"), amountIn(row, musdToken), text("from savings")),
  SAVINGS_YIELD_CLAIMED: (row) =>
    row.amount === null
      ? null
      : words(
          text("Claimed"),
          amountIn(row, musdToken),
          text("in savings yield"),
        ),
  PROTOCOL_YIELD_RECEIVED: (row) =>
    row.amount === null
      ? null
      : words(
          text("Savings received"),
          amountIn(row, musdToken),
          text("in protocol yield"),
        ),
  PCV_DISTRIBUTION: (row) =>
    row.amount === null
      ? null
      : words(
          text("Protocol sent"),
          amountIn(row, musdToken),
          row.recipient === null
            ? null
            : [
                text("to"),
                text(" "),
                { kind: "address", address: row.recipient },
              ],
        ),
  PCV_DEBT_PAYMENT: (row) =>
    row.amount === null
      ? null
      : words(
          text("Protocol repaid"),
          amountIn(row, musdToken),
          text("of debt"),
        ),
  // The indexer keeps the new owner as the actor, the old as recipient.
  // On the new owner's own list it was received from the old one.
  LOCK_TRANSFERRED: (row, viewer) => {
    if (lockOf(row).length === 0) return null
    const received =
      viewer !== null &&
      row.actor !== null &&
      row.actor.toLowerCase() === viewer.toLowerCase()
    if (received) {
      return words(
        text("Received"),
        lockOf(row),
        row.recipient === null
          ? null
          : [
              text("from"),
              text(" "),
              { kind: "address", address: row.recipient },
            ],
      )
    }
    return words(
      text("Transferred"),
      lockOf(row),
      row.actor === null
        ? null
        : [text("to"), text(" "), { kind: "address", address: row.actor }],
    )
  },
  LOCK_BOOST_UPDATED: (row) =>
    lockOf(row).length === 0
      ? null
      : words(text("Updated boost"), toLock("on", row)),
  GAUGE_CREATED: (row) =>
    row.gauge === null ? null : words(text("Created gauge"), gaugeOf(row)),
  PAIR_CREATED: (row) =>
    row.gauge === null ? null : words(text("Created gauge"), gaugeOf(row)),
  VALIDATOR_GAUGE_CREATED: (row) =>
    row.gauge === null ? null : words(text("Created gauge"), gaugeOf(row)),
  THIRD_PARTY_GAUGE_CREATED: (row) =>
    row.gauge === null ? null : words(text("Created gauge"), gaugeOf(row)),
}

/** The action types with a sentence of their own. */
export const describedActions: readonly string[] = Object.keys(builders)

/**
 * The plain-words sentence for an activity row. Without a sentence for its
 * action type (or without the fields that sentence needs), it falls back to
 * the transaction's decoded method ("Called execute"), then to "Contract
 * call".
 */
export function describeActivity(
  row: ActivityInput | null,
  method: string | null = null,
  viewer: string | null = null,
): ActivitySentence {
  const builder = row === null ? undefined : builders[row.action_type]
  const segments =
    builder === undefined || row === null ? null : builder(row, viewer)
  if (segments !== null && segments.length > 0) {
    return { key: row?.action_type ?? "method", segments }
  }
  const name = method?.trim() ?? ""
  return {
    key: "method",
    segments:
      name === ""
        ? [text("Contract call")]
        : [text("Called"), text(" "), { kind: "method", name }],
  }
}

/** How each segment reads as text. Callers name tokens, gauges and dates. */
export type SentenceText = {
  amount: (amount: string, token: string | null) => string
  votes: (weight: string, escrow: Escrow | null) => string
  gauge: (address: string) => string
  pool: (address: string) => string
  address: (address: string) => string
  date: (at: number) => string
  epoch: (start: number) => string
}

const escrowNames: Record<Escrow, string> = { vebtc: "veBTC", vemezo: "veMEZO" }

/** "veBTC #604", or "lock #604" when the escrow is unknown. */
export function lockName(escrow: Escrow | null, id: string): string {
  return `${escrow === null ? "lock" : escrowNames[escrow]} #${id}`
}

/** The sentence as plain text, for Stuart and accessible names. */
export function sentenceText(
  sentence: ActivitySentence,
  names: SentenceText,
): string {
  return sentence.segments
    .map((segment): string => {
      switch (segment.kind) {
        case "text":
          return segment.text
        case "amount":
          return names.amount(segment.amount, segment.token)
        case "votes":
          return names.votes(segment.weight, segment.escrow)
        case "lock":
          return lockName(segment.escrow, segment.id)
        case "gauge":
          return names.gauge(segment.address)
        case "pool":
          return names.pool(segment.address)
        case "address":
          return names.address(segment.address)
        case "epoch":
          return names.epoch(segment.start)
        case "date":
          return names.date(segment.at)
        case "method":
          return segment.name
        default:
          return ""
      }
    })
    .join("")
}
