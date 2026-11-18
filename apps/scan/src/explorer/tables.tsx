import * as Age from "@matchbox/ui/age"
import * as DataTable from "@matchbox/ui/data-table"
import * as StatusChip from "@matchbox/ui/status-chip"
import * as UntrustedText from "@matchbox/ui/untrusted-text"
import type { ReactNode } from "react"
import type { AddressTransfer, BlockRow, TxRow } from "../data/views"
import {
  AddressLink,
  AddressStack,
  BlockLink,
  ShortHash,
  TxLink,
} from "./parts"

/**
 * The chain lists (`ndoSD6xB0U`, `YY3BAmH_lR`): rows on hairlines that
 * reflow to two lines below 1280px, where Scan's phone layout runs.
 * Columns follow the frames; "Took" shows where the list has each block's
 * time after its parent.
 */

const statusWord = { success: "Success", failed: "Failed", pending: "Pending" }

export function TransactionsTable({
  caption,
  rows,
  now,
  showBlock = true,
}: {
  caption: string
  rows: readonly TxRow[]
  now: number
  showBlock?: boolean
}): ReactNode {
  return (
    <DataTable.Root caption={caption} captionHidden reflow="xl">
      <DataTable.Header>
        <DataTable.Column>Transaction</DataTable.Column>
        <DataTable.Column>Method</DataTable.Column>
        <DataTable.Column>From</DataTable.Column>
        <DataTable.Column>To</DataTable.Column>
        <DataTable.Column align="end">Value (BTC)</DataTable.Column>
        {showBlock ? <DataTable.Column>Block</DataTable.Column> : null}
        <DataTable.Column align="end">Age</DataTable.Column>
        <DataTable.Column align="end">Status</DataTable.Column>
      </DataTable.Header>
      <DataTable.Body>
        {rows.length === 0 ? (
          <DataTable.Empty columns={showBlock ? 8 : 7}>
            No transactions
          </DataTable.Empty>
        ) : (
          rows.map((row) => (
            <DataTable.Row key={row.hash}>
              <DataTable.Cell phone="title">
                <TxLink hash={row.hash} />
              </DataTable.Cell>
              <DataTable.Cell phone="detail">
                {row.method === null ? (
                  <span className="text-sec">Transfer</span>
                ) : (
                  <span className="font-mono text-[14px]">
                    <UntrustedText.Root value={row.method} limit={32} />
                  </span>
                )}
              </DataTable.Cell>
              <DataTable.Cell>
                <AddressLink view={row.from} />
              </DataTable.Cell>
              <DataTable.Cell>
                {row.to === null ? (
                  <span className="text-sec">None</span>
                ) : (
                  <AddressLink view={row.to} />
                )}
              </DataTable.Cell>
              <DataTable.Cell align="end" className="tabular-nums">
                {row.value ?? <span className="text-sec">0</span>}
              </DataTable.Cell>
              {showBlock ? (
                <DataTable.Cell>
                  {row.block === null ? (
                    <span className="text-sec">Pending</span>
                  ) : (
                    <BlockLink height={row.block} />
                  )}
                </DataTable.Cell>
              ) : null}
              <DataTable.Cell align="end" phone="meta">
                {row.timestamp === null ? null : (
                  <Age.Root timestamp={row.timestamp} now={now} />
                )}
              </DataTable.Cell>
              <DataTable.Cell align="end" phone="value">
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

export function BlocksTable({
  caption,
  rows,
  now,
}: {
  caption: string
  rows: readonly (BlockRow & { took?: string | null })[]
  now: number
}): ReactNode {
  const took = rows.some((row) => row.took !== undefined)
  return (
    <DataTable.Root caption={caption} captionHidden reflow="xl">
      <DataTable.Header>
        <DataTable.Column>Block</DataTable.Column>
        <DataTable.Column>Proposer</DataTable.Column>
        <DataTable.Column align="end">Txs</DataTable.Column>
        <DataTable.Column>Gas used</DataTable.Column>
        {took ? <DataTable.Column align="end">Took</DataTable.Column> : null}
        <DataTable.Column align="end">Age</DataTable.Column>
      </DataTable.Header>
      <DataTable.Body>
        {rows.length === 0 ? (
          <DataTable.Empty columns={took ? 6 : 5}>No blocks</DataTable.Empty>
        ) : (
          rows.map((row) => (
            <DataTable.Row key={row.height}>
              <DataTable.Cell phone="title">
                <span className="flex flex-col">
                  <BlockLink height={row.height} />
                  <ShortHash hash={row.hash} />
                </span>
              </DataTable.Cell>
              <DataTable.Cell phone="detail">
                <AddressStack view={row.miner} />
              </DataTable.Cell>
              <DataTable.Cell
                align="end"
                phone="value"
                className="tabular-nums"
              >
                {row.transactions}
                <span className="sr-only xl:hidden"> transactions</span>
              </DataTable.Cell>
              <DataTable.Cell>
                <span className="flex items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="relative h-1.5 w-28 overflow-hidden rounded-full bg-soft2"
                  >
                    <span
                      className="absolute inset-y-0 left-0 rounded-full bg-ink"
                      style={{ width: `${Math.max(row.gasShare * 100, 0)}%` }}
                    />
                  </span>
                  <span className="tabular-nums">{row.gasUsed}</span>
                  <span className="text-[14px] text-sec">{row.gasPercent}</span>
                </span>
              </DataTable.Cell>
              {took ? (
                <DataTable.Cell align="end" className="tabular-nums">
                  {row.took ?? ""}
                  {row.took === null || row.took === undefined ? null : (
                    <span className="sr-only xl:hidden"> block time</span>
                  )}
                </DataTable.Cell>
              ) : null}
              <DataTable.Cell align="end" phone="meta">
                {row.timestamp === null ? null : (
                  <Age.Root timestamp={row.timestamp} now={now} />
                )}
              </DataTable.Cell>
            </DataTable.Row>
          ))
        )}
      </DataTable.Body>
    </DataTable.Root>
  )
}

const directionWord = { in: "In", out: "Out", self: "Self" }

export function TransfersTable({
  caption,
  rows,
  now,
}: {
  caption: string
  rows: readonly AddressTransfer[]
  now: number
}): ReactNode {
  return (
    <DataTable.Root caption={caption} captionHidden reflow="xl">
      <DataTable.Header>
        <DataTable.Column>Transaction</DataTable.Column>
        <DataTable.Column>Token</DataTable.Column>
        <DataTable.Column align="end">Amount</DataTable.Column>
        <DataTable.Column>Direction</DataTable.Column>
        <DataTable.Column>Counterparty</DataTable.Column>
        <DataTable.Column align="end">Age</DataTable.Column>
      </DataTable.Header>
      <DataTable.Body>
        {rows.length === 0 ? (
          <DataTable.Empty columns={6}>No token transfers</DataTable.Empty>
        ) : (
          rows.map((row) => (
            <DataTable.Row
              key={`${row.hash}-${row.token.address}-${row.from.address}-${row.to.address}-${row.amount ?? row.tokenId ?? ""}`}
            >
              <DataTable.Cell phone="title">
                <TxLink hash={row.hash} />
              </DataTable.Cell>
              <DataTable.Cell phone="detail">
                <UntrustedText.Root
                  value={
                    row.token.symbol ?? row.token.name ?? row.token.address
                  }
                  limit={24}
                />
              </DataTable.Cell>
              <DataTable.Cell
                align="end"
                phone="value"
                className="tabular-nums"
              >
                {row.amount ?? (row.tokenId === null ? "" : `#${row.tokenId}`)}
              </DataTable.Cell>
              <DataTable.Cell>{directionWord[row.direction]}</DataTable.Cell>
              <DataTable.Cell>
                <AddressLink
                  view={row.direction === "out" ? row.to : row.from}
                />
              </DataTable.Cell>
              <DataTable.Cell align="end" phone="meta">
                {row.timestamp === null ? null : (
                  <Age.Root timestamp={row.timestamp} now={now} />
                )}
              </DataTable.Cell>
            </DataTable.Row>
          ))
        )}
      </DataTable.Body>
    </DataTable.Root>
  )
}
