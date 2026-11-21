import * as Age from "@matchbox/ui/age"
import * as DataTable from "@matchbox/ui/data-table"
import * as HashChip from "@matchbox/ui/hash-chip"
import { Glyph, type GlyphShape, shapes } from "@matchbox/ui/icons"
import * as StatusChip from "@matchbox/ui/status-chip"
import * as SubTabs from "@matchbox/ui/sub-tabs"
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { type TxTab, txTabNames, txTabs } from "../../data/transaction-tabs"
import type { TransactionsPage, TxWords } from "../../data/transactions"
import { AddressLink, BlockLink, Pager, SectionState } from "../parts"
import { ActivityList, Sentence } from "../sentence"

/**
 * Transactions (`ndoSD6xB0U`): the category tabs, then All as a table in
 * plain words (action, from and to, amount with its token, block, age,
 * status), or a category's activity in sentences.
 */

const statusWord = { success: "Success", failed: "Failed", pending: "Pending" }

const icons: Readonly<Record<string, GlyphShape>> = {
  LOAN: shapes.creditCard,
  TRANSFER: shapes.arrowRight,
  CONTRACT: shapes.box,
  CALL: shapes.box,
  BOOST_VOTE: shapes.squareCheck,
  BOOST_ABSTAIN: shapes.squareCheck,
  BOOST_POKE: shapes.squareCheck,
  VOTE_BRIBE_CLAIMED: shapes.coins,
  VOTE_FEE_CLAIMED: shapes.coins,
  INCENTIVE_ADDED: shapes.coins,
  SWAP: shapes.arrowRight,
}

function iconOf(key: string): GlyphShape {
  if (key.startsWith("LOCK_")) return shapes.lock
  return icons[key] ?? shapes.box
}

/**
 * On a phone a row is one target: its transaction link covers the row
 * (an `::after` over it), and the row's other links sit above that. Each
 * link was 22px tall and a row held five of them.
 */
const rowLink =
  "max-xl:relative max-xl:[&_[data-row-link]]:after:absolute max-xl:[&_[data-row-link]]:after:inset-0 max-xl:[&_[data-row-link]]:after:content-[''] max-xl:[&_a:not([data-row-link])]:relative max-xl:[&_a:not([data-row-link])]:z-[1]"

export function TransactionTabs({ current }: { current: TxTab }): ReactNode {
  return (
    <SubTabs.Root label="Transaction types" className="mt-5">
      {txTabs.map((tab) => (
        <SubTabs.Item key={tab}>
          <Link
            to="/network/transactions"
            search={tab === "all" ? {} : { tab }}
            aria-current={tab === current ? "page" : undefined}
            activeOptions={{ exact: true, includeSearch: true }}
            activeProps={{}}
          >
            {txTabNames[tab]}
          </Link>
        </SubTabs.Item>
      ))}
    </SubTabs.Root>
  )
}

function WordsTable({
  rows,
  now,
}: {
  rows: readonly TxWords[]
  now: number
}): ReactNode {
  return (
    <DataTable.Root caption="Latest transactions" captionHidden reflow="xl">
      <DataTable.Header>
        <DataTable.Column>Action</DataTable.Column>
        <DataTable.Column>From</DataTable.Column>
        <DataTable.Column align="end">Amount</DataTable.Column>
        <DataTable.Column>Block</DataTable.Column>
        <DataTable.Column align="end">Age</DataTable.Column>
        <DataTable.Column align="end">Status</DataTable.Column>
      </DataTable.Header>
      <DataTable.Body>
        {rows.length === 0 ? (
          <DataTable.Empty columns={6}>No transactions</DataTable.Empty>
        ) : (
          rows.map((row) => (
            <DataTable.Row key={row.hash} className={rowLink}>
              <DataTable.Cell phone="title">
                <span className="flex min-w-0 items-center gap-3">
                  <span className="grid size-9 flex-none place-items-center rounded-full bg-soft text-ink">
                    <Glyph
                      shape={iconOf(row.icon)}
                      size={16}
                      strokeWidth={1.8}
                    />
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="font-semibold">
                      <Sentence parts={row.parts} />
                      {row.more > 0 ? (
                        <span className="font-normal text-sec">
                          , {row.more} more
                        </span>
                      ) : null}
                    </span>
                    <HashChip.Root value={row.hash} kind="hash">
                      <HashChip.Value asChild>
                        <Link
                          to="/tx/$hash"
                          params={{ hash: row.hash }}
                          data-row-link=""
                        />
                      </HashChip.Value>
                    </HashChip.Root>
                  </span>
                </span>
              </DataTable.Cell>
              <DataTable.Cell phone="detail">
                <span className="flex min-w-0 flex-col">
                  <AddressLink view={row.from} />
                  {row.to === null ? null : (
                    <span className="text-[14.5px] text-sec">
                      to <AddressLink view={row.to} />
                    </span>
                  )}
                </span>
              </DataTable.Cell>
              <DataTable.Cell
                align="end"
                phone="value"
                className="tabular-nums"
              >
                {row.amount}
              </DataTable.Cell>
              <DataTable.Cell>
                {row.block === null ? (
                  <span className="text-sec">Pending</span>
                ) : (
                  <BlockLink height={row.block} />
                )}
              </DataTable.Cell>
              <DataTable.Cell align="end" phone="meta">
                {row.timestamp === null ? null : (
                  <Age.Root timestamp={row.timestamp} now={now} />
                )}
              </DataTable.Cell>
              <DataTable.Cell align="end">
                <StatusChip.Root tone={StatusChip.txTone(row.status)}>
                  {statusWord[row.status]}
                </StatusChip.Root>
              </DataTable.Cell>
            </DataTable.Row>
          ))
        )}
      </DataTable.Body>
    </DataTable.Root>
  )
}

export function TransactionsBody({
  page,
  paged,
  now,
}: {
  page: TransactionsPage
  paged: boolean
  now: number
}): ReactNode {
  if (page.tab === "all") {
    const { list } = page
    return list.status !== "ok" ? (
      <SectionState section={list} />
    ) : (
      <>
        <Pager
          position="top"
          label="Transaction pages"
          paged={paged}
          next={list.data.next}
          to="/network/transactions"
        />
        <WordsTable rows={list.data.items} now={now} />
        <Pager
          position="bottom"
          label="Transaction pages"
          paged={paged}
          next={list.data.next}
          to="/network/transactions"
        />
      </>
    )
  }
  const { list } = page
  return list.status !== "ok" ? (
    <SectionState section={list} />
  ) : (
    <>
      {list.data.rows.length === 0 ? null : (
        <Pager
          position="top"
          label="Transaction pages"
          paged={paged}
          next={list.data.next === null ? null : { cursor: list.data.next }}
          to="/network/transactions"
          extra={{ tab: page.tab }}
        />
      )}
      {list.data.rows.length === 0 ? (
        <p className="py-10 text-center text-[15px] text-sec">
          No {txTabNames[page.tab].toLowerCase()} yet
        </p>
      ) : (
        <ActivityList rows={list.data.rows} now={now} />
      )}
      <Pager
        position={list.data.rows.length === 0 ? "only" : "bottom"}
        label="Transaction pages"
        paged={paged}
        next={list.data.next === null ? null : { cursor: list.data.next }}
        to="/network/transactions"
        extra={{ tab: page.tab }}
        skipped={list.skipped}
      />
    </>
  )
}
