import type {
  ScanEnclaveEventItem,
  ScanEnclavePositionSummary,
} from "@matchbox/contracts/scan"
import type { Hono } from "hono"
import { z } from "zod"
import { callerOf } from "../blockscout/endpoint"
import type { ApiContext, ApiEnv } from "../context"
import {
  type Page,
  pageParams,
  pathParam,
  queryOf,
  type ScanContext,
  tokenIdParam,
} from "./context"
import { CursorCodec, keyPart } from "./cursor"
import { enclaveItem } from "./items"
import { maxKey, scanQueries } from "./queries"

// /internal/scan/borrow/enclave/positions and /borrow/enclave/locks/{id}:
// Enclave positions summed from their `enclave_events` rows (README,
// "Enclave positions"). Every row of a position carries its principal
// after the event; POSITION_OPENED, DEBT_INCREASED and DEBT_REPAID carry
// the amount minted or repaid (on one row per log). Amounts are MUSD base
// units, summed with bigint. Live debt with interest is not here:
// EnclaveDebtManager accrues it with no event.

/** Event rows one list page reads at most (its positions' histories). */
const rowBudget = 1_000
/** A veBTC's rows read to find its positions, and positions summed. */
const tokenRows = 50
const tokenPositions = 5
/** A position's rows read for the lock lookup. */
const positionRows = 300

const positionCodec = new CursorCodec(
  "enclave-positions",
  z.tuple([keyPart.text]),
)

function sumOf(events: readonly ScanEnclaveEventItem[], action: string) {
  let sum = 0n
  for (const event of events) {
    if (event.action === action && event.amount !== null) {
      sum += BigInt(event.amount)
    }
  }
  return sum
}

function byTokenId(a: string, b: string): number {
  const difference = BigInt(a) - BigInt(b)
  return difference === 0n ? 0 : difference < 0n ? -1 : 1
}

/**
 * A position from its rows, newest first. `whole`: the rows reach back to
 * its first event, so minted, repaid and when it opened are known.
 */
export function enclaveSummary(
  positionId: string,
  newestFirst: readonly ScanEnclaveEventItem[],
  whole: boolean,
): ScanEnclavePositionSummary | null {
  const latest = newestFirst[0]
  if (latest === undefined) return null
  const closed = latest.action === "POSITION_CLOSED"
  const opened = whole
    ? ([...newestFirst]
        .reverse()
        .find((event) => event.action === "POSITION_OPENED") ?? null)
    : null
  const tokens = new Set<string>()
  for (const event of newestFirst) {
    tokens.add(event.ve_btc_token_id)
    for (const token of event.pledged_ve_btc) tokens.add(token)
  }
  return {
    position_id: positionId,
    enclave: latest.enclave,
    borrower:
      latest.borrower ??
      newestFirst.find((event) => event.borrower !== null)?.borrower ??
      null,
    status: closed ? "closed" : "open",
    principal: closed
      ? "0"
      : (newestFirst.find((event) => event.principal !== null)?.principal ??
        null),
    minted: whole
      ? (
          sumOf(newestFirst, "POSITION_OPENED") +
          sumOf(newestFirst, "DEBT_INCREASED")
        ).toString()
      : null,
    repaid: whole ? sumOf(newestFirst, "DEBT_REPAID").toString() : null,
    pledged_ve_btc: closed ? [] : [...latest.pledged_ve_btc].sort(byTokenId),
    ve_btc_token_ids: [...tokens].sort(byTokenId),
    opened:
      opened === null
        ? null
        : {
            block_number: opened.block_number,
            timestamp: opened.timestamp,
            tx_hash: opened.tx_hash,
          },
    latest: {
      block_number: latest.block_number,
      timestamp: latest.timestamp,
      tx_hash: latest.tx_hash,
      action: latest.action,
    },
    complete: whole,
  }
}

/**
 * One page of positions in position id order. Reads up to `rowBudget`
 * rows after the cursor's position: a position whose rows the budget cut
 * is left to the next page, unless it is the page's only one, which is
 * then summed from the rows read (`complete` false) and stepped past.
 */
export async function enclavePositionsPage(
  scan: ScanContext,
  cursor: string | undefined,
  limit: number,
): Promise<Page<ScanEnclavePositionSummary>> {
  const key = positionCodec.decode(cursor)
  const raws = await scan.rows(scanQueries.enclavePositionEvents, [
    key?.[0] ?? "",
    rowBudget + 1,
  ])
  const more = raws.length > rowBudget
  const { rows, skipped } = scan.mapRows(raws.slice(0, rowBudget), enclaveItem)
  const groups: { id: string; events: ScanEnclaveEventItem[] }[] = []
  for (const row of rows) {
    if (row.position_id === null) continue
    const last = groups.at(-1)
    if (last !== undefined && last.id === row.position_id) {
      last.events.push(row)
    } else {
      groups.push({ id: row.position_id, events: [row] })
    }
  }
  let kept = groups
  let cut = false
  let next: string | null = null
  if (groups.length > limit) {
    kept = groups.slice(0, limit)
    next = kept.at(-1)?.id ?? null
  } else if (more) {
    if (groups.length > 1) kept = groups.slice(0, -1)
    else cut = true
    next = kept.at(-1)?.id ?? null
  }
  const data = kept.flatMap((group, index) => {
    const whole = !(cut && index === kept.length - 1)
    const summary = enclaveSummary(group.id, group.events, whole)
    return summary === null ? [] : [summary]
  })
  return {
    data,
    nextCursor: next === null ? null : positionCodec.encode([next]),
    meta: { skipped },
  }
}

/** The positions a veBTC has been pledged to, newest first. */
export async function enclavePositionsOfLock(
  scan: ScanContext,
  tokenId: string,
): Promise<{
  positions: ScanEnclavePositionSummary[]
  skipped: number
}> {
  const raws = await scan.rows(scanQueries.enclaveByToken, [
    tokenId,
    maxKey,
    maxKey,
    "",
    tokenRows,
  ])
  const own = scan.mapRows(raws, enclaveItem)
  const ids: string[] = []
  for (const row of own.rows) {
    if (row.position_id !== null && !ids.includes(row.position_id)) {
      ids.push(row.position_id)
    }
  }
  const histories = await Promise.all(
    ids
      .slice(0, tokenPositions)
      .map((id) =>
        scan
          .rows(scanQueries.enclaveByPosition, [
            id,
            maxKey,
            maxKey,
            "",
            positionRows + 1,
          ])
          .then((rows) => ({ id, rows })),
      ),
  )
  let skipped = own.skipped
  const positions = histories.flatMap(({ id, rows }) => {
    const mapped = scan.mapRows(rows.slice(0, positionRows), enclaveItem)
    skipped += mapped.skipped
    const summary = enclaveSummary(id, mapped.rows, rows.length <= positionRows)
    return summary === null ? [] : [summary]
  })
  return { positions, skipped }
}

export function registerScanEnclaves(
  app: Hono<ApiEnv>,
  scan: ScanContext,
): void {
  /** History from SCAN_DB: keyed by the last successful copy run. */
  async function history(
    c: ApiContext,
    render: () => Promise<unknown>,
  ): Promise<Response> {
    const url = new URL(c.req.url)
    const run = await scan.runVersion()
    return scan.responder.serve(c, {
      cacheClass: "run",
      resource: `${url.pathname}${url.search}`,
      version: `r${run.id}`,
      caller: callerOf(c),
      render: async () => ({ body: await render() }),
    })
  }

  app.get("/internal/scan/borrow/enclave/positions", (c) => {
    const params = queryOf(c, pageParams)
    // A bad cursor is a 400 before anything is read.
    positionCodec.decode(params.cursor)
    return history(c, () =>
      enclavePositionsPage(scan, params.cursor, params.limit),
    )
  })

  app.get("/internal/scan/borrow/enclave/locks/:tokenId", (c) => {
    const tokenId = pathParam(c, "tokenId", tokenIdParam)
    queryOf(c, {})
    return history(c, async () => {
      const found = await enclavePositionsOfLock(scan, tokenId)
      return {
        data: { token_id: tokenId, positions: found.positions },
        meta: { skipped: found.skipped },
      }
    })
  })
}
