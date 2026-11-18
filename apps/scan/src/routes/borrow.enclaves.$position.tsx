import { formatDay, shortHash } from "@matchbox/domain/format"
import * as Breadcrumbs from "@matchbox/ui/breadcrumbs"
import { Glyph, shapes } from "@matchbox/ui/icons"
import {
  createFileRoute,
  Link,
  notFound,
  redirect,
} from "@tanstack/react-router"
import type { ReactNode } from "react"
import { type EnclavePage, getEnclavePage } from "../data/borrow"
import { canonicalHash } from "../data/canonical"
import type { EnclavePageView } from "../data/scan/borrow-views"
import type { LockView } from "../data/scan/lock-views"
import { lockSubline, stateWords } from "../explorer/address/shared"
import { DetailCard, DetailRow, HistoryList } from "../explorer/borrow/history"
import { Coin } from "../explorer/borrow/parts"
import { CardFigure, LastTx, PositionHeader } from "../explorer/borrow/position"
import { AddressLink, SectionHeading, SectionState } from "../explorer/parts"
import { EntityPage } from "../shell/entity"

/** A position id: a 32-byte hash (lower case) or a decimal number. */
function canonicalPosition(raw: string): string | null {
  const hash = canonicalHash(raw)
  if (hash !== null) return hash
  if (!/^\d{1,30}$/.test(raw)) return null
  return BigInt(raw).toString()
}

function shortPosition(id: string): string {
  return id.startsWith("0x") ? shortHash(id) : `#${id}`
}

/**
 * An Enclave position (`gEpCzgLLt1`) from its events: the terms it opened
 * with (principal, rate, warning and minimum ratios, originator fee), the
 * pledged veBTC locks (read from the locks routes), its history in words
 * and its details, with the last transaction in the header. Left out
 * until their data exists: the live collateral
 * ratio, debt and interest, the ratio bar and the BTC price it reaches the
 * minimum at (the API serves no live Enclave state), the mint cap, rate
 * cap, price feed, debt manager and admin, "Ask about this" and Watch.
 */
export const Route = createFileRoute("/borrow/enclaves/$position")({
  // One chunk per route: every new chunk adds a stub and a file name to
  // the entry, which every Scan page loads.
  codeSplitGroupings: [["loader", "component", "notFoundComponent"]],
  loader: async ({ params }) => {
    const position = canonicalPosition(params.position)
    if (position === null) throw notFound()
    if (position !== params.position) {
      throw redirect({
        to: "/borrow/enclaves/$position",
        params: { position },
        statusCode: 301,
      })
    }
    const page = await getEnclavePage({ data: { position } })
    if (page.position.status === "missing") throw notFound()
    return { id: position, page }
  },
  head: () => ({ meta: [{ title: "Enclave position, Matchscan" }] }),
  component: EnclavePositionPage,
  notFoundComponent: EnclaveNotFound,
})

function Terms({ position }: { position: EnclavePageView }): ReactNode {
  return (
    <section
      aria-label="Opened with"
      className="mt-8 rounded-[24px] bg-soft p-7 max-md:p-5"
    >
      <p className="text-[15px] text-ink2">Opened with</p>
      <p className="mt-2 flex flex-wrap items-baseline gap-x-4">
        <span className="text-[44px] leading-none font-[650] tracking-[-0.02em] tabular-nums max-md:text-[34px]">
          {position.principal ?? "None"}
        </span>
        <span className="text-[16px] text-ink2">
          {formatDay(position.openedAt)}
        </span>
      </p>
      <dl className="mt-6 grid grid-cols-4 gap-6 border-t border-line pt-6 max-lg:grid-cols-2 max-md:gap-4">
        <CardFigure label="Rate">{position.rate ?? "None"}</CardFigure>
        <CardFigure label="Minimum ratio">
          {position.minimumRatio ?? "None"}
        </CardFigure>
        <CardFigure label="Warning ratio">
          {position.warningRatio ?? "None"}
        </CardFigure>
        <CardFigure label="Originator fee">
          {position.originatorFee ?? "None"}
        </CardFigure>
      </dl>
    </section>
  )
}

function LockCard({ lock }: { lock: LockView }): ReactNode {
  return (
    <div className="overflow-hidden rounded-[20px] bg-raised">
      <Link
        to="/locks/$escrow/$id"
        params={{ escrow: "vebtc", id: lock.id }}
        className="flex h-[54px] items-center justify-between bg-acc px-5 font-semibold text-on-acc outline-none focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-ink"
      >
        <span className="flex items-center gap-1.5">
          veBTC #{lock.id}
          <Glyph shape={shapes.chevronRight} size={16} strokeWidth={2} />
        </span>
        <span className="rounded-full shadow-[0_0_0_2px_var(--color-raised)]">
          <Coin ticker="BTC" size={26} />
        </span>
      </Link>
      <div className="px-5 pt-4 pb-5">
        <p className="text-[23px] font-[650] tabular-nums">{lock.amount}</p>
        <dl className="mt-3 flex flex-col gap-1.5 text-[15px]">
          <div className="flex justify-between gap-4">
            <dt className="text-sec">Lock</dt>
            <dd className="font-semibold">{stateWords[lock.state]}</dd>
          </div>
          {lock.state === "auto-max" ? null : (
            <div className="flex justify-between gap-4">
              <dt className="text-sec">Unlock</dt>
              <dd className="font-semibold">{lockSubline(lock)}</dd>
            </div>
          )}
        </dl>
      </div>
    </div>
  )
}

function Collateral({
  pledged,
  locks,
}: {
  pledged: readonly string[]
  locks: EnclavePage["locks"]
}): ReactNode {
  return (
    <section
      aria-label="Collateral"
      className="rounded-[24px] bg-soft p-6 max-md:p-5"
    >
      <h2 className="text-[17px] font-semibold">Collateral</h2>
      <div className="mt-4 flex flex-col gap-3">
        {locks.status !== "ok" ? (
          <SectionState section={locks} />
        ) : locks.data.length === 0 ? (
          <p className="text-[15px] text-sec">
            {pledged.length === 0 ? "No veBTC pledged" : "Locks not found"}
          </p>
        ) : (
          locks.data.map((lock) => <LockCard key={lock.id} lock={lock} />)
        )}
      </div>
    </section>
  )
}

function EnclavePositionPage(): ReactNode {
  const { id, page } = Route.useLoaderData()
  const position = page.position.status === "ok" ? page.position.data : null
  const owner = position?.borrower ?? null
  return (
    <>
      <PositionHeader
        crumbs={
          <>
            <Breadcrumbs.Item asChild>
              <Link to="/borrow">Borrow</Link>
            </Breadcrumbs.Item>
            <Breadcrumbs.Item asChild>
              <Link to="/borrow/$tab" params={{ tab: "enclaves" }}>
                Enclaves
              </Link>
            </Breadcrumbs.Item>
          </>
        }
        current={shortPosition(id)}
        address={position?.enclave ?? id.slice(0, 42)}
        title={shortPosition(id)}
        state={
          position === null
            ? null
            : position.open
              ? { word: "Active", tone: "positive" }
              : { word: "Closed", tone: "neutral" }
        }
        sub={
          <>
            {(position?.pledged ?? []).map((token) => (
              <Link
                key={token}
                to="/locks/$escrow/$id"
                params={{ escrow: "vebtc", id: token }}
                className="flex items-center gap-1.5 rounded-sm font-semibold text-ink outline-none hover:underline hover:underline-offset-4 focus-visible:outline-2 focus-visible:outline-ink"
              >
                <Coin ticker="BTC" />
                veBTC #{token}
              </Link>
            ))}
            <span>Enclave</span>
            <LastTx hash={position?.latestTx ?? null} />
          </>
        }
        action={
          owner === null ? null : (
            <a
              href={`https://pro.matchbox.markets/${owner}`}
              className="flex h-11 items-center justify-center gap-2 rounded-[22px] bg-ink px-5 font-semibold text-bg outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink max-md:w-full"
            >
              Open in Matchbox Pro
              <Glyph shape={shapes.arrowUpRight} size={16} strokeWidth={2} />
            </a>
          )
        }
      />
      {position === null ? (
        <div className="mt-8">
          <SectionState
            section={
              page.position.status === "ok"
                ? { status: "unavailable" }
                : page.position
            }
          />
        </div>
      ) : (
        <Terms position={position} />
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
        <div className="flex flex-col gap-4">
          <Collateral pledged={position?.pledged ?? []} locks={page.locks} />
          {position === null ? null : (
            <DetailCard title="Position details">
              <DetailRow label="Position id">
                <span className="font-mono text-[14px]" title={id}>
                  {shortPosition(id)}
                </span>
              </DetailRow>
              <DetailRow label="Enclave">
                <AddressLink
                  view={{
                    address: position.enclave,
                    name: null,
                    contract: true,
                  }}
                />
              </DetailRow>
              <DetailRow label="Borrower">
                {owner === null ? (
                  "None"
                ) : (
                  <AddressLink
                    view={{ address: owner, name: null, contract: false }}
                  />
                )}
              </DetailRow>
              <DetailRow label="Opened">
                <Link
                  to="/block/$id"
                  params={{ id: String(position.openedBlock) }}
                  className="rounded-sm font-mono text-[14px] underline decoration-line underline-offset-4 outline-none focus-visible:outline-2 focus-visible:outline-ink"
                >
                  Block {position.openedBlock.toLocaleString("en-US")}
                </Link>
              </DetailRow>
              <DetailRow label="Originator fee">
                {position.originatorFee ?? "None"}
              </DetailRow>
            </DetailCard>
          )}
        </div>
      </div>
    </>
  )
}

/** Not found: not a position id, or an id with no Enclave events. */
function EnclaveNotFound(): ReactNode {
  const { position } = Route.useParams()
  const valid = canonicalPosition(position)
  return (
    <EntityPage
      icon={shapes.shieldCheck}
      title="Enclave position"
      kind="Enclave position"
      crumbs={[{ label: "Borrow", to: "/borrow" }]}
      current={valid === null ? position.slice(0, 20) : shortPosition(valid)}
      checks={[
        {
          label: "Format",
          value: valid === null ? "Not a position id" : "Valid position id",
          detail: "0x + 64 hex, or a number",
          passed: valid !== null,
        },
        {
          label: "Enclaves",
          value: "Not found",
          detail: "Enclave events",
          passed: false,
        },
      ]}
    />
  )
}
