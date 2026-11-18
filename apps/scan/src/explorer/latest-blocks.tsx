import { groupThousands } from "@matchbox/domain/format"
import { useLive } from "@matchbox/live/context"
import type { HeadBlock } from "@matchbox/live/heads"
import * as Age from "@matchbox/ui/age"
import { Glyph, shapes } from "@matchbox/ui/icons"
import { Link } from "@tanstack/react-router"
import { type ReactNode, useEffect, useState } from "react"
import { averageBlockTime } from "../data/scan/block-times"
import type { AddressView, BlockRow } from "../data/views"
import { AddressLink, SectionHeading } from "./parts"

/**
 * Home's "Latest blocks" (`cP_-xnZA8I`): the server's newest blocks, then
 * each block BlockHub announces is added at the top from the head message
 * itself (number, hash, transactions, proposer), so the list costs no HTTP
 * request after first paint. Proposers are named from the validators'
 * names the server sent with the first blocks.
 */

export type LatestBlock = {
  height: number
  timestamp: number | null
  transactions: number | null
  miner: AddressView | null
}

const shown = 5

export function fromRow(row: BlockRow): LatestBlock {
  return {
    height: row.height,
    timestamp: row.timestamp,
    transactions: row.transactions,
    miner: row.miner,
  }
}

export function fromHead(
  block: HeadBlock,
  proposers: Readonly<Record<string, string>> = {},
): LatestBlock {
  const address = block.miner?.toLowerCase() ?? null
  const name = address === null ? undefined : proposers[address]
  return {
    height: block.number,
    timestamp: block.timestamp,
    transactions: block.transactionCount,
    miner:
      address === null
        ? null
        : {
            address,
            name: null,
            contract: false,
            ...(name === undefined
              ? {}
              : { label: { name, kind: "validator", tags: [] } }),
          },
  }
}

/** Adds `block` at the top when it is newer, keeping `shown` rows. */
export function addBlock(
  rows: readonly LatestBlock[],
  block: LatestBlock,
): LatestBlock[] {
  if (rows.some((row) => row.height >= block.height)) return [...rows]
  return [block, ...rows].slice(0, shown)
}

export function useLatestBlocks(
  seed: readonly BlockRow[],
  proposers: Readonly<Record<string, string>>,
): LatestBlock[] {
  const { store } = useLive()
  const [rows, setRows] = useState(() => seed.slice(0, shown).map(fromRow))
  useEffect(
    () =>
      store.subscribe(() => {
        const block = store.get().block
        if (block === undefined) return
        setRows((current) => addBlock(current, fromHead(block, proposers)))
      }),
    [store, proposers],
  )
  return rows
}

/** The section's heading: the average block time over the rows shown. */
export function LatestBlocksHeading({
  average,
}: {
  average: string | null
}): ReactNode {
  return (
    <SectionHeading
      id="latest-blocks"
      aside={
        <span className="flex items-center gap-5">
          {average === null ? null : (
            <span className="text-sec tabular-nums">{average} average</span>
          )}
          <Link
            to="/network/blocks"
            className="rounded-sm font-semibold text-ink underline underline-offset-4 outline-none focus-visible:outline-2 focus-visible:outline-ink"
          >
            All blocks
          </Link>
        </span>
      }
    >
      Latest blocks
    </SectionHeading>
  )
}

export function LatestBlocks({
  seed,
  proposers,
  now,
}: {
  seed: readonly BlockRow[]
  proposers: Readonly<Record<string, string>>
  now: number
}): ReactNode {
  const rows = useLatestBlocks(seed, proposers)
  return (
    <>
      <LatestBlocksHeading average={averageBlockTime(rows)} />
      <BlockList rows={rows} now={now} />
    </>
  )
}

function BlockList({
  rows,
  now,
}: {
  rows: readonly LatestBlock[]
  now: number
}): ReactNode {
  return (
    <ol
      aria-label="Latest blocks"
      className="flex flex-col rounded-[24px] bg-soft p-2"
    >
      {rows.map((row) => (
        <li
          key={row.height}
          className="flex h-[63px] items-center gap-3.5 rounded-[18px] px-4 [&+&]:border-t [&+&]:border-line"
        >
          <span className="grid size-9 flex-none place-items-center rounded-full bg-raised text-ink2">
            <Glyph shape={shapes.box} size={17} strokeWidth={1.8} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <Link
              to="/block/$id"
              params={{ id: String(row.height) }}
              className="w-fit rounded-sm font-semibold tabular-nums outline-none hover:underline hover:underline-offset-4 focus-visible:outline-2 focus-visible:outline-ink"
            >
              {groupThousands(BigInt(row.height))}
            </Link>
            {row.miner === null ? null : (
              <span className="truncate text-[14.5px] text-sec">
                <AddressLink view={row.miner} />
              </span>
            )}
          </span>
          <span className="flex flex-col items-end text-right">
            {row.transactions === null ? null : (
              <span className="text-[15px] font-semibold tabular-nums">
                {row.transactions} {row.transactions === 1 ? "txn" : "txns"}
              </span>
            )}
            {row.timestamp === null ? null : (
              <Age.Root
                timestamp={row.timestamp}
                now={now}
                className="text-[14px] text-sec"
              />
            )}
          </span>
        </li>
      ))}
    </ol>
  )
}
