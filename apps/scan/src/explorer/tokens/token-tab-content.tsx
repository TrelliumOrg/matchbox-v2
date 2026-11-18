import { formatDate, shortAddress } from "@matchbox/domain/format"
import * as Age from "@matchbox/ui/age"
import * as DataTable from "@matchbox/ui/data-table"
import * as UntrustedText from "@matchbox/ui/untrusted-text"
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"
import type { TokenSlug } from "../../data/scan/token-list"
import type {
  TokenContract,
  TokenHolders,
  TokenTabData,
  TokenTransferRow,
} from "../../data/token-tabs"
import type { Page } from "../../data/views"
import {
  AddressLink,
  AddressStack,
  BlockLink,
  Detail,
  Details,
  Pager,
  SectionState,
  TxLink,
} from "../parts"
import { tabNames } from "./token-tabs"

/**
 * A token page tab past Overview: Holders, Transfers and Contract from the
 * Blockscout proxy. Its own chunk, loaded only when a tab is open, so the
 * Overview (the cross-chain sections and panels) keeps the room.
 */
function HoldersTable({ holders }: { holders: TokenHolders }): ReactNode {
  return (
    <>
      <DataTable.Root caption="Top holders" captionHidden reflow="md">
        <DataTable.Header>
          <DataTable.Column>#</DataTable.Column>
          <DataTable.Column>Holder</DataTable.Column>
          <DataTable.Column align="end">Balance</DataTable.Column>
          <DataTable.Column align="end">Share</DataTable.Column>
        </DataTable.Header>
        <DataTable.Body>
          {holders.rows.length === 0 ? (
            <DataTable.Empty columns={4}>No holders</DataTable.Empty>
          ) : (
            holders.rows.map((row) => (
              <DataTable.Row key={row.holder.address}>
                <DataTable.Cell className="text-sec tabular-nums">
                  {row.rank}
                </DataTable.Cell>
                <DataTable.Cell phone="title">
                  <AddressStack view={row.holder} />
                </DataTable.Cell>
                <DataTable.Cell
                  align="end"
                  phone="value"
                  className="tabular-nums"
                >
                  {row.balance}
                </DataTable.Cell>
                <DataTable.Cell align="end" phone="meta">
                  {row.share === null ? null : (
                    <span className="flex flex-col items-end gap-1.5">
                      <span className="text-[14.5px] tabular-nums">
                        {row.share}
                      </span>
                      <span
                        aria-hidden="true"
                        className="relative h-1.5 w-24 overflow-hidden rounded-full bg-soft2"
                      >
                        <span
                          className="absolute inset-y-0 left-0 rounded-full bg-ink"
                          style={{
                            width: `${Math.min(100, (row.shareBps ?? 0) / 100)}%`,
                          }}
                        />
                      </span>
                    </span>
                  )}
                </DataTable.Cell>
              </DataTable.Row>
            ))
          )}
        </DataTable.Body>
      </DataTable.Root>
      {holders.more ? (
        <p className="mt-4 text-[14.5px] text-sec">
          Top {holders.rows.length}
          {holders.holders === null ? "" : ` of ${holders.holders} holders`}
        </p>
      ) : null}
    </>
  )
}

function TransfersTable({
  slug,
  page,
  paged,
  now,
}: {
  slug: TokenSlug
  page: Page<TokenTransferRow>
  paged: boolean
  now: number
}): ReactNode {
  return (
    <>
      <DataTable.Root caption="Transfers" captionHidden reflow="xl">
        <DataTable.Header>
          <DataTable.Column>Transaction</DataTable.Column>
          <DataTable.Column>From</DataTable.Column>
          <DataTable.Column>To</DataTable.Column>
          <DataTable.Column align="end">Amount</DataTable.Column>
          <DataTable.Column>Block</DataTable.Column>
          <DataTable.Column align="end">Age</DataTable.Column>
        </DataTable.Header>
        <DataTable.Body>
          {page.items.length === 0 ? (
            <DataTable.Empty columns={6}>No transfers</DataTable.Empty>
          ) : (
            page.items.map((row) => (
              <DataTable.Row
                key={`${row.hash}-${row.logIndex ?? `${row.from.address}-${row.to.address}-${row.amount ?? ""}`}`}
              >
                <DataTable.Cell phone="title">
                  <TxLink hash={row.hash} />
                </DataTable.Cell>
                <DataTable.Cell phone="detail">
                  <AddressLink view={row.from} />
                </DataTable.Cell>
                <DataTable.Cell>
                  <AddressLink view={row.to} />
                </DataTable.Cell>
                <DataTable.Cell
                  align="end"
                  phone="value"
                  className="tabular-nums"
                >
                  {row.amount}
                </DataTable.Cell>
                <DataTable.Cell>
                  {row.block === null ? null : <BlockLink height={row.block} />}
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
      <Pager
        label="Transfer pages"
        paged={paged}
        next={page.next}
        to="/tokens/$token"
        params={{ token: slug }}
        extra={{ tab: "transfers" }}
      />
    </>
  )
}

function ContractDetails({ contract }: { contract: TokenContract }): ReactNode {
  return (
    <Details>
      <Detail label="Verified">
        {contract.verified ? "Yes" : "No"}
        {contract.verifiedAt === null
          ? null
          : `, ${formatDate(contract.verifiedAt)}`}
      </Detail>
      {contract.name === null ? null : (
        <Detail label="Contract name">
          <UntrustedText.Root value={contract.name} limit={60} />
        </Detail>
      )}
      {contract.proxy === null ? null : (
        <Detail label="Proxy">
          <UntrustedText.Root value={contract.proxy} limit={30} />
        </Detail>
      )}
      {contract.implementations.length === 0 ? null : (
        <Detail label="Implementation">
          <span className="flex flex-col gap-1">
            {contract.implementations.map((entry) => (
              <Link
                key={entry.address}
                to="/address/$address"
                params={{ address: entry.address }}
                className="w-fit rounded-sm outline-none hover:underline hover:underline-offset-4 focus-visible:outline-2 focus-visible:outline-ink"
              >
                {entry.name === null ? (
                  <span className="font-mono">
                    {shortAddress(entry.address)}
                  </span>
                ) : (
                  <UntrustedText.Root value={entry.name} limit={60} />
                )}
              </Link>
            ))}
          </span>
        </Detail>
      )}
      {(
        [
          ["Language", contract.language],
          ["Compiler", contract.compiler],
          ["EVM version", contract.evm],
          ["Optimization", contract.optimization],
          ["License", contract.license],
        ] as const
      ).map(([label, value]) =>
        value === null ? null : (
          <Detail key={label} label={label}>
            <UntrustedText.Root value={value} limit={60} />
          </Detail>
        ),
      )}
      {contract.abiEntries === null ? null : (
        <Detail label="ABI">{contract.abiEntries} entries</Detail>
      )}
    </Details>
  )
}

export function TokenTabContent({
  slug,
  tab,
  paged,
  now,
}: {
  slug: TokenSlug
  tab: TokenTabData
  paged: boolean
  now: number
}): ReactNode {
  return (
    <section aria-label={tabNames[tab.tab]} className="mt-6">
      <h2 className="sr-only">{tabNames[tab.tab]}</h2>
      {tab.tab === "holders" ? (
        tab.data.status === "ok" ? (
          <HoldersTable holders={tab.data.data} />
        ) : (
          <SectionState section={tab.data} />
        )
      ) : tab.tab === "transfers" ? (
        tab.data.status === "ok" ? (
          <TransfersTable
            slug={slug}
            page={tab.data.data}
            paged={paged}
            now={now}
          />
        ) : (
          <SectionState section={tab.data} />
        )
      ) : tab.data.status === "ok" ? (
        <ContractDetails contract={tab.data.data} />
      ) : (
        <SectionState section={tab.data} />
      )}
    </section>
  )
}
