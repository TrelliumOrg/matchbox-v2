import { isValidAddress } from "@matchbox/domain/checksum"
import {
  groupThousands,
  normalizeHex,
  shortAddress,
  shortHash,
} from "@matchbox/domain/format"
import { maxQueryLength } from "./limits"

/**
 * Search, step 1 (scan-plan.md, The app): what the query is by its shape
 * alone, in the browser, with no request. Every reading that fits is
 * offered, likeliest first, and the API settles the rest:
 *
 * - 32 bytes of hex is a transaction hash or a block hash.
 * - 20 bytes of hex is an address; mixed case must carry a valid EIP-55
 *   checksum. Either may come without "0x".
 * - veBTC and veMEZO are separate escrows whose ids overlap, so "lock 604"
 *   or "#604" offers both, while "veBTC #604" names one.
 * - A bare number can be an epoch, a lock in either escrow or a block.
 */

export type LockEscrow = "vebtc" | "vemezo"

export type SearchTarget =
  | { kind: "tx"; hash: string }
  | { kind: "block-hash"; hash: string }
  | { kind: "address"; address: string }
  | { kind: "block"; height: number }
  | { kind: "epoch"; number: number }
  | { kind: "lock"; escrow: LockEscrow; id: number }

/** What the chain looks like now, to rule readings out. */
export type SearchContext = { head: number; epoch: number }

export { maxQueryLength } from "./limits"

const digits = /^\d{1,12}$/

/** Lock ids stay far below block heights: past this a number is a block. */
const maxLockId = 1_000_000

/** A whole number, allowing "13,078,795" and "13 078 795". */
function wholeNumber(value: string): number | null {
  const bare = value.replace(/[,_\s]/g, "")
  if (!digits.test(bare)) return null
  const parsed = Number(bare)
  return Number.isSafeInteger(parsed) ? parsed : null
}

/** Longest first, so "epoch" wins over "e" and "block" over "b". */
const labels = ["vemezo", "vebtc", "epoch", "block", "lock", "e", "b", "#"]

/**
 * "epoch 47", "e47", "lock #604", "veBTC #604", "block 13078795": the label
 * and what follows it. A prefix test and two trims, so the time is linear
 * in the query (the old single pattern backtracked: 6.5 s on "e", 2,000
 * spaces and "x").
 */
function splitLabel(value: string): { label: string; rest: string } | null {
  const lower = value.toLowerCase()
  const label = labels.find((candidate) => lower.startsWith(candidate))
  if (label === undefined) return null
  let rest = value.slice(label.length).trimStart()
  if (rest.startsWith("#")) rest = rest.slice(1).trimStart()
  return { label, rest }
}

function locks(id: number): SearchTarget[] {
  return [
    { kind: "lock", escrow: "vebtc", id },
    { kind: "lock", escrow: "vemezo", id },
  ]
}

function fromLabel(label: string, value: number): SearchTarget[] {
  switch (label) {
    case "epoch":
    case "e":
      return [{ kind: "epoch", number: value }]
    case "block":
    case "b":
      return [{ kind: "block", height: value }]
    case "vebtc":
      return [{ kind: "lock", escrow: "vebtc", id: value }]
    case "vemezo":
      return [{ kind: "lock", escrow: "vemezo", id: value }]
    default:
      return locks(value)
  }
}

function fromHex(value: string): SearchTarget[] | null {
  const hash = normalizeHex(value, 32)
  if (hash !== null) {
    return [
      { kind: "tx", hash },
      { kind: "block-hash", hash },
    ]
  }
  const address = normalizeHex(value, 20)
  if (address === null) return null
  const typed = /^0[xX]/.test(value) ? `0x${value.slice(2)}` : `0x${value}`
  return isValidAddress(typed) ? [{ kind: "address", address }] : []
}

export function detect(query: string, context: SearchContext): SearchTarget[] {
  if (query.length > maxQueryLength) return []
  const value = query.trim()
  if (value === "") return []
  const hex = fromHex(value)
  if (hex !== null) return hex
  const labelled = splitLabel(value)
  if (labelled !== null) {
    const number = wholeNumber(labelled.rest)
    if (number !== null) return fromLabel(labelled.label, number)
  }
  const number = wholeNumber(value)
  if (number === null) return []
  const readings: SearchTarget[] = []
  if (number <= context.epoch) readings.push({ kind: "epoch", number })
  if (number > 0 && number <= maxLockId) readings.push(...locks(number))
  if (number <= context.head) readings.push({ kind: "block", height: number })
  // A big number is a block first; small ones are epochs and locks first.
  return number > maxLockId ? readings.reverse() : readings
}

export function targetPath(target: SearchTarget): string {
  switch (target.kind) {
    case "tx":
      return `/tx/${target.hash}`
    case "block-hash":
      return `/block/${target.hash}`
    case "address":
      return `/address/${target.address}`
    case "block":
      return `/block/${target.height}`
    case "epoch":
      return `/epochs/${target.number}`
    case "lock":
      return `/locks/${target.escrow}/${target.id}`
  }
}

const escrowNames: Record<LockEscrow, string> = {
  vebtc: "veBTC",
  vemezo: "veMEZO",
}

/** The palette row: a title and the kind of thing it is. */
export function targetLabel(target: SearchTarget): {
  title: string
  detail: string
} {
  switch (target.kind) {
    case "tx":
      return { title: shortHash(target.hash), detail: "Transaction" }
    case "block-hash":
      return { title: shortHash(target.hash), detail: "Block" }
    case "address":
      return { title: shortAddress(target.address), detail: "Address" }
    case "block":
      return {
        title: `Block ${groupThousands(BigInt(target.height))}`,
        detail: "Block",
      }
    case "epoch":
      return { title: `Epoch ${target.number}`, detail: "Epoch" }
    case "lock":
      return {
        title: `${escrowNames[target.escrow]} #${target.id}`,
        detail: `${escrowNames[target.escrow]} lock`,
      }
  }
}
