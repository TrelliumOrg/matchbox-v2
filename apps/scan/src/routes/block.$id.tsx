import { groupThousands, shortHash } from "@matchbox/domain/format"
import { useLive } from "@matchbox/live/context"
import { useHead } from "@matchbox/live/heads"
import * as Age from "@matchbox/ui/age"
import * as Breadcrumbs from "@matchbox/ui/breadcrumbs"
import * as HashChip from "@matchbox/ui/hash-chip"
import { Glyph, shapes } from "@matchbox/ui/icons"
import {
  createFileRoute,
  Link,
  notFound,
  redirect,
} from "@tanstack/react-router"
import type { ReactNode } from "react"
import { canonicalBlock } from "../data/canonical"
import { pickCursor } from "../data/cursors"
import { getBlockPage } from "../data/entities"
import type { BlockDetail } from "../data/views"
import {
  AddressStack,
  Detail,
  Details,
  LabelsCapped,
  Pager,
  SectionHeading,
  SectionState,
} from "../explorer/parts"
import { TransactionsTable } from "../explorer/tables"
import { EntityPage, StepIcon, Steps, stepClass } from "../shell/entity"

const grouped = (value: number): string => groupThousands(BigInt(value))

/**
 * A block (`IRUlSH8UWm`), by height or hash: the stats card (transactions,
 * gas used against the limit, fees and where they went), details, and its
 * transactions with the keyset pager, from one composed document. The
 * proposer is named by our labels (validators), else by address. Left out
 * until their data exists: block time (needs the previous block), the
 * proposer card's domain figures and the USD values (no price at the
 * block). Signatures and finality are left out until a source exists:
 * they need a consensus RPC, which Mezo does not serve.
 */
export const Route = createFileRoute("/block/$id")({
  validateSearch: (search: Record<string, unknown>) =>
    pickCursor("blockTransactions", search) ?? {},
  loaderDeps: ({ search }) => ({ cursor: search }),
  loader: async ({ params, deps }) => {
    const block = canonicalBlock(params.id)
    if (block === null) throw notFound()
    if (block.segment !== params.id) {
      throw redirect({
        to: "/block/$id",
        params: { id: block.segment },
        statusCode: 301,
      })
    }
    const page = await getBlockPage({
      data: { id: block.segment, cursor: deps.cursor },
    })
    const detail = page.block
    const transactions = page.transactions
    if (detail.status === "missing") throw notFound()
    return {
      id: block.segment,
      labelsCapped: page.labelsCapped,
      detail,
      transactions,
      paged: pickCursor("blockTransactions", deps.cursor) !== null,
      now: Math.floor(Date.now() / 1000),
    }
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title:
          loaderData?.detail.status === "ok"
            ? `Block ${grouped(loaderData.detail.data.height)}, Matchscan`
            : "Block, Matchscan",
      },
    ],
  }),
  component: BlockPage,
  notFoundComponent: BlockNotFound,
})

function Bar({
  share,
  label,
  className,
}: {
  share: number
  label: string
  className: string
}): ReactNode {
  return (
    <span className="relative block h-10 overflow-hidden rounded-[14px] bg-soft2">
      <span
        className={`absolute inset-y-0 left-0 ${className}`}
        style={{ width: `${Math.min(100, Math.max(0, share * 100))}%` }}
      />
      <span className="relative flex h-full items-center px-3 text-[14px] font-semibold">
        {label}
      </span>
    </span>
  )
}

function Stats({ block }: { block: BlockDetail }): ReactNode {
  return (
    <section
      aria-label="Block figures"
      className="mt-8 rounded-[24px] bg-soft p-7 max-md:p-5"
    >
      <dl className="grid grid-cols-3 gap-6 max-md:grid-cols-1">
        <div>
          <dt className="text-[15px] text-sec">Transactions</dt>
          <dd className="mt-1 text-[23px] font-[650] tabular-nums">
            {block.transactions}
          </dd>
        </div>
        <div>
          <dt className="text-[15px] text-sec">Gas used</dt>
          <dd className="mt-1 text-[23px] font-[650] tabular-nums">
            {block.gasUsed}
          </dd>
          <dd className="text-[15px] text-sec">{block.gasPercent} of limit</dd>
        </div>
        {block.fees === null ? null : (
          <div>
            <dt className="text-[15px] text-sec">Fees paid</dt>
            <dd className="mt-1 text-[23px] font-[650] tabular-nums">
              {block.fees}
              <span className="ml-1.5 text-[15px] font-normal text-sec">
                BTC
              </span>
            </dd>
          </div>
        )}
      </dl>
      <div className="mt-6 grid gap-6 border-t border-line pt-6 md:grid-cols-2">
        <div>
          <p className="mb-2 flex justify-between text-[15px]">
            <span className="font-semibold">Gas used vs limit</span>
            <span className="text-sec tabular-nums">
              {block.gasUsed} of {block.gasLimit}
            </span>
          </p>
          <Bar
            share={block.gasShare}
            label={block.gasPercent}
            className="bg-ink/15"
          />
        </div>
        {block.burntShare === null ? null : (
          <div>
            <p className="mb-2 flex justify-between text-[15px]">
              <span className="font-semibold">Where the fees went</span>
              <span className="text-sec tabular-nums">{block.fees} BTC</span>
            </p>
            <p className="flex justify-between text-[14.5px] tabular-nums">
              <span>Burned {block.burnt}</span>
              <span>Proposer {block.priority}</span>
            </p>
          </div>
        )}
      </div>
    </section>
  )
}

function BlockPage(): ReactNode {
  const { id, detail, transactions, paged, labelsCapped, now } =
    Route.useLoaderData()
  // The live head, so Next appears as soon as the next block lands.
  const head = useHead(useLive().store).number
  const block = detail.status === "ok" ? detail.data : null
  const height = block?.height ?? null
  return (
    <>
      <Breadcrumbs.Root className="mt-8 max-xl:mt-5">
        <Breadcrumbs.Item asChild>
          <Link to="/network/blocks">Blocks</Link>
        </Breadcrumbs.Item>
        <Breadcrumbs.Current mono>
          {height === null ? shortHash(id) : grouped(height)}
        </Breadcrumbs.Current>
      </Breadcrumbs.Root>
      <header className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3">
        <span className="grid size-16 flex-none place-items-center rounded-full bg-soft text-ink max-md:size-12">
          <Glyph shape={shapes.box} size={24} strokeWidth={1.8} />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-[34px] leading-tight font-[650] tracking-[-0.02em] max-md:text-[28px]">
            {height === null ? "Block" : `Block ${grouped(height)}`}
          </h1>
          {block === null ? null : (
            <p className="mt-1 flex flex-wrap items-center gap-2 text-[15px] text-sec">
              Proposed by <AddressStack view={block.miner} />
            </p>
          )}
        </div>
        {height === null ? null : (
          <Steps>
            {height > 0 ? (
              <Link
                to="/block/$id"
                params={{ id: String(height - 1) }}
                className={stepClass}
                aria-label={`Previous block, ${grouped(height - 1)}`}
              >
                <StepIcon direction="previous" />
                {grouped(height - 1)}
              </Link>
            ) : null}
            {height < head ? (
              <Link
                to="/block/$id"
                params={{ id: String(height + 1) }}
                className={stepClass}
                aria-label={`Next block, ${grouped(height + 1)}`}
              >
                {grouped(height + 1)}
                <StepIcon direction="next" />
              </Link>
            ) : null}
          </Steps>
        )}
      </header>
      {block === null ? (
        <div className="mt-8">
          {detail.status === "ok" ? null : <SectionState section={detail} />}
        </div>
      ) : (
        <>
          <Stats block={block} />
          <section aria-labelledby="details" className="mt-10 max-w-[760px]">
            <SectionHeading id="details">Details</SectionHeading>
            <Details>
              <Detail label="Height">
                <span className="font-mono">{grouped(block.height)}</span>
              </Detail>
              <Detail label="Hash">
                <HashChip.Root value={block.hash} kind="hash" />
              </Detail>
              <Detail label="Parent">
                <HashChip.Root value={block.parentHash} kind="hash">
                  <HashChip.Value asChild>
                    <Link to="/block/$id" params={{ id: block.parentHash }} />
                  </HashChip.Value>
                  <HashChip.Copy />
                </HashChip.Root>
              </Detail>
              {block.timestamp === null ? null : (
                <Detail label="Time">
                  <Age.Timestamp timestamp={block.timestamp} now={now} />
                </Detail>
              )}
              <Detail label="Proposer">
                <AddressStack view={block.miner} />
              </Detail>
              <Detail label="Gas used">
                {block.gasUsed}
                <span className="text-sec"> of {block.gasLimit}</span>
              </Detail>
              {block.baseFee === null ? null : (
                <Detail label="Base fee">{block.baseFee}</Detail>
              )}
              {block.size === null ? null : (
                <Detail label="Size">{block.size}</Detail>
              )}
            </Details>
          </section>
        </>
      )}
      <section aria-labelledby="block-transactions" className="mt-12">
        <SectionHeading id="block-transactions">
          Transactions in this block
        </SectionHeading>
        {transactions.status === "ok" ? (
          <>
            <TransactionsTable
              caption="Transactions in this block"
              rows={transactions.data.items}
              now={now}
              showBlock={false}
            />
            {paged || transactions.data.next !== null ? (
              <Pager
                label="Transaction pages"
                paged={paged}
                next={transactions.data.next}
                to="/block/$id"
                params={{ id }}
              />
            ) : null}
          </>
        ) : (
          <SectionState section={transactions} />
        )}
        <LabelsCapped limit={labelsCapped} />
      </section>
    </>
  )
}

/** Not found: a valid height or hash Blockscout does not know (yet). */
function BlockNotFound(): ReactNode {
  const { id } = Route.useParams()
  const head = useHead(useLive().store).number
  const block = canonicalBlock(id)
  const future = block?.kind === "height" && block.height > head
  return (
    <EntityPage
      icon={shapes.box}
      title="Block"
      kind={block?.kind === "hash" ? "Block hash" : "Block height"}
      crumbs={[{ label: "Blocks", to: "/network/blocks" }]}
      current={
        block === null
          ? id.slice(0, 20)
          : block.kind === "hash"
            ? shortHash(block.segment)
            : grouped(block.height)
      }
      checks={[
        {
          label: "Format",
          value: block === null ? "Not a block" : "Valid block",
          detail: block?.kind === "hash" ? "0x + 64 hex" : "Height",
          passed: block !== null,
        },
        {
          label: "Explorer",
          value: future ? "Not produced yet" : "Not found",
          detail: `Head ${grouped(head)}`,
          passed: false,
        },
      ]}
    />
  )
}
