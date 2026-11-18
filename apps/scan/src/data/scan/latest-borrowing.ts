import type { ScanBorrowEventItem } from "@matchbox/contracts/scan"
import { formatDay } from "@matchbox/domain/format"
import {
  enclaveAmount,
  enclaveEventView,
  morphoEventView,
  troveEventView,
} from "./borrow-views"
import { formatTokenAmount } from "./tokens"
import type { LoanPositionLink } from "./tx-loan"

/**
 * Home's "Latest borrowing" (`cP_-xnZA8I`): the newest borrow events of
 * every venue (`/borrow/events`), each with its position and the state
 * the event left it in where the event carries it: a trove's collateral
 * and debt, an Enclave position's principal and pledged veBTC. A Morpho
 * event moves one side and carries no position state, so its row says
 * what moved. Health needs the live position and is not shown here.
 */

export type LatestBorrowRow = {
  key: string
  kind: ScanBorrowEventItem["kind"]
  /** Whose position. */
  account: string | null
  /** "MUSD trove", "BTC / mUSDC", "Enclave". */
  venue: string
  link: LoanPositionLink | null
  /** After the event; null where the event does not say. */
  collateral: string | null
  debt: string | null
  status: "Active" | "Closed" | null
  /** "Repaid", "Added collateral". */
  action: string
  /** "-4,000.00 MUSD". */
  detail: string | null
  /** "Sun 8 Nov". */
  day: string
  timestamp: number
  txHash: string
}

const musd = { symbol: "MUSD", decimals: 18 }
const btc = { symbol: "BTC", decimals: 18 }

export function latestBorrowRow(item: ScanBorrowEventItem): LatestBorrowRow {
  const base = {
    kind: item.kind,
    day: formatDay(item.timestamp),
    timestamp: item.timestamp,
    txHash: item.tx_hash,
  }
  if (item.kind === "trove") {
    const view = troveEventView(item)
    const debt = BigInt(item.principal) + BigInt(item.interest)
    const closed = debt === 0n && item.coll === "0"
    return {
      ...base,
      key: view.key,
      account: item.borrower,
      venue: "MUSD trove",
      link: { kind: "trove", owner: item.borrower },
      collateral: formatTokenAmount(item.coll, btc),
      debt: formatTokenAmount(debt.toString(), musd),
      status: closed ? "Closed" : "Active",
      action: view.action,
      detail: view.detail,
    }
  }
  if (item.kind === "enclave") {
    const view = enclaveEventView(item)
    const closed = item.action === "POSITION_CLOSED"
    const principal = closed ? "0" : item.principal
    return {
      ...base,
      key: view.key,
      account: item.borrower,
      venue: "Enclave",
      link:
        item.position_id === null
          ? null
          : { kind: "enclave", position: item.position_id },
      collateral:
        item.pledged_ve_btc.length === 0
          ? null
          : item.pledged_ve_btc.map((id) => `veBTC #${id}`).join(", "),
      debt: principal === null ? null : formatTokenAmount(principal, musd),
      status: closed ? "Closed" : "Active",
      action: view.action,
      // BTC for the veBTC lock's own events, MUSD otherwise.
      detail: enclaveAmount({ ...item, principal: null }),
    }
  }
  const view = morphoEventView(item)
  return {
    ...base,
    key: view.key,
    account: item.on_behalf,
    venue: view.loan,
    link:
      item.on_behalf === null
        ? null
        : { kind: "morpho", market: item.market_id, account: item.on_behalf },
    collateral: null,
    debt: null,
    status: null,
    action: view.action,
    detail: view.detail,
  }
}
