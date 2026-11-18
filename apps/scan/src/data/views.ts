import type {
  BlockscoutAddress,
  BlockscoutAddressRef,
  BlockscoutBlock,
  BlockscoutLog,
  BlockscoutTokenTransfer,
  BlockscoutTransaction,
  BlockscoutTransactionSummary,
  NextPageParams,
} from "@matchbox/contracts/blockscout"
import {
  formatBtcFigure,
  formatDecimal,
  formatGwei,
  formatUnits,
  fromWei,
  groupThousands,
} from "@matchbox/domain/format"

/**
 * Blockscout's shapes (as the proxy trims them) to what Scan's pages draw:
 * amounts formatted from their exact base-unit strings with the domain
 * formatters, times as unix seconds, chain-supplied names kept as raw
 * strings for the page to render as untrusted text. Pure: the server
 * functions call these, so the browser gets view models, not formatters.
 */

export type AddressView = {
  /** Lower case. */
  address: string
  /** Blockscout's name (a verified contract's, an ENS-like tag); untrusted. */
  name: string | null
  contract: boolean
  /** Our label (validators, gauges, protocol contracts), when we have one. */
  label?: AddressLabel | null
}

/** A label from the labels read model; the name is rendered untrusted. */
export type AddressLabel = { name: string; kind: string; tags: string[] }

export type Cursor = Record<string, string>

export type Page<T> = { items: T[]; next: Cursor | null }

export function addressView(ref: BlockscoutAddressRef): AddressView {
  const implementation = ref.implementations?.[0]?.name ?? null
  return {
    address: ref.hash.toLowerCase(),
    name: ref.name ?? implementation,
    contract: ref.is_contract === true,
  }
}

/** ISO 8601 to unix seconds; null when absent or unreadable. */
export function unixSeconds(iso: string | null): number | null {
  if (iso === null) return null
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000)
}

/** A keyset cursor as URL query values; null at the end. */
export function cursorOf(next: NextPageParams): Cursor | null {
  if (next === null) return null
  const cursor: Cursor = {}
  for (const [key, value] of Object.entries(next)) {
    if (value !== null) cursor[key] = String(value)
  }
  return Object.keys(cursor).length === 0 ? null : cursor
}

/** A BTC amount by the house rule (4 decimals, small ones 3 figures), from wei. */
export function btc(wei: string | null): string | null {
  if (wei === null) return null
  return formatBtcFigure(fromWei(wei)).text
}

/**
 * Fees to the satoshi, 8 decimals ("0.00000940"), as the block and
 * transaction frames show them: most Mezo fees are under 0.000001 BTC,
 * where the house rule would print a floor.
 */
export function btcFee(wei: string | null): string | null {
  if (wei === null) return null
  return formatDecimal(fromWei(wei), 8)
}

export function grouped(value: number | string | null): string | null {
  if (value === null) return null
  return groupThousands(BigInt(value))
}

/** "12.0%" of the limit, one decimal, exact; and the share for a bar. */
export function gasShare(
  used: string,
  limit: string,
): { percent: string; share: number } {
  const total = BigInt(limit)
  if (total === 0n) return { percent: "0.0%", share: 0 }
  const tenths = (BigInt(used) * 1000n + total / 2n) / total
  return {
    percent: `${tenths / 10n}.${tenths % 10n}%`,
    // A bar width only, from an integer count of tenths.
    share: Math.min(1, Number(tenths) / 1000),
  }
}

export type TxStatus = "success" | "failed" | "pending"

export function txStatus(status: string | null): TxStatus {
  if (status === "ok") return "success"
  if (status === "error") return "failed"
  return "pending"
}

export type BlockRow = {
  height: number
  hash: string
  timestamp: number | null
  miner: AddressView
  transactions: number
  gasUsed: string
  gasPercent: string
  gasShare: number
}

export function blockRow(block: BlockscoutBlock): BlockRow {
  const gas = gasShare(block.gas_used, block.gas_limit)
  return {
    height: block.height,
    hash: block.hash.toLowerCase(),
    timestamp: unixSeconds(block.timestamp),
    miner: addressView(block.miner),
    transactions: block.transactions_count,
    gasUsed: grouped(block.gas_used) ?? "0",
    gasPercent: gas.percent,
    gasShare: gas.share,
  }
}

export type BlockDetail = BlockRow & {
  parentHash: string
  gasLimit: string
  baseFee: string | null
  burnt: string | null
  priority: string | null
  fees: string | null
  size: string | null
  /** Burnt share of the fees, for the split bar; null without fees. */
  burntShare: number | null
  pending: boolean
}

export function blockDetail(block: BlockscoutBlock): BlockDetail {
  const burnt = block.burnt_fees === null ? null : BigInt(block.burnt_fees)
  const priority =
    block.priority_fee === null ? null : BigInt(block.priority_fee)
  const total = burnt !== null && priority !== null ? burnt + priority : null
  return {
    ...blockRow(block),
    parentHash: block.parent_hash.toLowerCase(),
    gasLimit: grouped(block.gas_limit) ?? "0",
    baseFee:
      block.base_fee_per_gas === null
        ? null
        : formatGwei(block.base_fee_per_gas),
    burnt: btcFee(block.burnt_fees),
    priority: btcFee(block.priority_fee),
    fees: btcFee(block.transaction_fees),
    size: block.size === null ? null : `${grouped(block.size)} bytes`,
    burntShare:
      total === null || total === 0n || burnt === null
        ? null
        : // A bar width, from an integer count of thousandths.
          Number((burnt * 1000n) / total) / 1000,
    pending: block.is_pending_update === true,
  }
}

export type TxRow = {
  hash: string
  block: number | null
  timestamp: number | null
  status: TxStatus
  /** The called method's name; untrusted. */
  method: string | null
  from: AddressView
  to: AddressView | null
  value: string | null
  fee: string | null
}

export function txRow(tx: BlockscoutTransactionSummary): TxRow {
  const to = tx.to ?? tx.created_contract
  return {
    hash: tx.hash.toLowerCase(),
    block: tx.block_number,
    timestamp: unixSeconds(tx.timestamp),
    status: txStatus(tx.status),
    method: tx.method,
    from: addressView(tx.from),
    to: to === null ? null : addressView(to),
    value: tx.value === "0" ? null : btc(tx.value),
    fee: btcFee(tx.fee?.value ?? null),
  }
}

export type DecodedView = {
  name: string
  params: { name: string; type: string; value: string }[]
}

function jsonText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value)
}

export type TransferView = {
  token: { address: string; symbol: string | null; name: string | null }
  from: AddressView
  to: AddressView
  /** Formatted with the token's decimals; null for NFTs and unknowns. */
  amount: string | null
  tokenId: string | null
}

export function transferView(transfer: BlockscoutTokenTransfer): TransferView {
  const value = transfer.total?.value ?? null
  const decimals = transfer.total?.decimals ?? transfer.token.decimals
  return {
    token: {
      address: transfer.token.address_hash.toLowerCase(),
      symbol: transfer.token.symbol,
      name: transfer.token.name,
    },
    from: addressView(transfer.from),
    to: addressView(transfer.to),
    amount:
      value === null || decimals === null
        ? null
        : formatUnits(value, Number(decimals)),
    tokenId: transfer.total?.token_id ?? null,
  }
}

export type TxDetail = TxRow & {
  created: AddressView | null
  nonce: number | null
  position: number | null
  gasUsed: string | null
  gasLimit: string | null
  gasPrice: string | null
  decoded: DecodedView | null
  rawInput: string
  revertReason: string | null
  transfers: TransferView[]
  moreTransfers: boolean
  pending: boolean
}

export function txDetail(tx: BlockscoutTransaction): TxDetail {
  const decoded = tx.decoded_input
  return {
    ...txRow(tx),
    created:
      tx.created_contract === null ? null : addressView(tx.created_contract),
    nonce: tx.nonce,
    position: tx.position,
    gasUsed: grouped(tx.gas_used),
    gasLimit: grouped(tx.gas_limit),
    gasPrice: tx.gas_price === null ? null : formatGwei(tx.gas_price),
    decoded:
      decoded === null
        ? null
        : {
            name: decoded.method_call,
            params: decoded.parameters.map((param) => ({
              name: param.name,
              type: param.type,
              value: jsonText(param.value),
            })),
          },
    rawInput: tx.raw_input,
    revertReason: tx.revert_reason === null ? null : jsonText(tx.revert_reason),
    transfers: (tx.token_transfers ?? []).map(transferView),
    moreTransfers: tx.token_transfers_overflow === true,
    pending: tx.is_pending_update === true,
  }
}

export type LogView = {
  index: number
  address: AddressView
  decoded: DecodedView | null
  topics: string[]
  data: string
}

export function logView(log: BlockscoutLog): LogView {
  return {
    index: log.index,
    address: addressView(log.address),
    decoded:
      log.decoded === null
        ? null
        : {
            name: log.decoded.method_call,
            params: log.decoded.parameters.map((param) => ({
              name: param.name,
              type: param.type,
              value: jsonText(param.value),
            })),
          },
    topics: log.topics.filter((topic): topic is string => topic !== null),
    data: log.data,
  }
}

export type AddressSummary = AddressView & {
  verified: boolean
  balance: string | null
  creator: string | null
  creationTx: string | null
  token: { symbol: string | null; name: string | null } | null
}

export function addressSummary(address: BlockscoutAddress): AddressSummary {
  return {
    ...addressView(address),
    verified: address.is_verified === true,
    balance: btc(address.coin_balance),
    creator: address.creator_address_hash?.toLowerCase() ?? null,
    creationTx: address.creation_transaction_hash?.toLowerCase() ?? null,
    token:
      address.token === null
        ? null
        : { symbol: address.token.symbol, name: address.token.name },
  }
}

/**
 * An address's ERC-20 balances: the first page (50 at most), with `more`
 * when the address holds more than that page.
 */
export type TokenBalances = { items: TokenBalance[]; more: boolean }

export type TokenBalance = {
  address: string
  symbol: string | null
  name: string | null
  type: string
  /** Fungible: formatted amount; NFT: the count of ids held. */
  amount: string
  /** "$1,204": the balance in USD, where the API priced it; else null. */
  usd: string | null
  /** The USD value assumes the token is worth $1 (a stablecoin). */
  usdAssumed: boolean
}

/**
 * A fungible amount whose token never said its decimals: the base units,
 * labelled so, never passed off as the amount.
 */
export function rawUnits(value: string): string {
  return `${grouped(value) ?? value} raw units`
}

export function tokenBalance(balance: {
  token: {
    address_hash: string
    symbol: string | null
    name: string | null
    decimals: string | null
    type: string
  }
  value: string
}): TokenBalance {
  const decimals = balance.token.decimals
  return {
    address: balance.token.address_hash.toLowerCase(),
    symbol: balance.token.symbol,
    name: balance.token.name,
    type: balance.token.type,
    amount:
      decimals !== null
        ? formatUnits(balance.value, Number(decimals))
        : balance.token.type === "ERC-20"
          ? rawUnits(balance.value)
          : (grouped(balance.value) ?? balance.value),
    usd: null,
    usdAssumed: false,
  }
}

export type AddressTransfer = TransferView & {
  hash: string
  block: number | null
  timestamp: number | null
  /** Whether the address received (in) or sent (out) it. */
  direction: "in" | "out" | "self"
}

export function addressTransfer(
  owner: string,
  transfer: BlockscoutTokenTransfer,
): AddressTransfer {
  const view = transferView(transfer)
  const sent = view.from.address === owner
  const received = view.to.address === owner
  return {
    ...view,
    hash: transfer.transaction_hash.toLowerCase(),
    block: transfer.block_number,
    timestamp: unixSeconds(transfer.timestamp),
    direction: sent && received ? "self" : sent ? "out" : "in",
  }
}
