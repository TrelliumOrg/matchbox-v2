import { useSyncExternalStore } from "react"
import type { ActivityEvent } from "../data/view-models"

/**
 * The transactions this browser sent from Pro, until the indexer has them.
 *
 * Activity comes from the indexer, which sees a transaction a little after
 * it is mined and never sees one that reverted as an activity row. So the
 * step someone just signed was missing from Activity while it confirmed,
 * and a reverted one never appeared at all. Each submitted step is noted
 * here with its hash and label, and Activity lists it above the indexed
 * rows: "Confirming" while it waits for a block, then confirmed until the
 * indexed row with the same hash arrives and replaces it, or "Reverted".
 *
 * Kept in this browser (localStorage, every access in try/catch), per
 * wallet, newest first, and pruned by age so the list cannot grow.
 */

export type OwnTx = {
  hash: string
  /** Lower-case address that sent it. */
  wallet: string
  /** The signing step's label, for example "Vote with #2207". */
  label: string
  /** Unix seconds when it was submitted. */
  at: number
  status: "confirming" | "confirmed" | "reverted"
}

export const ownTxStorageKey = "mbx-own-txs"

const limit = 40
/** A confirmed one waits this long for its indexed row, then goes. */
const confirmedSeconds = 15 * 60
/** A transaction still unconfirmed after this was dropped or replaced. */
const confirmingSeconds = 60 * 60
/** A reverted one stays a day: it is the only record of the attempt. */
const revertedSeconds = 24 * 60 * 60

const maxAge = {
  confirming: confirmingSeconds,
  confirmed: confirmedSeconds,
  reverted: revertedSeconds,
} as const

const hashPattern = /^0x[0-9a-f]{64}$/
const walletPattern = /^0x[0-9a-f]{40}$/

function isOwnTx(value: unknown): value is OwnTx {
  if (typeof value !== "object" || value === null) return false
  const hash: unknown = Reflect.get(value, "hash")
  const wallet: unknown = Reflect.get(value, "wallet")
  const label: unknown = Reflect.get(value, "label")
  const at: unknown = Reflect.get(value, "at")
  const status: unknown = Reflect.get(value, "status")
  return (
    typeof hash === "string" &&
    hashPattern.test(hash) &&
    typeof wallet === "string" &&
    walletPattern.test(wallet) &&
    typeof label === "string" &&
    label.length > 0 &&
    label.length <= 120 &&
    typeof at === "number" &&
    Number.isFinite(at) &&
    (status === "confirming" || status === "confirmed" || status === "reverted")
  )
}

/** Reads a stored list without trusting it. */
export function parseOwnTxs(raw: string | null): OwnTx[] {
  if (raw === null) return []
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return []
  }
  return Array.isArray(value) ? value.filter(isOwnTx).slice(0, limit) : []
}

/** Drops what is too old for its status. */
export function pruned(list: readonly OwnTx[], now: number): OwnTx[] {
  return list.filter((tx) => now - tx.at <= maxAge[tx.status])
}

/** `list` with a newly submitted transaction first. */
export function submitted(
  list: readonly OwnTx[],
  tx: { hash: string; wallet: string; label: string },
  now: number,
): OwnTx[] {
  const hash = tx.hash.toLowerCase()
  const wallet = tx.wallet.toLowerCase()
  if (!hashPattern.test(hash) || !walletPattern.test(wallet)) return [...list]
  return [
    { hash, wallet, label: tx.label, at: now, status: "confirming" as const },
    ...list.filter((entry) => entry.hash !== hash),
  ].slice(0, limit)
}

/** `list` with one transaction's outcome recorded. */
export function settled(
  list: readonly OwnTx[],
  hash: string,
  status: "confirmed" | "reverted",
): OwnTx[] {
  const id = hash.toLowerCase()
  return list.map((tx) => (tx.hash === id ? { ...tx, status } : tx))
}

/**
 * A wallet's own transactions as Activity rows, leaving out any the
 * indexer already lists (`indexed`, by transaction hash).
 */
export function ownEvents(
  list: readonly OwnTx[],
  wallet: string,
  indexed: readonly ActivityEvent[],
  epochOf: (at: number) => number,
): ActivityEvent[] {
  const known = new Set(indexed.map((event) => event.tx.toLowerCase()))
  const owner = wallet.toLowerCase()
  return list
    .filter((tx) => tx.wallet === owner && !known.has(tx.hash))
    .map((tx) => ({
      id: `own-${tx.hash}`,
      status: tx.status,
      at: tx.at,
      epoch: epochOf(tx.at),
      block: null,
      tx: tx.hash,
      detail: { kind: "own" as const, label: tx.label },
    }))
}

const none: readonly OwnTx[] = []
let current: readonly OwnTx[] | null = null
const listeners = new Set<() => void>()

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage
  } catch {
    return null
  }
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

export function getOwnTxs(): readonly OwnTx[] {
  if (current !== null) return current
  try {
    current = pruned(
      parseOwnTxs(storage()?.getItem(ownTxStorageKey) ?? null),
      nowSeconds(),
    )
  } catch {
    current = none
  }
  return current
}

function write(next: readonly OwnTx[]): void {
  current = pruned(next, nowSeconds())
  try {
    storage()?.setItem(ownTxStorageKey, JSON.stringify(current))
  } catch {
    // Kept for this tab only.
  }
  for (const listener of listeners) listener()
}

/** A step was sent to the chain. */
export function noteSubmitted(tx: {
  hash: string
  wallet: string
  label: string
}): void {
  write(submitted(getOwnTxs(), tx, nowSeconds()))
}

/** A submitted step was mined, successfully or not. */
export function noteSettled(
  hash: string,
  status: "confirmed" | "reverted",
): void {
  write(settled(getOwnTxs(), hash, status))
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Empty on the server and during hydration. */
export function useOwnTxs(): readonly OwnTx[] {
  return useSyncExternalStore(subscribe, getOwnTxs, () => none)
}

/** For tests: read storage again. */
export function resetOwnTxs(): void {
  current = null
  for (const listener of listeners) listener()
}
