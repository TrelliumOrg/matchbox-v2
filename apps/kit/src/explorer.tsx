import * as Age from "@matchbox/ui/age"
import * as Breadcrumbs from "@matchbox/ui/breadcrumbs"
import * as CursorPager from "@matchbox/ui/cursor-pager"
import * as DataTable from "@matchbox/ui/data-table"
import * as HashChip from "@matchbox/ui/hash-chip"
import * as RawViewer from "@matchbox/ui/raw-viewer"
import * as StatusChip from "@matchbox/ui/status-chip"
import { type ReactNode, useState } from "react"

/**
 * Matchscan's explorer components (Doop page `wr36mw4gua`): the
 * transactions table, cursor pager, address and hash chips, ages, status
 * chips, breadcrumbs and the raw data viewer.
 */

function Section({
  id,
  title,
  children,
}: {
  id: string
  title: string
  children: ReactNode
}): ReactNode {
  return (
    <section aria-labelledby={id} className="mt-24">
      <h2 id={id} className="text-2xl font-[650] tracking-[-0.015em]">
        {title}
      </h2>
      <div className="mt-8 flex flex-col gap-12">{children}</div>
    </section>
  )
}

function Spec({
  caption,
  children,
}: {
  caption: string
  children: ReactNode
}): ReactNode {
  return (
    <figure className="flex w-full flex-col items-start gap-3.5">
      {children}
      <figcaption className="text-sm text-sec">{caption}</figcaption>
    </figure>
  )
}

const head = 13_078_795
const blockTime = Math.floor(Date.now() / 1000)

type Row = {
  action: string
  detail: string
  from: string
  block: number
  ageSeconds: number
  status: "success" | "failed"
}

const rows: readonly Row[] = [
  {
    action: "Repaid MUSD",
    detail: "Loan #8214",
    from: "0x7c21a4b8f3e9d2c1b0a5968778f6e5d4c3b29e0b",
    block: 13_078_612,
    ageSeconds: 12 * 60,
    status: "success",
  },
  {
    action: "Added collateral",
    detail: "Loan #8211",
    from: "0xa3f0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e67d52",
    block: 13_078_148,
    ageSeconds: 41 * 60,
    status: "success",
  },
  {
    action: "Withdrew collateral",
    detail: "Loan #6650",
    from: "0x1f07a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6c64e",
    block: 13_073_427,
    ageSeconds: 5 * 3600,
    status: "failed",
  },
]

const grouped = (value: number): string =>
  value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")

function TableDemo(): ReactNode {
  const [page, setPage] = useState<"latest" | "older">("latest")
  return (
    <Spec caption="Data table and cursor pager. Below 768px each row reflows to two lines, and the pager moves by keyset cursor, never by offset.">
      <div className="w-full">
        <DataTable.Root caption="Latest transactions">
          <DataTable.Header>
            <DataTable.Column>Action</DataTable.Column>
            <DataTable.Column>From</DataTable.Column>
            <DataTable.Column>Block</DataTable.Column>
            <DataTable.Column align="end">Age</DataTable.Column>
            <DataTable.Column align="end">Status</DataTable.Column>
          </DataTable.Header>
          <DataTable.Body>
            {page === "older" ? (
              <DataTable.Empty columns={5}>
                No older transactions
              </DataTable.Empty>
            ) : (
              rows.map((row) => (
                <DataTable.Row key={row.block}>
                  <DataTable.Cell phone="title">
                    <span className="block font-semibold">{row.action}</span>
                    <span className="block text-[14.5px] text-sec max-md:hidden">
                      {row.detail}
                    </span>
                  </DataTable.Cell>
                  <DataTable.Cell phone="detail">
                    <HashChip.Root value={row.from}>
                      <HashChip.Value />
                    </HashChip.Root>
                  </DataTable.Cell>
                  <DataTable.Cell phone="hidden">
                    <a
                      href={`#block-${row.block}`}
                      className="font-mono underline decoration-line underline-offset-[5px]"
                    >
                      {grouped(row.block)}
                    </a>
                  </DataTable.Cell>
                  <DataTable.Cell align="end" phone="meta">
                    <Age.Root
                      timestamp={blockTime - row.ageSeconds}
                      now={blockTime}
                    />
                  </DataTable.Cell>
                  <DataTable.Cell align="end" phone="value">
                    <StatusChip.Root tone={StatusChip.txTone(row.status)}>
                      {row.status === "success" ? "Success" : "Failed"}
                    </StatusChip.Root>
                  </DataTable.Cell>
                </DataTable.Row>
              ))
            )}
          </DataTable.Body>
        </DataTable.Root>
        <CursorPager.Root className="mt-2">
          <CursorPager.Summary>
            {page === "latest" ? "Latest 3" : "Before block 13,073,427"}
          </CursorPager.Summary>
          <CursorPager.Newer disabled={page === "latest"} asChild>
            <button type="button" onClick={() => setPage("latest")} />
          </CursorPager.Newer>
          <CursorPager.Older disabled={page === "older"} asChild>
            <button type="button" onClick={() => setPage("older")} />
          </CursorPager.Older>
        </CursorPager.Root>
      </div>
    </Spec>
  )
}

const input = {
  name: "repay(uint256 amount, address upperHint, address lowerHint)",
  params: [
    { name: "amount", type: "uint256", value: "5000000000000000000000" },
    {
      name: "upperHint",
      type: "address",
      value: "0x0000000000000000000000000000000000000000",
    },
    {
      name: "lowerHint",
      type: "address",
      value: "0x0000000000000000000000000000000000000000",
    },
  ],
}

export function Explorer(): ReactNode {
  return (
    <Section id="explorer" title="Explorer">
      <Spec caption="Breadcrumbs above an entity title. The current page is marked for screen readers.">
        <Breadcrumbs.Root>
          <Breadcrumbs.Item href="#network">Network</Breadcrumbs.Item>
          <Breadcrumbs.Item href="#blocks">Blocks</Breadcrumbs.Item>
          <Breadcrumbs.Current mono>{grouped(head)}</Breadcrumbs.Current>
        </Breadcrumbs.Root>
      </Spec>
      <Spec caption="Address and hash chips: shortened in the middle, linked, copied in full.">
        <div className="flex flex-wrap items-center gap-8">
          <HashChip.Root value="0x7f3a9c21d0e4b8f61a2c3e5d7b9f0a1c2e4d91c2">
            <HashChip.Value href="#address" />
            <HashChip.Copy />
          </HashChip.Root>
          <HashChip.Root
            kind="hash"
            value="0x8f3c2e71aa0b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f80915b09a41d"
          />
        </div>
      </Spec>
      <Spec caption="Ages and timestamps in UTC, with the full time on hover.">
        <div className="flex flex-wrap items-center gap-8 text-[15px]">
          <Age.Root timestamp={blockTime - 720} now={blockTime} />
          <Age.Timestamp timestamp={blockTime - 4} now={blockTime} />
        </div>
      </Spec>
      <Spec caption="Status chips carry real state only, always with the word.">
        <div className="flex flex-wrap items-center gap-6">
          <StatusChip.Root tone="positive">Success</StatusChip.Root>
          <StatusChip.Root tone="negative">Failed</StatusChip.Root>
          <StatusChip.Root tone="pending">Pending</StatusChip.Root>
          <StatusChip.Root tone="positive" variant="chip">
            Finalized
          </StatusChip.Root>
          <StatusChip.Root tone="neutral" variant="chip">
            Active
          </StatusChip.Root>
        </div>
      </Spec>
      <TableDemo />
      <Spec caption="Raw data viewer: the decoded call or event, or the raw hex with a copy button.">
        <div className="grid w-full gap-4 lg:grid-cols-2">
          <RawViewer.Root
            title="Input"
            decoded={input}
            raw={{
              kind: "input",
              data: "0x371fd8e600000000000000000000000000000000000000000000010f0cf064dd5920000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
            }}
          />
          <RawViewer.Root
            title="Log 2"
            decoded={null}
            raw={{
              kind: "log",
              topics: [
                "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
                "0x0000000000000000000000007c21a4b8f3e9d2c1b0a5968778f6e5d4c3b29e0b",
              ],
              data: "0x00000000000000000000000000000000000000000000010f0cf064dd59200000",
            }}
          />
        </div>
      </Spec>
    </Section>
  )
}
