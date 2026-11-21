import { groupThousands, shortHash } from "@matchbox/domain/format"
import * as Age from "@matchbox/ui/age"
import * as Breadcrumbs from "@matchbox/ui/breadcrumbs"
import * as HashChip from "@matchbox/ui/hash-chip"
import { Glyph, shapes } from "@matchbox/ui/icons"
import * as RawViewer from "@matchbox/ui/raw-viewer"
import * as StatusChip from "@matchbox/ui/status-chip"
import * as UntrustedText from "@matchbox/ui/untrusted-text"
import {
  createFileRoute,
  Link,
  lazyRouteComponent,
  notFound,
  redirect,
} from "@tanstack/react-router"
import { type ReactNode, Suspense } from "react"
import { canonicalHash } from "../data/canonical"
import type { Headline } from "../data/entities"
import type { ActivityView } from "../data/scan/activity-view"
import type { LogView, TransferView, TxDetail } from "../data/views"
import {
  AddressLink,
  BlockLink,
  Detail,
  Details,
  LabelsCapped,
  SectionHeading,
  SectionState,
} from "../explorer/parts"
import { ActivityList, Sentence } from "../explorer/sentence"
import { ShowAll } from "../explorer/show-all"
import { getTxPage } from "../explorer/tx-page"
import { deferred } from "../shell/deferred"
import { useRefreshWhile } from "../shell/entity-not-found"

/** A loan's panels: their own chunk, loaded only for a loan transaction. */
const WhatChanged = deferred(() =>
  import("../explorer/tx-loan").then((module) => module.WhatChanged),
)
const PositionCard = deferred(() =>
  import("../explorer/tx-loan").then((module) => module.PositionCard),
)

/**
 * A transaction (`h3WlmUZS7N`), from one composed document: the
 * plain-words title from our decoded activity (else the decoded method),
 * status, block, time, parties, value, fee, tokens moved, each decoded
 * action in plain words, then the input and every log with Decoded and
 * Raw. A loan transaction (a trove, Enclave or Morpho position its logs
 * name, tx-loan) gets its title in plain words, "What changed" and the
 * position card. Left out until their data exists: an Enclave's live
 * ratio bar (said "Not available yet"), Watch and Ask about this.
 */
export const Route = createFileRoute("/tx/$hash")({
  loader: async ({ params }) => {
    const hash = canonicalHash(params.hash)
    if (hash === null) throw notFound()
    if (hash !== params.hash) {
      throw redirect({ to: "/tx/$hash", params: { hash }, statusCode: 301 })
    }
    const page = await getTxPage({ data: { hash } })
    if (page.tx.status === "missing") throw notFound()
    return { hash, ...page, now: Math.floor(Date.now() / 1000) }
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title:
          loaderData === undefined
            ? "Transaction, Matchscan"
            : `${loaderData.loan?.status === "ok" && loaderData.headline?.decoded !== true ? loaderData.loan.data.title : loaderData.headline?.decoded === true ? loaderData.headline.text : "Transaction"} ${shortHash(loaderData.hash)}, Matchscan`,
      },
    ],
  }),
  component: TransactionPage,
  notFoundComponent: lazyRouteComponent(
    () => import("../shell/entity-not-found"),
    "TransactionNotFound",
  ),
})

const statusWord = { success: "Success", failed: "Failed", pending: "Pending" }

function Transfers({ transfers }: { transfers: TransferView[] }): ReactNode {
  return (
    <ul className="flex flex-col gap-2">
      {transfers.map((transfer, index) => (
        <li
          // Two identical transfers in one transaction are still two.
          // biome-ignore lint/suspicious/noArrayIndexKey: order is the key
          key={index}
          className="flex flex-wrap items-baseline gap-x-2 gap-y-1"
        >
          <span className="font-semibold tabular-nums">
            {transfer.amount ??
              (transfer.tokenId === null ? "" : `#${transfer.tokenId}`)}
          </span>
          <UntrustedText.Root
            value={transfer.token.symbol ?? transfer.token.name ?? "Token"}
            limit={24}
          />
          <span className="text-sec">from</span>
          <AddressLink view={transfer.from} />
          <span className="text-sec">to</span>
          <AddressLink view={transfer.to} />
        </li>
      ))}
    </ul>
  )
}

function Summary({ tx, now }: { tx: TxDetail; now: number }): ReactNode {
  return (
    <Details>
      <Detail label="Status">
        <StatusChip.Root tone={StatusChip.txTone(tx.status)}>
          {statusWord[tx.status]}
        </StatusChip.Root>
        {tx.revertReason === null ? null : (
          <span className="ml-3 font-mono text-[14px] text-sec">
            <UntrustedText.Root value={tx.revertReason} limit={160} />
          </span>
        )}
      </Detail>
      <Detail label="Block">
        {tx.block === null ? (
          <span className="text-sec">Pending</span>
        ) : (
          <BlockLink height={tx.block} />
        )}
      </Detail>
      {tx.timestamp === null ? null : (
        <Detail label="Time">
          <Age.Timestamp timestamp={tx.timestamp} now={now} />
        </Detail>
      )}
      <Detail label="From">
        <HashChip.Root value={tx.from.address}>
          <HashChip.Value asChild>
            <Link
              to="/address/$address"
              params={{ address: tx.from.address }}
            />
          </HashChip.Value>
          <HashChip.Copy />
        </HashChip.Root>
      </Detail>
      {tx.to !== null && tx.created === null ? (
        <Detail label="To">
          <span className="flex flex-wrap items-center gap-2">
            <AddressLink view={tx.to} />
            {tx.to.name === null ? null : (
              <span className="font-mono text-[14px] text-sec">
                {tx.to.address}
              </span>
            )}
          </span>
        </Detail>
      ) : null}
      {tx.created === null ? null : (
        <Detail label="Created">
          <AddressLink view={tx.created} />
        </Detail>
      )}
      {tx.method === null ? null : (
        <Detail label="Method">
          <span className="font-mono">
            <UntrustedText.Root value={tx.method} limit={64} />
          </span>
        </Detail>
      )}
      <Detail label="Value">
        {tx.value === null ? "0 BTC" : `${tx.value} BTC`}
      </Detail>
      {tx.transfers.length === 0 ? null : (
        <Detail label="Tokens moved">
          <Transfers transfers={tx.transfers} />
          {tx.moreTransfers ? (
            <p className="mt-2 text-[14px] text-sec">
              More transfers not shown
            </p>
          ) : null}
        </Detail>
      )}
      {tx.fee === null ? null : <Detail label="Fee">{tx.fee} BTC</Detail>}
      {tx.gasUsed === null ? null : (
        <Detail label="Gas used">
          {tx.gasUsed}
          {tx.gasLimit === null ? null : (
            <span className="text-sec"> of {tx.gasLimit}</span>
          )}
        </Detail>
      )}
      {tx.gasPrice === null ? null : (
        <Detail label="Gas price">{tx.gasPrice}</Detail>
      )}
      {tx.nonce === null ? null : (
        <Detail label="Nonce">{groupThousands(BigInt(tx.nonce))}</Detail>
      )}
      {tx.position === null ? null : (
        <Detail label="Position">{tx.position}</Detail>
      )}
    </Details>
  )
}

/**
 * Every log, the first three open and the rest behind "Show all N logs": a
 * swap with 25 logs was 12,340px tall on a phone and 7,888px on desktop.
 */
function Logs({ logs }: { logs: LogView[] }): ReactNode {
  if (logs.length === 0) return null
  return (
    <div className="mt-4">
      <ShowAll noun="logs">
        {logs.map((log) => (
          <RawViewer.Root
            key={log.index}
            title={`Log ${log.index}`}
            accessory={<AddressLink view={log.address} />}
            decoded={log.decoded}
            raw={{ kind: "log", topics: log.topics, data: log.data }}
          />
        ))}
      </ShowAll>
    </div>
  )
}

/** The decoded actions, when there is more than the title already says. */
function Actions({
  activity,
  now,
}: {
  activity: ReturnType<typeof Route.useLoaderData>["activity"]
  now: number
}): ReactNode {
  if (activity.status === "ok" && activity.data.length < 2) return null
  return (
    <section aria-labelledby="actions" className="mt-12 max-w-[760px]">
      <SectionHeading id="actions">Actions</SectionHeading>
      {activity.status === "ok" ? (
        <ActivityList rows={activity.data as ActivityView[]} now={now} />
      ) : (
        <SectionState section={activity} />
      )}
    </section>
  )
}

function Title({
  headline,
  loan,
}: {
  headline: Headline | null
  loan: string | null
}): ReactNode {
  if (headline === null || !headline.decoded) return loan ?? "Transaction"
  return <Sentence parts={headline.parts} />
}

/** Half an hour: past it, a page still indexing waits for a reload. */
const indexingMs = 30 * 60_000

const liveNote = {
  pending: "In the mempool, waiting for a block",
  mined: "Live from the chain, full details once indexed",
  indexing: "Live from the chain, full details once indexed",
}

function TransactionPage(): ReactNode {
  const { hash, tx, logs, activity, headline, labelsCapped, loan, now, live } =
    Route.useLoaderData()
  const loanView = loan?.status === "ok" ? loan.data : null
  useRefreshWhile(`index:${hash}`, live !== null, indexingMs)
  return (
    <>
      <Breadcrumbs.Root className="mt-8 max-xl:mt-5">
        <Breadcrumbs.Item asChild>
          <Link to="/network/transactions">Transactions</Link>
        </Breadcrumbs.Item>
        <Breadcrumbs.Current mono>{shortHash(hash)}</Breadcrumbs.Current>
      </Breadcrumbs.Root>
      <header className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3">
        <span className="grid size-16 flex-none place-items-center rounded-full bg-soft text-ink max-md:size-12">
          <Glyph shape={shapes.arrowRight} size={24} strokeWidth={1.8} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[34px] leading-tight font-[650] tracking-[-0.02em] max-md:text-[26px]">
              <Title headline={headline} loan={loanView?.title ?? null} />
            </h1>
            {tx.status === "ok" ? (
              <StatusChip.Root
                tone={StatusChip.txTone(tx.data.status)}
                variant="chip"
              >
                {statusWord[tx.data.status]}
              </StatusChip.Root>
            ) : null}
          </div>
          {loanView === null ? null : (
            <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-[15px] text-sec">
              {loanView.venue}
              {loanView.account === null ? null : (
                <AddressLink
                  view={{
                    address: loanView.account,
                    name: null,
                    contract: false,
                  }}
                />
              )}
              {loanView.against === null ? null : (
                <span>against {loanView.against}</span>
              )}
              {loanView.others === null ? null : <span>{loanView.others}</span>}
            </p>
          )}
          <HashChip.Root value={hash} kind="hash" className="mt-1 text-sec" />
          <p role="status" className="mt-2 text-[14px] text-sec empty:hidden">
            {live === null ? null : liveNote[live]}
          </p>
        </div>
      </header>
      {loan === null ? null : (
        <Suspense fallback={null}>
          <WhatChanged loan={loan} />
        </Suspense>
      )}
      <div
        className={
          loanView === null
            ? ""
            : "grid items-start gap-x-10 xl:grid-cols-[minmax(0,760px)_minmax(0,1fr)]"
        }
      >
        <section aria-labelledby="details" className="mt-10 max-w-[760px]">
          <SectionHeading id="details">Details</SectionHeading>
          {tx.status === "ok" ? (
            <Summary tx={tx.data} now={now} />
          ) : (
            <SectionState section={tx} />
          )}
          <LabelsCapped limit={labelsCapped} />
        </section>
        {loanView === null ? null : (
          <div className="mt-10">
            <Suspense fallback={null}>
              <PositionCard loan={loanView} />
            </Suspense>
          </div>
        )}
      </div>
      <Actions activity={activity} now={now} />
      <section aria-labelledby="input-logs" className="mt-12">
        <SectionHeading id="input-logs">Input and logs</SectionHeading>
        {tx.status === "ok" ? (
          <RawViewer.Root
            title="Input"
            decoded={tx.data.decoded}
            raw={{ kind: "input", data: tx.data.rawInput }}
          />
        ) : null}
        {logs.status === "ok" ? (
          <Logs logs={logs.data} />
        ) : (
          <div className="mt-4">
            <SectionState section={logs} />
          </div>
        )}
      </section>
    </>
  )
}
