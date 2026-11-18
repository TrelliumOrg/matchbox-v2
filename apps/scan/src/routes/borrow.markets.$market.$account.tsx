import { shortAddress } from "@matchbox/domain/format"
import * as Breadcrumbs from "@matchbox/ui/breadcrumbs"
import { shapes } from "@matchbox/ui/icons"
import {
  createFileRoute,
  Link,
  notFound,
  redirect,
} from "@tanstack/react-router"
import type { ReactNode } from "react"
import { getMorphoPositionPage } from "../data/borrow"
import { canonicalAddress, canonicalHash } from "../data/canonical"
import type { MorphoRowView } from "../data/scan/borrow-views"
import { bandWords } from "../data/scan/words"
import { DetailCard, DetailRow, HistoryList } from "../explorer/borrow/history"
import {
  Amount,
  BorrowDelayed,
  CoinStack,
  MezoAction,
} from "../explorer/borrow/parts"
import {
  CardFigure,
  HealthCard,
  LastTx,
  PositionHeader,
} from "../explorer/borrow/position"
import { AddressLink, SectionHeading, SectionState } from "../explorer/parts"
import { EntityPage } from "../shell/entity"

/**
 * A Morpho Blue position (`SMPC0BE45O`, phone `eS8VkkjrW4`): health factor,
 * LTV against the LLTV, collateral, debt, rate and the BTC price it
 * liquidates under, all from the API's figures, then its history in words
 * and its details, with the last transaction in the header. Left out
 * until their data exists: debt and collateral over time (no per-position
 * series), USD values of collateral, interest per day, the last health mark on the bar, "Opened" (the first event may
 * be older than the page read) and Watch.
 */
export const Route = createFileRoute("/borrow/markets/$market/$account")({
  // One chunk per route: every new chunk adds a stub and a file name to
  // the entry, which every Scan page loads.
  codeSplitGroupings: [["loader", "component", "notFoundComponent"]],
  loader: async ({ params }) => {
    const market = canonicalHash(params.market)
    const account = canonicalAddress(params.account)
    if (market === null || account === null) throw notFound()
    if (market !== params.market || account !== params.account) {
      throw redirect({
        to: "/borrow/markets/$market/$account",
        params: { market, account },
        statusCode: 301,
      })
    }
    const page = await getMorphoPositionPage({ data: { market, account } })
    if (page.missing) throw notFound()
    return {
      market,
      account,
      page,
      title: `Position ${shortAddress(account)}, Matchscan`,
    }
  },
  head: ({ loaderData }) => ({
    meta: [{ title: loaderData?.title ?? "Position, Matchscan" }],
  }),
  component: PositionPage,
  notFoundComponent: PositionNotFound,
})

function Health({ position }: { position: MorphoRowView }): ReactNode {
  const health = position.health
  return (
    <HealthCard
      label="Health"
      figure={health.healthFactor ?? bandWords[health.band]}
      band={health.band}
      detail={
        health.ltv === null
          ? null
          : `LTV ${health.ltv}${position.lltv === null ? "" : ` of ${position.lltv} LLTV`}`
      }
      share={position.ltvShare}
      limit={position.lltvShare}
      limitLabel={
        position.lltv === null ? null : `Liquidation ${position.lltv}`
      }
      barLabel={`LTV ${health.ltv ?? "none"} of ${position.lltv ?? "unknown"} LLTV, ${bandWords[health.band]}`}
    >
      <CardFigure label="Collateral">
        <Amount coin={position.collateralSymbol} text={position.collateral} />
      </CardFigure>
      <CardFigure label="Debt">
        <Amount coin={position.loanSymbol} text={position.debt} />
      </CardFigure>
      <CardFigure label="Rate">
        {position.borrowApr === null ? "None" : `${position.borrowApr} APR`}
      </CardFigure>
      <CardFigure label="Liquidates if BTC falls under" sub={position.drop}>
        {health.liquidationPrice ?? "None"}
      </CardFigure>
    </HealthCard>
  )
}

function PositionPage(): ReactNode {
  const { market, account, page } = Route.useLoaderData()
  const details = page.market.status === "ok" ? page.market.data : null
  const position = page.position.status === "ok" ? page.position.data : null
  const name = details?.name ?? position?.market ?? "Market"
  const state =
    page.position.status !== "ok"
      ? null
      : position?.open === true
        ? ({ word: "Active", tone: "positive" } as const)
        : ({ word: "Closed", tone: "neutral" } as const)
  return (
    <>
      <BorrowDelayed delayed={page.delayed} />
      <PositionHeader
        crumbs={
          <>
            <Breadcrumbs.Item asChild>
              <Link to="/borrow">Borrow</Link>
            </Breadcrumbs.Item>
            <Breadcrumbs.Item asChild>
              <Link to="/borrow/markets/$market" params={{ market }}>
                {name}
              </Link>
            </Breadcrumbs.Item>
          </>
        }
        current={shortAddress(account)}
        address={account}
        title={shortAddress(account)}
        state={state}
        sub={
          <>
            <span className="flex items-center gap-2 font-semibold text-ink">
              <CoinStack
                collateral={
                  details?.collateral?.symbol ??
                  position?.collateralSymbol ??
                  null
                }
                loan={details?.loan?.symbol ?? position?.loanSymbol ?? null}
              />
              <Link
                to="/borrow/markets/$market"
                params={{ market }}
                className="rounded-sm outline-none hover:underline hover:underline-offset-4 focus-visible:outline-2 focus-visible:outline-ink"
              >
                {name}
              </Link>
            </span>
            <span>Morpho Blue</span>
            <LastTx
              hash={
                page.history.status === "ok"
                  ? (page.history.data[0]?.txHash ?? null)
                  : null
              }
            />
          </>
        }
        action={<MezoAction label="Manage on Mezo" />}
      />
      {page.position.status !== "ok" ? (
        <div className="mt-8">
          <SectionState section={page.position} />
        </div>
      ) : position === null ? (
        <p className="mt-8 rounded-[24px] bg-soft p-7 text-[16px] font-semibold">
          No open position
        </p>
      ) : (
        <Health position={position} />
      )}

      <div className="mt-11 grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_420px]">
        <section aria-labelledby="history" className="min-w-0">
          <SectionHeading id="history">History</SectionHeading>
          {page.history.status === "ok" ? (
            <HistoryList rows={page.history.data} label="Position history" />
          ) : (
            <SectionState section={page.history} />
          )}
        </section>
        <DetailCard title="Position details">
          <DetailRow label="Owner">
            <AddressLink
              view={{ address: account, name: null, contract: false }}
            />
          </DetailRow>
          <DetailRow label="Market">{name}</DetailRow>
          {position === null ? null : (
            <>
              <DetailRow label="Collateral">
                {position.collateral ?? "None"}
              </DetailRow>
              <DetailRow label="Debt">{position.debt ?? "None"}</DetailRow>
              <DetailRow label="LTV">{position.health.ltv ?? "None"}</DetailRow>
            </>
          )}
          {details === null ? null : (
            <>
              <DetailRow label="LLTV">{details.lltv}</DetailRow>
              <DetailRow label="Oracle">
                <Link
                  to="/address/$address"
                  params={{ address: details.oracle }}
                  title={details.oracle}
                  className="rounded-sm font-mono text-[14px] underline decoration-line underline-offset-4 outline-none focus-visible:outline-2 focus-visible:outline-ink"
                >
                  {shortAddress(details.oracle)}
                </Link>
              </DetailRow>
            </>
          )}
          <DetailRow label="Market id">
            <span className="font-mono text-[14px]" title={market}>
              {shortAddress(market)}
            </span>
          </DetailRow>
        </DetailCard>
      </div>
    </>
  )
}

/** Not found: a malformed id or address, or nothing ever held here. */
function PositionNotFound(): ReactNode {
  const { market, account } = Route.useParams()
  const validMarket = canonicalHash(market)
  const validAccount = canonicalAddress(account)
  return (
    <EntityPage
      icon={shapes.creditCard}
      title="Position"
      kind="Morpho Blue position"
      crumbs={[{ label: "Borrow", to: "/borrow" }]}
      current={
        validAccount === null
          ? account.slice(0, 20)
          : shortAddress(validAccount)
      }
      checks={[
        {
          label: "Market",
          value: validMarket === null ? "Not a market id" : "Valid market id",
          detail: "0x + 64 hex",
          passed: validMarket !== null,
        },
        {
          label: "Account",
          value: validAccount === null ? "Not an address" : "Valid address",
          detail: "0x + 40 hex",
          passed: validAccount !== null,
        },
        {
          label: "Position",
          value: "Not found",
          detail: "Morpho Blue",
          passed: false,
        },
      ]}
    />
  )
}
