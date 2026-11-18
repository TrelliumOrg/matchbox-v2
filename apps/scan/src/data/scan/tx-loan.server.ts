import type { ScanLockItem } from "@matchbox/contracts/scan"
import { canonicalQuery } from "../caller.server"
import type { Section } from "../explorer"
import { readScan } from "./read.server"
import { scanSchemas } from "./schemas"
import {
  enclaveTxLoan,
  type LoanRef,
  type MorphoHeld,
  morphoTxLoan,
  othersText,
  type TxLoanView,
  troveTxLoan,
} from "./tx-loan"

/**
 * A loan transaction's position, read through the position's own routes
 * (trove, Enclave position, Morpho position events): the first position
 * the logs name whose events include this transaction, with how many
 * others of its kind the logs name. One round for the events and the
 * live row, one more for an Enclave's current locks.
 * `null` when the transaction moved no loan Scan knows.
 */

/** Events read per position: the API's largest page. */
const eventLimit = 100
/** Locks read at most. */
const lockLimit = 4
/** Positions tried per transaction (a liquidation can name several). */
const refLimit = 2

function failed(status: string): Section<TxLoanView> {
  if (status === "rate-limited") return { status: "rate-limited" }
  if (status === "disabled") return { status: "disabled" }
  return { status: "unavailable" }
}

async function troveLoan(
  hash: string,
  borrower: string,
  others: string | null,
): Promise<Section<TxLoanView> | null> {
  const [events, trove] = await Promise.all([
    readScan(
      `borrow/troves/${borrower}/events`,
      canonicalQuery({ limit: eventLimit }),
      scanSchemas.troveEventPage,
    ),
    readScan(
      `borrow/troves/${borrower}`,
      new URLSearchParams(),
      scanSchemas.trove,
    ),
  ])
  if (events.status !== "ok") {
    return events.status === "missing" ? null : failed(events.status)
  }
  const view = troveTxLoan(
    hash,
    events.data.data,
    trove.status === "ok" ? trove.data.data : null,
    events.data.nextCursor !== null,
    others,
  )
  return view === null ? null : { status: "ok", data: view }
}

async function enclaveLoan(
  hash: string,
  position: string,
  others: string | null,
): Promise<Section<TxLoanView> | null> {
  const events = await readScan(
    `borrow/enclave/positions/${position}/events`,
    canonicalQuery({ limit: eventLimit }),
    scanSchemas.enclaveEventPage,
  )
  if (events.status !== "ok") {
    return events.status === "missing" ? null : failed(events.status)
  }
  const rows = events.data.data
  if (!rows.some((event) => event.tx_hash === hash)) return null
  // The position's current locks, for "Collateral now". What this
  // transaction pledged is named by id only (its amounts then are not in
  // the events), so its own locks need no read.
  const ids = (rows[0]?.pledged_ve_btc ?? []).slice(0, lockLimit)
  const reads = await Promise.all(
    ids.map((id) =>
      readScan(`locks/vebtc/${id}`, new URLSearchParams(), scanSchemas.lock),
    ),
  )
  const locks: ScanLockItem[] = reads.flatMap((read) =>
    read.status === "ok" ? [read.data.data] : [],
  )
  const view = enclaveTxLoan(
    hash,
    position,
    rows,
    locks,
    events.data.nextCursor !== null,
    others,
  )
  return view === null ? null : { status: "ok", data: view }
}

async function morphoLoan(
  hash: string,
  ref: { market: string; account: string },
  others: string | null,
): Promise<Section<TxLoanView> | null> {
  const [events, owner, market] = await Promise.all([
    readScan(
      `borrow/markets/${ref.market}/positions/${ref.account}/events`,
      canonicalQuery({ limit: eventLimit }),
      scanSchemas.morphoEventPage,
    ),
    readScan(
      `borrow/owners/${ref.account}`,
      new URLSearchParams(),
      scanSchemas.borrowOwner,
    ),
    readScan(
      `borrow/markets/${ref.market}`,
      new URLSearchParams(),
      scanSchemas.market,
    ),
  ])
  if (events.status !== "ok") {
    return events.status === "missing" ? null : failed(events.status)
  }
  const held: MorphoHeld =
    owner.status === "ok"
      ? {
          status: "ok",
          position:
            owner.data.data.morpho.find(
              (each) => each.market_id === ref.market,
            ) ?? null,
        }
      : { status: "failed" }
  const view = morphoTxLoan(
    hash,
    ref,
    events.data.data,
    held,
    market.status === "ok" ? market.data.data : null,
    events.data.nextCursor !== null,
    others,
  )
  return view === null ? null : { status: "ok", data: view }
}

function oneLoan(
  hash: string,
  ref: LoanRef,
  others: string | null,
): Promise<Section<TxLoanView> | null> {
  if (ref.kind === "trove") return troveLoan(hash, ref.borrower, others)
  if (ref.kind === "enclave") return enclaveLoan(hash, ref.position, others)
  return morphoLoan(hash, ref, others)
}

export async function txLoan(
  hash: string,
  refs: readonly LoanRef[],
): Promise<Section<TxLoanView> | null> {
  const reads = await Promise.all(
    refs
      .slice(0, refLimit)
      .map((ref) => oneLoan(hash, ref, othersText(refs, ref.kind))),
  )
  return (
    reads.find((read) => read?.status === "ok") ??
    reads.find((read) => read !== null) ??
    null
  )
}
