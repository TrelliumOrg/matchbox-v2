import {
  smartContractSchema,
  tokenHoldersPageSchema,
  tokenSchema,
  tokenTransfersPageSchema,
} from "@matchbox/contracts/blockscout"
import { formatUnits, groupThousands } from "@matchbox/domain/format"
import { canonicalQuery, readBlockscout } from "./blockscout/read.server"
import { pickCursor } from "./cursors"
import type { Section } from "./explorer"
import { nameViews } from "./scan/names"
import { knownNames } from "./scan/names.server"
import {
  type TokenSlug,
  type TokenTab,
  tokenBySlug,
  tokenTabOf,
} from "./scan/token-list"
import { percentText, shareBps } from "./scan/voting-views"
import {
  type AddressView,
  addressView,
  type Cursor,
  cursorOf,
  type Page,
  transferView,
  unixSeconds,
} from "./views"

/**
 * The MUSD and MEZO pages' tabs past Overview, from the Blockscout proxy
 * (apps/api README, Blockscout proxy): Holders (`tokens/{a}/holders`, the
 * first page, with each holder's share of the supply from
 * `tokens/{a}`), Transfers (`tokens/{a}/transfers`, keyset pages) and
 * Contract (`smart-contracts/{a}`). Addresses are named from the
 * isolate's validator and gauge names. Left out until their data exists:
 * Loans, Savings vault, Locks and Emissions tabs, the transfers count and
 * every holder past the proxy's first page.
 */

export type HolderRow = {
  rank: number
  holder: AddressView
  /** "14,172,031.97" in the token's decimals. */
  balance: string
  /** "74.6%" of the supply; null without the supply. */
  share: string | null
  /** Basis points, for the bar. */
  shareBps: number | null
}

export type TokenHolders = {
  rows: HolderRow[]
  /** Every holder, "29,242"; null when the token read failed. */
  holders: string | null
  /** The proxy serves the first page only: more holders than shown. */
  more: boolean
}

export type TokenTransferRow = {
  hash: string
  /** The transfer's log in its transaction, for a stable row key. */
  logIndex: number | null
  block: number | null
  timestamp: number | null
  from: AddressView
  to: AddressView
  amount: string | null
}

export type TokenContract = {
  name: string | null
  verified: boolean
  language: string | null
  compiler: string | null
  evm: string | null
  optimization: string | null
  license: string | null
  proxy: string | null
  implementations: { address: string; name: string | null }[]
  verifiedAt: number | null
  /** ABI entries, when verified. */
  abiEntries: number | null
}

/** A tab past Overview. */
export type DataTab = Exclude<TokenTab, "overview">

export type TokenTabData =
  | { tab: "holders"; data: Section<TokenHolders> }
  | { tab: "transfers"; data: Section<Page<TokenTransferRow>> }
  | { tab: "contract"; data: Section<TokenContract> }

function sectionOf<In, Out>(
  read: Awaited<ReturnType<typeof readBlockscout<In>>>,
  map: (data: In) => Out,
): Section<Out> {
  if (read.status === "ok") return { status: "ok", data: map(read.data) }
  if (read.status === "rate-limited") return { status: "rate-limited" }
  return { status: "unavailable" }
}

async function holdersTab(address: string): Promise<Section<TokenHolders>> {
  const [page, token, names] = await Promise.all([
    readBlockscout(
      `tokens/${address}/holders`,
      new URLSearchParams(),
      tokenHoldersPageSchema,
    ),
    readBlockscout(`tokens/${address}`, new URLSearchParams(), tokenSchema),
    knownNames(),
  ])
  const supply =
    token.status === "ok" && token.data.total_supply !== null
      ? BigInt(token.data.total_supply)
      : null
  const decimals =
    token.status === "ok" && token.data.decimals !== null
      ? Number(token.data.decimals)
      : 18
  return sectionOf(page, (holders) =>
    nameViews(
      {
        rows: holders.items.map((item, index) => {
          const bps =
            supply === null || supply === 0n
              ? null
              : shareBps(BigInt(item.value), supply)
          return {
            rank: index + 1,
            holder: addressView(item.address),
            balance: formatUnits(item.value, decimals),
            share: bps === null ? null : percentText(bps),
            shareBps: bps,
          }
        }),
        holders:
          token.status === "ok" && token.data.holders_count !== null
            ? groupThousands(BigInt(token.data.holders_count))
            : null,
        more: holders.next_page_params !== null,
      },
      names,
    ),
  )
}

async function transfersTab(
  address: string,
  cursor: Cursor | null,
): Promise<Section<Page<TokenTransferRow>>> {
  const [page, names] = await Promise.all([
    readBlockscout(
      `tokens/${address}/transfers`,
      canonicalQuery(cursor ?? {}),
      tokenTransfersPageSchema,
    ),
    knownNames(),
  ])
  return sectionOf(page, (transfers) =>
    nameViews(
      {
        items: transfers.items.map((transfer) => {
          const view = transferView(transfer)
          return {
            hash: transfer.transaction_hash.toLowerCase(),
            logIndex: transfer.log_index,
            block: transfer.block_number,
            timestamp: unixSeconds(transfer.timestamp),
            from: view.from,
            to: view.to,
            amount: view.amount,
          }
        }),
        next: cursorOf(transfers.next_page_params),
      },
      names,
    ),
  )
}

async function contractTab(address: string): Promise<Section<TokenContract>> {
  const read = await readBlockscout(
    `smart-contracts/${address}`,
    new URLSearchParams(),
    smartContractSchema,
  )
  return sectionOf(read, (contract) => ({
    name: contract.name,
    verified: contract.is_verified === true,
    language: contract.language,
    compiler: contract.compiler_version,
    evm: contract.evm_version,
    optimization:
      contract.optimization_enabled === null
        ? null
        : contract.optimization_enabled
          ? `Yes, ${contract.optimization_runs ?? "?"} runs`
          : "No",
    license: contract.license_type,
    proxy: contract.proxy_type,
    implementations: (contract.implementations ?? []).map((entry) => ({
      address: entry.address_hash.toLowerCase(),
      name: entry.name,
    })),
    verifiedAt: unixSeconds(contract.verified_at),
    abiEntries: contract.abi === null ? null : contract.abi.length,
  }))
}

export async function tokenTab(input: {
  slug: TokenSlug
  tab: DataTab
  cursor: Record<string, unknown>
}): Promise<TokenTabData> {
  const address = tokenBySlug(input.slug === "mezo" ? "mezo" : "musd").address
  const named = tokenTabOf(input.tab)
  const tab = named === null || named === "overview" ? "holders" : named
  if (tab === "transfers") {
    return {
      tab,
      data: await transfersTab(
        address,
        pickCursor("tokenTransfers", input.cursor),
      ),
    }
  }
  if (tab === "contract") return { tab, data: await contractTab(address) }
  return { tab: "holders", data: await holdersTab(address) }
}
