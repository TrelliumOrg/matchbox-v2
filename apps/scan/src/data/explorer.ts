import {
  blocksPageSchema,
  mainPageBlocksSchema,
  tokenBalancesPageSchema,
  tokenTransfersPageSchema,
  transactionsPageSchema,
} from "@matchbox/contracts/blockscout"
import { createServerFn } from "@tanstack/react-start"
import { setCacheClass } from "../cache-class.server"
import {
  canonicalQuery,
  type Read,
  readBlockscout,
} from "./blockscout/read.server"
import { nowSeconds } from "./clock.server"
import { type CursorList, pickCursor } from "./cursors"
import { type BlockDays, blockDays } from "./scan/block-days"
import { type BlockTimes, blockTimes, tookSeconds } from "./scan/block-times"
import { withMezoIds } from "./scan/mezo-names.server"
import { nameViews } from "./scan/names"
import { knownNames } from "./scan/names.server"
import { metric } from "./scan/series"
import { readSeries } from "./scan/series.server"
import {
  type AddressSummary,
  type AddressTransfer,
  addressTransfer,
  type BlockRow,
  blockRow,
  cursorOf,
  type Page,
  type TokenBalances,
  type TxRow,
  tokenBalance,
  txRow,
} from "./views"

/**
 * The server functions behind Scan's chain pages. They run on the Scan
 * Worker, read the Blockscout proxy, and return view models (see views),
 * so the browser never downloads zod or the formatters. Validators are
 * type-only identities (the spike's rule); inputs are checked inside.
 *
 * A section is "ok", "unavailable" or "rate-limited": a failed read degrades
 * only its section. An entity read can also be "missing" (the page's 404).
 */

export type Section<T> =
  | {
      status: "ok"
      data: T
      /** Rows the API left out (failed their schema): not the whole list. */
      skipped?: number
      /** A stale cursor was dropped: this is the list from the top. */
      restarted?: boolean
    }
  | { status: "unavailable" }
  | { status: "rate-limited" }
  /** Our read routes answer 503: the database is not bound yet. */
  | { status: "disabled" }

export type Entity<T> = Section<T> | { status: "missing" }

function section<In, Out>(
  read: Read<In>,
  map: (data: In) => Out,
): Section<Out> {
  if (read.status === "ok") return { status: "ok", data: map(read.data) }
  if (read.status === "rate-limited") return { status: "rate-limited" }
  // A list that is "missing" has nothing to show: an empty list would lie.
  return { status: "unavailable" }
}

type CursorInput = { cursor: Record<string, unknown> }

function query(
  list: CursorList,
  input: CursorInput,
  extra: Record<string, string> = {},
): URLSearchParams {
  return canonicalQuery({ ...extra, ...(pickCursor(list, input.cursor) ?? {}) })
}

function identity<T>(input: T): T {
  return input
}

/**
 * Home's latest blocks, their proposers named, and the validators' names
 * by proposer address (a few dozen at most), so the blocks BlockHub
 * announces after first paint are named in the browser with no request.
 */
export type LatestBlocksData = {
  blocks: BlockRow[]
  proposers: Record<string, string>
}

export const getLatestBlocks = createServerFn({ method: "GET" }).handler(
  async function getLatestBlocksHandler(): Promise<Section<LatestBlocksData>> {
    setCacheClass("list")
    const [read, names] = await Promise.all([
      readBlockscout(
        "main-page/blocks",
        new URLSearchParams(),
        mainPageBlocksSchema,
      ),
      knownNames(),
    ])
    return section(read, (blocks) => ({
      blocks: nameViews(blocks.map(blockRow), names),
      proposers: { ...names.validators },
    }))
  },
)

/** A blocks list row with its time after the block before it. */
export type BlockListRow = BlockRow & { took: string | null }

/**
 * A page of the blocks list: each row's "Took" (null for the page's
 * oldest block, whose parent is on the next page) and the page's block
 * times for the panel.
 */
export type BlocksPage = Page<BlockListRow> & { times: BlockTimes | null }

export const getBlocks = createServerFn({ method: "GET" })
  .validator(identity<CursorInput>)
  .handler(async function getBlocksHandler({
    data,
  }): Promise<Section<BlocksPage>> {
    setCacheClass("list")
    const [read, names] = await Promise.all([
      readBlockscout(
        "blocks",
        query("blocks", data, { type: "block" }),
        blocksPageSchema,
      ),
      knownNames(),
    ])
    return section(read, (page) => {
      const rows = page.items.map(blockRow)
      const took = tookSeconds(rows)
      return {
        items: nameViews(
          rows.map((row, index) => {
            const seconds = took[index]
            return {
              ...row,
              took:
                seconds === null || seconds === undefined
                  ? null
                  : `${seconds}s`,
            }
          }),
          names,
        ),
        next: cursorOf(page.next_page_params),
        times: blockTimes(rows),
      }
    })
  })

/**
 * Block time between the daily head reads of the last 30 days, from the
 * heads' heights and times (`chain.block_height`, `_time`); null without
 * two timed reads.
 */
export const getBlockDays = createServerFn({ method: "GET" }).handler(
  async function getBlockDaysHandler(): Promise<BlockDays | null> {
    const now = nowSeconds()
    const [heights, times] = await Promise.all([
      readSeries({ metric: metric("chain.block_height"), days: 31, now }),
      readSeries({ metric: metric("chain.block_height_time"), days: 31, now }),
    ])
    return heights.status === "ok" && times.status === "ok"
      ? blockDays(heights.data.points, times.data.points)
      : null
  },
)

export type AddressPage = {
  summary: AddressSummary
  /** Null when the counters could not be read: the header omits them. */
  transactionCount: string | null
  transferCount: string | null
}

export const getAddressTokens = createServerFn({ method: "GET" })
  .validator(identity<{ address: string }>)
  .handler(async function getAddressTokensHandler({
    data,
  }): Promise<Section<TokenBalances>> {
    if (!/^0x[0-9a-f]{40}$/.test(data.address)) return { status: "unavailable" }
    const read = await readBlockscout(
      `addresses/${data.address}/tokens`,
      new URLSearchParams(),
      tokenBalancesPageSchema,
    )
    return section(read, (page) => ({
      items: page.items.map(tokenBalance),
      more: page.next_page_params !== null,
    }))
  })

export const getAddressTransactions = createServerFn({ method: "GET" })
  .validator(identity<CursorInput & { address: string }>)
  .handler(async function getAddressTransactionsHandler({
    data,
  }): Promise<Section<Page<TxRow>>> {
    if (!/^0x[0-9a-f]{40}$/.test(data.address)) return { status: "unavailable" }
    const read = await readBlockscout(
      `addresses/${data.address}/transactions`,
      query("addressTransactions", data),
      transactionsPageSchema,
    )
    return withMezoIds(
      section(read, (page) => ({
        items: page.items.map(txRow),
        next: cursorOf(page.next_page_params),
      })),
    )
  })

export const getAddressTransfers = createServerFn({ method: "GET" })
  .validator(identity<CursorInput & { address: string }>)
  .handler(async function getAddressTransfersHandler({
    data,
  }): Promise<Section<Page<AddressTransfer>>> {
    if (!/^0x[0-9a-f]{40}$/.test(data.address)) return { status: "unavailable" }
    const read = await readBlockscout(
      `addresses/${data.address}/token-transfers`,
      query("addressTransfers", data),
      tokenTransfersPageSchema,
    )
    return withMezoIds(
      section(read, (page) => ({
        items: page.items.map((transfer) =>
          addressTransfer(data.address, transfer),
        ),
        next: cursorOf(page.next_page_params),
      })),
    )
  })
