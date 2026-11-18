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
import { getTrovePage } from "../data/borrow"
import { canonicalAddress } from "../data/canonical"
import type { TroveRowView } from "../data/scan/borrow-views"
import { DetailCard, DetailRow, HistoryList } from "../explorer/borrow/history"
import {
  Amount,
  BorrowDelayed,
  Coin,
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
 * An MUSD trove (`SMPC0BE45O` in the trove's terms, phone `eS8VkkjrW4`):
 * collateral ratio, LTV, health factor, collateral, debt, rate and the BTC
 * price it liquidates under, all from the API's figures, then its history
 * in words and its details, with the last transaction in the header.
 * Left out until their data exists: debt and collateral over time (no
 * per-trove series), the minimum ratio mark (the API sends no MCR), USD
 * values and Watch.
 */
export const Route = createFileRoute("/borrow/troves/$owner")({
  // One chunk per route: every new chunk adds a stub and a file name to
  // the entry, which every Scan page loads.
  codeSplitGroupings: [["loader", "component", "notFoundComponent"]],
  loader: async ({ params }) => {
    const owner = canonicalAddress(params.owner)
    if (owner === null) throw notFound()
    if (owner !== params.owner) {
      throw redirect({
        to: "/borrow/troves/$owner",
        params: { owner },
        statusCode: 301,
      })
    }
    const page = await getTrovePage({ data: { owner } })
    if (page.missing) throw notFound()
    return {
      owner,
      page,
      title: `MUSD loan ${shortAddress(owner)}, Matchscan`,
    }
  },
  head: ({ loaderData }) => ({
    meta: [{ title: loaderData?.title ?? "MUSD loan, Matchscan" }],
  }),
  component: TrovePage,
  notFoundComponent: TroveNotFound,
})

function Health({ trove }: { trove: TroveRowView }): ReactNode {
  const health = trove.health
  const detail = [
    health.estimate ? "Estimate" : null,
    health.priceNote,
    health.ltv === null ? null : `LTV ${health.ltv}`,
    health.healthFactor === null ? null : `health ${health.healthFactor}`,
  ].filter((part): part is string => part !== null)
  return (
    <HealthCard
      label="Collateral ratio"
      figure={trove.collateralRatio ?? health.bandText}
      band={health.band}
      detail={detail.length === 0 ? null : detail.join(", ")}
      share={trove.ltvShare}
      limit={null}
      limitLabel={null}
      barLabel={`LTV ${health.ltv ?? "none"}, ${health.bandText}`}
    >
      <CardFigure label="Collateral">
        <Amount coin="BTC" text={trove.collateral} />
      </CardFigure>
      <CardFigure
        label="Debt"
        sub={trove.interest === null ? null : `Interest ${trove.interest}`}
      >
        <Amount coin="MUSD" text={trove.debt} />
      </CardFigure>
      <CardFigure label="Rate">{trove.rate}</CardFigure>
      <CardFigure label="Liquidates if BTC falls under">
        {health.liquidationPrice ?? "None"}
      </CardFigure>
    </HealthCard>
  )
}

function TrovePage(): ReactNode {
  const { owner, page } = Route.useLoaderData()
  const trove = page.trove.status === "ok" ? page.trove.data : null
  const state =
    trove === null
      ? page.trove.status === "missing"
        ? ({ word: "Closed", tone: "neutral" } as const)
        : null
      : ({
          word: trove.status,
          tone: trove.open ? "positive" : "neutral",
        } as const)
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
              <Link to="/borrow/$tab" params={{ tab: "troves" }}>
                Troves
              </Link>
            </Breadcrumbs.Item>
          </>
        }
        current={shortAddress(owner)}
        address={owner}
        title={shortAddress(owner)}
        state={state}
        sub={
          <>
            <span className="flex items-center gap-2 font-semibold text-ink">
              <Coin ticker="MUSD" />
              MUSD loan
            </span>
            <span>Trove</span>
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
      {trove !== null ? (
        <Health trove={trove} />
      ) : page.trove.status === "missing" ? (
        <p className="mt-8 rounded-[24px] bg-soft p-7 text-[16px] font-semibold">
          No open trove
        </p>
      ) : (
        <div className="mt-8">
          <SectionState
            section={
              page.trove.status === "ok"
                ? { status: "unavailable" }
                : page.trove
            }
          />
        </div>
      )}

      <div className="mt-11 grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_420px]">
        <section aria-labelledby="history" className="min-w-0">
          <SectionHeading id="history">History</SectionHeading>
          {page.history.status === "ok" ? (
            <HistoryList rows={page.history.data} label="Trove history" />
          ) : (
            <SectionState section={page.history} />
          )}
        </section>
        <DetailCard title="Trove details">
          <DetailRow label="Owner">
            <AddressLink
              view={{ address: owner, name: null, contract: false }}
            />
          </DetailRow>
          {trove === null ? null : (
            <>
              <DetailRow label="Status">{trove.status}</DetailRow>
              <DetailRow label="Principal">
                {trove.principal ?? "None"}
              </DetailRow>
              <DetailRow label="Interest">{trove.interest ?? "None"}</DetailRow>
              <DetailRow label="Rate">{trove.rate}</DetailRow>
              <DetailRow label="Block">
                <Link
                  to="/block/$id"
                  params={{ id: String(trove.block) }}
                  className="rounded-sm font-mono text-[14px] underline decoration-line underline-offset-4 outline-none focus-visible:outline-2 focus-visible:outline-ink"
                >
                  {trove.block.toLocaleString("en-US")}
                </Link>
              </DetailRow>
            </>
          )}
        </DetailCard>
      </div>
    </>
  )
}

/** Not found: not an address, or no trove and no trove history. */
function TroveNotFound(): ReactNode {
  const { owner } = Route.useParams()
  const valid = canonicalAddress(owner)
  return (
    <EntityPage
      icon={shapes.creditCard}
      title="MUSD loan"
      kind="MUSD loan"
      crumbs={[{ label: "Borrow", to: "/borrow" }]}
      current={valid === null ? owner.slice(0, 20) : shortAddress(valid)}
      checks={[
        {
          label: "Format",
          value: valid === null ? "Not an address" : "Valid address",
          detail: "0x + 40 hex",
          passed: valid !== null,
        },
        {
          label: "Trove",
          value: "Not found",
          detail: "MUSD",
          passed: false,
        },
      ]}
    />
  )
}
