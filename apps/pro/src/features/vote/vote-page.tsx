import { useNavigate } from "@tanstack/react-router"
import { type ReactNode, useMemo } from "react"
import { useLiveQuery } from "../../data/live-query"
import { gaugesQuery, voterQuery } from "../../data/queries"
import type { GaugeKind, GaugeList, Voter } from "../../data/view-models"
import { useLive } from "../../live/live-context"
import { useSignedVotes, withSignedVotes } from "./signed-votes"
import type { VoteSearch, VoteSort, VoteTab } from "./vote-route"
import { VoteView } from "./vote-view"

/**
 * Vote at `/vote` (the type the wallet's locks vote first) and
 * `/vote/vebtc`, `/vote/mezo`, `/vote/validators`, `/vote/pools`. Filter,
 * sort, search and page stay in the query string, only when not the
 * default. A new filter, sort or search starts again at page 1. `?pick=`
 * names a gauge to put on the ballot on arrival (see `VoteSearch`).
 */

export function VotePage({
  list: listSeed,
  voter: voterSeed,
  kind,
  search,
}: {
  list: GaugeList
  voter: Voter | null
  kind: GaugeKind
  search: VoteSearch
}): ReactNode {
  const directory = useLiveQuery(gaugesQuery, listSeed)
  // The locks follow the wallet: one made or voted a moment ago is in the
  // picker without leaving the page.
  const voter = useLiveQuery<Voter | null>(
    voterSeed === null ? null : voterQuery(voterSeed.address),
    voterSeed,
  )
  const navigate = useNavigate()
  const { market } = useLive()
  // A vote signed here stays on its gauges until the directory has it.
  const signed = useSignedVotes()
  const mezoUsd = market.prices.mezo?.usd ?? null
  const btcUsd = market.prices.btc?.usd ?? null
  const viewerAddress = voter?.address ?? null
  const viewerBlock = voter?.block
  const list = useMemo(
    () =>
      withSignedVotes(
        directory,
        signed,
        { veMEZO: mezoUsd, veBTC: btcUsd },
        viewerAddress === null
          ? null
          : { address: viewerAddress, block: viewerBlock },
      ),
    [directory, signed, mezoUsd, btcUsd, viewerAddress, viewerBlock],
  )

  /** A filter, sort or search change: in place, back to page 1. */
  function refine(patch: {
    tab?: VoteTab | undefined
    sort?: VoteSort | undefined
    q?: string | undefined
  }): void {
    void navigate({
      to: ".",
      search: (previous) => ({ ...previous, ...patch, page: undefined }),
      replace: true,
      resetScroll: false,
      viewTransition: false,
    })
  }

  return (
    <VoteView
      key={voter?.address ?? "signed-out"}
      list={list}
      voter={voter}
      epoch={market.epoch.number}
      kind={kind}
      tab={search.tab ?? "all"}
      sort={search.sort ?? "incentives"}
      page={search.page ?? 1}
      query={search.q ?? ""}
      arrivalPick={search.pick ?? null}
      onArrivalPickDone={() =>
        void navigate({
          to: ".",
          search: (previous) => ({ ...previous, pick: undefined }),
          replace: true,
          resetScroll: false,
          viewTransition: false,
        })
      }
      onTab={(tab) => refine({ tab: tab === "all" ? undefined : tab })}
      onSort={(sort) =>
        refine({ sort: sort === "incentives" ? undefined : sort })
      }
      onQuery={(q) => refine({ q: q === "" ? undefined : q })}
      onPageFix={(page) =>
        void navigate({
          to: ".",
          search: (previous) => ({
            ...previous,
            page: page === 1 ? undefined : page,
          }),
          replace: true,
          resetScroll: false,
          viewTransition: false,
        })
      }
    />
  )
}
