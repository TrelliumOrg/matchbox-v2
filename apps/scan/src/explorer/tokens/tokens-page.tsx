import { shortAddress } from "@matchbox/domain/format"
import { TokenIcon } from "@matchbox/token-icons"
import * as DataTable from "@matchbox/ui/data-table"
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"
import type {
  Missing,
  TokenRow,
  TokenSort,
  TokensPage,
} from "../../data/token-pages"
import { PageTitle } from "../../shell/page"
import { SectionHeading, SectionState } from "../parts"
import { SkippedNote } from "../skipped-note"
import { ValuePanels } from "./value-panels"

/**
 * Tokens (`PnId7WLIDs`): every token the API lists (`/tokens`, one read)
 * with its latest supply and holders, the price where the API prices it
 * and the own price's 7 day change (BTC and MEZO). A price that is BTC's,
 * MEZO's, a bridged dollar's (priced as USDC or USDT) or $1 taken for a
 * dollar token says so under it. MUSD shows only our on-chain price,
 * never $1 or CoinGecko alone: without it, "not counted yet" (QYj-GpUl0r).
 * MUSD and MEZO name their chains and their share on Mezo, open their own
 * pages, the rest their address. The list sorts by the
 * registry's order, value on Mezo or holders. A figure with no row yet
 * says so, never zero. Above it, value on Mezo now and the stablecoins
 * on Mezo over time. Left out until their data exists: the category tabs,
 * the value's 7 day change, transfers in USD and the 7 day price
 * sparkline.
 */

const sortNames: Record<TokenSort, string> = {
  listed: "Listed",
  value: "Value on Mezo",
  holders: "Holders",
}

const sortLink =
  "rounded-sm text-[15px] text-sec outline-none hover:text-ink focus-visible:outline-2 focus-visible:outline-ink aria-[current=page]:font-semibold aria-[current=page]:text-ink"

function SortLinks({ sort }: { sort: TokenSort }): ReactNode {
  return (
    <nav aria-label="Sort">
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <li className="text-[15px] text-sec">Sort</li>
        {(Object.keys(sortNames) as TokenSort[]).map((each) => (
          <li key={each}>
            <Link
              to="/tokens"
              search={each === "listed" ? {} : { sort: each }}
              aria-current={each === sort ? "page" : undefined}
              activeOptions={{ exact: true, includeSearch: true }}
              activeProps={{}}
              className={sortLink}
            >
              {sortNames[each]}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}

const nameLink =
  "rounded-sm font-semibold outline-none hover:underline hover:underline-offset-4 focus-visible:outline-2 focus-visible:outline-ink"

const missingText: Record<Missing, string> = {
  "not-yet": "Not available yet",
  unknown: "Not available",
}

function Figure({ value }: { value: string | Missing }): ReactNode {
  return value === "not-yet" || value === "unknown" ? (
    <span className="font-normal text-sec">{missingText[value]}</span>
  ) : (
    value
  )
}

const basisText = {
  own: null,
  btc: "BTC's price",
  mezo: "MEZO's price",
  assumed: "Taken as $1",
  market: "On chain, venues",
  usdc: "Bridged, priced as USDC",
  usdt: "Bridged, priced as USDT",
} as const

function TokenName({ row }: { row: TokenRow }): ReactNode {
  const subline =
    row.name ?? (row.symbol === null ? null : shortAddress(row.address))
  return (
    <span className="flex min-w-0 items-center gap-3">
      <TokenIcon ticker={row.ticker} size={36} />
      <span className="flex min-w-0 flex-col">
        {row.slug === null ? (
          <Link
            to="/address/$address"
            params={{ address: row.address }}
            className={`${nameLink} ${row.symbol === null ? "font-mono" : ""}`}
          >
            {row.symbol ?? shortAddress(row.address)}
          </Link>
        ) : (
          <Link
            to="/tokens/$token"
            params={{ token: row.slug }}
            className={nameLink}
          >
            {row.symbol}
          </Link>
        )}
        {subline === null ? null : (
          <span
            className={`truncate text-[14.5px] text-sec ${row.name === null ? "font-mono" : ""}`}
          >
            {subline}
          </span>
        )}
      </span>
    </span>
  )
}

function Price({ row }: { row: TokenRow }): ReactNode {
  if (row.price === null) {
    return row.priceMissing ? (
      <span className="text-[14.5px] whitespace-nowrap text-sec">
        Not counted yet
      </span>
    ) : null
  }
  const note = basisText[row.price.basis]
  const source = row.price.source
  return (
    <span className="flex flex-col items-end">
      <span className="font-semibold">{row.price.text}</span>
      {source !== null ? (
        <span className="text-[14.5px] whitespace-nowrap text-sec">
          {source}
        </span>
      ) : note === null ? null : (
        <span className="text-[14.5px] whitespace-nowrap text-sec">{note}</span>
      )}
    </span>
  )
}

function Week({ row }: { row: TokenRow }): ReactNode {
  if (row.week === null) return null
  if (row.week === "short") {
    return (
      <span className="text-[14.5px] text-sec">Not enough history yet</span>
    )
  }
  return (
    <span className={row.week.tone === "neg" ? "text-neg" : "text-pos"}>
      {row.week.text}
    </span>
  )
}

export function TokensView({ page }: { page: TokensPage }): ReactNode {
  return (
    <>
      <PageTitle>Tokens</PageTitle>
      <ValuePanels page={page} />
      <section aria-labelledby="all-tokens" className="mt-12">
        <SectionHeading id="all-tokens" aside={<SortLinks sort={page.sort} />}>
          Tracked tokens
        </SectionHeading>
        {page.table.status !== "ok" ? (
          <SectionState section={page.table} />
        ) : (
          <>
            <p className="-mt-2 mb-4 text-[14.5px] text-sec">
              The tokens in Matchscan's registry, with supply and holders read
              daily for {page.table.data.tracked} of them.
            </p>
            <DataTable.Root caption="Tracked tokens" captionHidden reflow="md">
              <DataTable.Header>
                <DataTable.Column>Token</DataTable.Column>
                <DataTable.Column align="end">Price</DataTable.Column>
                <DataTable.Column align="end">7d</DataTable.Column>
                <DataTable.Column>Chains</DataTable.Column>
                <DataTable.Column align="end">Supply</DataTable.Column>
                <DataTable.Column align="end">Holders</DataTable.Column>
              </DataTable.Header>
              <DataTable.Body>
                {page.table.data.rows.map((row) => (
                  <DataTable.Row key={row.address}>
                    <DataTable.Cell phone="title">
                      <TokenName row={row} />
                    </DataTable.Cell>
                    <DataTable.Cell
                      align="end"
                      phone="meta"
                      className="tabular-nums"
                    >
                      <Price row={row} />
                    </DataTable.Cell>
                    <DataTable.Cell align="end" className="tabular-nums">
                      <Week row={row} />
                    </DataTable.Cell>
                    <DataTable.Cell phone="hidden">
                      <span className="text-[14.5px] text-ink2">
                        {row.chains.join(", ")}
                      </span>
                    </DataTable.Cell>
                    <DataTable.Cell align="end" phone="value">
                      <span className="flex flex-col items-end tabular-nums">
                        <span className="font-semibold whitespace-nowrap">
                          <Figure value={row.supply} />
                        </span>
                        {row.supplyUsd === null ? null : (
                          <span className="text-[14.5px] text-sec">
                            {row.supplyUsd}
                          </span>
                        )}
                        {row.onMezo === null ? null : (
                          <span className="text-[14.5px] whitespace-nowrap text-sec">
                            {row.onMezo}
                          </span>
                        )}
                      </span>
                    </DataTable.Cell>
                    <DataTable.Cell
                      align="end"
                      phone="detail"
                      className="tabular-nums"
                    >
                      {row.holders === "not-yet" ||
                      row.holders === "unknown" ? (
                        <span className="font-normal text-sec">
                          <span className="md:hidden">Holders: </span>
                          {missingText[row.holders]}
                        </span>
                      ) : (
                        <>
                          {row.holders}
                          <span className="md:hidden"> holders</span>
                        </>
                      )}
                    </DataTable.Cell>
                  </DataTable.Row>
                ))}
              </DataTable.Body>
            </DataTable.Root>
            <SkippedNote skipped={page.table.skipped} what="tokens" />
            {page.table.data.incomplete ? (
              <p className="mt-3 text-[14.5px] text-sec">
                7d changes not available
              </p>
            ) : null}
          </>
        )}
      </section>
    </>
  )
}
