import { createFileRoute } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { pickCursor } from "../data/cursors"
import { getBlockDays, getBlocks } from "../data/explorer"
import { blockWindowOf } from "../data/scan/block-window"
import { getSigningNote } from "../data/uptime"
import { BlockTimePanel } from "../explorer/network/block-time-panel"
import { NetworkHeader } from "../explorer/network-tabs"
import { Pager, SectionState } from "../explorer/parts"
import { BlocksTable } from "../explorer/tables"
import { SigningNote } from "../explorer/uptime/signing-note"

/**
 * Blocks (`YY3BAmH_lR`): under the header, how many validators signed the
 * newest block counted ("20 of 21 signing", from CometBFT commits read from
 * a community node, with its freshness); then the block-time panel
 * (average, slowest, fastest and a bar per block, from the page's
 * timestamps) and the latest blocks with each proposer named, the time each
 * took after its parent, and the keyset pager. Left out: each block's own
 * signatures and the Finality column (the commits are read a minute behind
 * the list, so a row's count would often be missing; every block is final
 * on commit in CometBFT) and missed proposals. The panel's last-day and
 * 30-day block times come from the daily head reads' heights and times.
 */
export const Route = createFileRoute("/network/blocks")({
  validateSearch: (
    search: Record<string, unknown>,
  ): Record<string, unknown> & { window?: "24h" | "30d" } => {
    const window = blockWindowOf(search.window)
    return {
      ...(pickCursor("blocks", search) ?? {}),
      ...(window === undefined ? {} : { window }),
    }
  },
  loaderDeps: ({ search }) => {
    const { window: _window, ...cursor } = search
    return { cursor }
  },
  loader: async ({ deps }) => {
    const [list, signing, days] = await Promise.all([
      getBlocks({ data: { cursor: deps.cursor } }),
      getSigningNote(),
      getBlockDays(),
    ])
    return {
      now: Math.floor(Date.now() / 1000),
      paged: pickCursor("blocks", deps.cursor) !== null,
      list,
      signing,
      days,
    }
  },
  head: () => ({ meta: [{ title: "Blocks, Matchscan" }] }),
  component: BlocksPage,
})

function BlocksPage(): ReactNode {
  const { now, paged, list, signing, days } = Route.useLoaderData()
  const { window } = Route.useSearch()
  return (
    <>
      <NetworkHeader current="blocks" />
      <SigningNote note={signing} />
      <BlockTimePanel
        times={list.status === "ok" ? list.data.times : null}
        days={days}
        window={window ?? "blocks"}
      />
      <h2 className="sr-only">Latest blocks</h2>
      {list.status === "ok" ? (
        <>
          <Pager
            position="top"
            label="Block pages"
            paged={paged}
            next={list.data.next}
            to="/network/blocks"
          />
          <BlocksTable
            caption="Latest blocks"
            rows={list.data.items}
            now={now}
          />
          <Pager
            position="bottom"
            label="Block pages"
            paged={paged}
            next={list.data.next}
            to="/network/blocks"
          />
        </>
      ) : (
        <SectionState section={list} />
      )}
    </>
  )
}
