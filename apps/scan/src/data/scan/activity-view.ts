import type { ScanActivityItem, ScanLabelItem } from "@matchbox/contracts/scan"
import {
  type ActivitySentence,
  describeActivity,
  escrowOf,
  lockName,
  type SentenceText,
  sentenceText,
} from "@matchbox/domain/activity"
import { epochIndexFor } from "@matchbox/domain/epoch"
import {
  formatDate,
  formatVoteAmount,
  formatVotes,
  shortAddress,
} from "@matchbox/domain/format"
import { formatTokenAmount, type TokenLookup } from "./tokens"

/**
 * Activity rows as Scan draws them: the plain-words sentence from
 * `@matchbox/domain/activity`, resolved on the server into parts the page
 * renders and links (a lock, a gauge, an address, an epoch) with every
 * amount already formatted. Names come from our labels (rendered as
 * untrusted text like any chain-supplied string).
 */

export type LabelMap = Readonly<Record<string, ScanLabelItem>>

export type SentencePart =
  | { kind: "text"; text: string }
  /** An amount or voting power, shown strong. */
  | { kind: "figure"; text: string }
  | { kind: "address"; address: string; name: string | null }
  | { kind: "gauge"; address: string; name: string | null }
  | { kind: "lock"; escrow: "vebtc" | "vemezo" | null; id: string }
  | { kind: "epoch"; number: number }
  /** A decoded method name: chain-supplied. */
  | { kind: "method"; name: string }

export type ActivityView = {
  id: string
  txHash: string
  timestamp: number
  block: number
  action: string
  parts: SentencePart[]
  /** The sentence as text, for accessible names. */
  text: string
  actor: string | null
}

export type SentenceContext = {
  tokens: TokenLookup
  labels: LabelMap
  /** The address whose list it is: two-sided rows read from its side. */
  viewer?: string
}

function nameOf(labels: LabelMap, address: string): string | null {
  return labels[address.toLowerCase()]?.name ?? null
}

function textNames(context: SentenceContext): SentenceText {
  return {
    amount: (amount, token) =>
      formatTokenAmount(amount, context.tokens(token)) ?? "tokens",
    votes: (weight, escrow) =>
      escrow === null
        ? formatVotes(weight)
        : formatVoteAmount(weight, escrow === "vebtc" ? "veBTC" : "veMEZO"),
    gauge: (address) =>
      nameOf(context.labels, address) ?? shortAddress(address),
    pool: (address) => nameOf(context.labels, address) ?? shortAddress(address),
    address: (address) =>
      nameOf(context.labels, address) ?? shortAddress(address),
    date: (at) => formatDate(at),
    epoch: (start) => `Epoch ${epochIndexFor(start)}`,
  }
}

/** A sentence's parts, every figure formatted. */
export function sentenceParts(
  sentence: ActivitySentence,
  context: SentenceContext,
): SentencePart[] {
  const names = textNames(context)
  return sentence.segments.map((segment): SentencePart => {
    switch (segment.kind) {
      case "text":
        return { kind: "text", text: segment.text }
      case "amount":
        return {
          kind: "figure",
          text: names.amount(segment.amount, segment.token),
        }
      case "votes":
        return {
          kind: "figure",
          text: names.votes(segment.weight, segment.escrow),
        }
      case "lock":
        return { kind: "lock", escrow: segment.escrow, id: segment.id }
      case "gauge":
        return {
          kind: "gauge",
          address: segment.address,
          name: nameOf(context.labels, segment.address),
        }
      case "pool":
      case "address":
        return {
          kind: "address",
          address: segment.address,
          name: nameOf(context.labels, segment.address),
        }
      case "epoch":
        return { kind: "epoch", number: epochIndexFor(segment.start) }
      case "date":
        return { kind: "text", text: names.date(segment.at) }
      case "method":
        return { kind: "method", name: segment.name }
      default:
        return { kind: "text", text: "" }
    }
  })
}

/** Plain text of parts (accessible names, titles). */
export function partsText(parts: readonly SentencePart[]): string {
  return parts
    .map((part) => {
      switch (part.kind) {
        case "text":
        case "figure":
          return part.text
        case "address":
        case "gauge":
          return part.name ?? shortAddress(part.address)
        case "lock":
          return lockName(part.escrow, part.id)
        case "epoch":
          return `Epoch ${part.number}`
        case "method":
          return part.name
        default:
          return ""
      }
    })
    .join("")
}

export function activityView(
  row: ScanActivityItem,
  context: SentenceContext,
): ActivityView {
  const sentence = describeActivity(row, null, context.viewer ?? null)
  const parts = sentenceParts(sentence, context)
  return {
    id: row.id,
    txHash: row.tx_hash,
    timestamp: row.timestamp,
    block: row.block_number,
    action: row.action_type,
    parts,
    text: sentenceText(sentence, textNames(context)),
    actor: row.actor,
  }
}

/** A run of one transaction's votes with one lock, two gauges or more. */
function voteRunView(
  run: readonly ScanActivityItem[],
  context: SentenceContext,
): ActivityView {
  const first = run[0] as ScanActivityItem
  const names = textNames(context)
  const escrow = escrowOf(first.lock_escrow)
  const total = run.reduce((sum, row) => sum + BigInt(row.weight ?? "0"), 0n)
  const gauges = new Set(run.map((row) => row.gauge?.toLowerCase())).size
  const lock: SentencePart = {
    kind: "lock",
    escrow,
    id: first.token_id ?? "",
  }
  const parts: SentencePart[] = [
    { kind: "text", text: "Voted " },
    { kind: "figure", text: names.votes(total.toString(), escrow) },
    { kind: "text", text: ` for ${gauges} gauges with ` },
    lock,
  ]
  return {
    id: first.id,
    txHash: first.tx_hash,
    timestamp: first.timestamp,
    block: first.block_number,
    action: first.action_type,
    parts,
    text: partsText(parts),
    actor: first.actor,
  }
}

function joinsRun(run: readonly ScanActivityItem[], row: ScanActivityItem) {
  const first = run[0]
  return (
    first !== undefined &&
    first.tx_hash === row.tx_hash &&
    first.token_id === row.token_id &&
    first.lock_escrow === row.lock_escrow
  )
}

function isLockVote(row: ScanActivityItem): boolean {
  return (
    row.action_type === "BOOST_VOTE" &&
    row.token_id !== null &&
    row.weight !== null &&
    row.gauge !== null
  )
}

/**
 * A list's rows, a vote as one row. A vote transaction writes a row per
 * gauge (one lock voting for 18 gauges is 18 rows), so the rows of one
 * transaction's votes with one lock, one after another, read as one:
 * "Voted 22.3676 veBTC for 18 gauges with veBTC #1226", the total and
 * how many gauges. The transaction page keeps every gauge's row.
 */
export function activityViews(
  rows: readonly ScanActivityItem[],
  context: SentenceContext,
): ActivityView[] {
  const views: ActivityView[] = []
  let run: ScanActivityItem[] = []
  const flush = () => {
    const [only] = run
    if (only !== undefined) {
      views.push(
        run.length === 1
          ? activityView(only, context)
          : voteRunView(run, context),
      )
    }
    run = []
  }
  for (const row of rows) {
    if (!isLockVote(row)) {
      flush()
      views.push(activityView(row, context))
    } else if (joinsRun(run, row)) {
      run.push(row)
    } else {
      flush()
      run = [row]
    }
  }
  flush()
  return views
}

/**
 * A transaction's headline: the first decoded row's sentence, else the
 * decoded method's ("Called execute"), else "Contract call".
 */
export function headline(
  rows: readonly ScanActivityItem[],
  method: string | null,
  context: SentenceContext,
): { parts: SentencePart[]; text: string; decoded: boolean } {
  const sentence = describeActivity(rows[0] ?? null, method)
  return {
    parts: sentenceParts(sentence, context),
    text: sentenceText(sentence, textNames(context)),
    decoded: sentence.key !== "method",
  }
}
