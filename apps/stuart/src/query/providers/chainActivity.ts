import {
  BORROW_CONTRACTS,
  CONTRACTS,
  REWARDS_DISTRIBUTORS,
} from "@matchbox/chain"
import {
  type BlockscoutLog,
  logsPageSchema,
  tokenTransfersPageSchema,
} from "@matchbox/contracts/blockscout"
import {
  scanLabelItemSchema,
  scanLabelMapSchema,
  scanLockItemSchema,
  scanOwnerVotesPageSchema,
  scanPageSchema,
} from "@matchbox/contracts/scan"
import type { Address, Hex } from "viem"
import {
  decodeAbiParameters,
  keccak256,
  parseAbi,
  parseAbiParameters,
  toHex,
} from "viem"
import { z } from "zod"
import type { BlockscoutReader } from "./blockscout"
import type { ApiFetcher } from "./readModels"
import { type MezoClient, multicallParsed } from "./rpc"

// Chain activity for "follow the money" questions: an address's ERC-20
// transfers (Blockscout, through the API's cached `/internal/blockscout`
// proxy), its lock NFTs and each lock's escrow events (rebases and chain
// fees compounded into it, owners over time), a member Safe's own events
// (native BTC it sent, which token transfers do not show), Matchscan's
// labels, locks and votes (`/internal/scan/*`), and Safe signers and
// balances (Mezo RPC). Every read is capped per question: the proxy shares
// one Blockscout budget with Scan and Pro.

/** One ERC-20 transfer in or out of a watched address. */
export type ChainTransfer = {
  tx: string
  block: number
  logIndex: number
  /** Unix seconds. */
  at: number
  from: Address
  to: Address
  token: Address
  symbol: string
  decimals: number
  amount: bigint
  /** Blockscout's name or proxy implementation for each side, if any. */
  fromName: string | null
  toName: string | null
  fromContract: boolean
  toContract: boolean
  /** Native BTC read from a Safe's events, not an ERC-20 transfer log. */
  native?: true
}

export type TransferRead = {
  transfers: ChainTransfer[]
  /** False when the page cap stopped the read before `since`. */
  complete: boolean
  /** The oldest transfer read, unix seconds (null when none). */
  oldest: number | null
  pages: number
}

export type AddressLabel = {
  address: Address
  name: string
  kind: string
  tags: string[]
  source: "curated" | "contracts"
}

export type OwnedLock = {
  asset: "veBTC" | "veMEZO"
  tokenId: string
  owner: Address | null
  /** Base units, 18 decimals. */
  amount: bigint
  isPermanent: boolean
  unlockAt: number | null
}

export type OwnerVote = {
  asset: "veBTC" | "veMEZO"
  tokenId: string
  epochStart: number
  gauge: Address
  gaugeName: string | null
  weight: bigint
  source: string
}

/** A veBTC or veMEZO NFT moving in or out of a watched address. */
export type NftMove = {
  tx: string
  block: number
  /** The transfer's log index, to order it against claims in one block. */
  logIndex: number
  at: number
  asset: "veBTC" | "veMEZO"
  tokenId: string
  from: Address
  to: Address
}

export type NftRead = { moves: NftMove[]; complete: boolean }

/** One escrow event of a lock: an owner change or a deposit into it. */
export type LockEvent =
  | {
      kind: "transfer"
      tx: string
      block: number
      logIndex: number
      /** Unix seconds; null when the API gave no block time. */
      at: number | null
      tokenId: string
      from: Address
      to: Address
    }
  | {
      kind: "deposit"
      tx: string
      block: number
      logIndex: number
      at: number | null
      tokenId: string
      /** Who paid: the owner, anyone funding it, or a rewards distributor. */
      provider: Address
      value: bigint
    }

/** One distributor claim for a lock: a rebase or chain fee. */
export type DistributorClaim = {
  tx: string
  block: number
  logIndex: number
  /** Unix seconds; null when the API gave no block time. */
  at: number | null
  tokenId: string
  amount: bigint
}

export type ClaimLog = {
  asset: "veBTC" | "veMEZO"
  tokenId: string
  /** Oldest first. */
  claims: DistributorClaim[]
  /** False when the page cap stopped before the lock's first claim. */
  complete: boolean
}

export type TxLockEvent = { asset: "veBTC" | "veMEZO"; event: LockEvent }

export type NativeRead = {
  /** Native BTC sent by the Safe's executed transactions, and received. */
  transfers: ChainTransfer[]
  complete: boolean
  oldest: number | null
  pages: number
  /** Some events had no block time: they could not be placed or counted. */
  undated?: boolean
  /**
   * Native sends this read cannot decode: `module`, the Safe ran calls
   * through a module in the period; `notL2`, it is not an L2 Safe (no
   * SafeMultiSigTransaction events) but executed transactions.
   */
  undecoded?: "module" | "notL2"
}

/**
 * What pays an address tokens, by its own getters:
 * - `voting`: a voting reward contract (bribes, fees): `ve()` is an escrow
 *   and it has no single `rewardToken()`.
 * - `gauge`: a pool, CL or vault gauge (`rewardToken()`). What it sends is
 *   staked principal coming back (`stakingToken()`) or gauge emissions,
 *   never a voting reward.
 */
export type RewardPayer =
  | { kind: "voting"; asset: "veBTC" | "veMEZO" }
  | { kind: "gauge"; stakingToken: Address | null; rewardToken: Address }

export type ChainActivitySource = {
  /**
   * ERC-20 transfers in and out of `address`, newest first, back to
   * `since` (unix seconds) or until `maxPages` pages of 50 are read.
   */
  transfers: (
    address: Address,
    since: number,
    maxPages: number,
  ) => Promise<TransferRead | null>
  /** veBTC and veMEZO NFTs in and out of `address` back to `since`. */
  nftMoves: (
    address: Address,
    since: number,
    maxPages: number,
  ) => Promise<NftRead | null>
  /**
   * Every rebase (veMEZO) or chain fee (veBTC) the distributor paid for
   * one lock, whoever owned it then.
   */
  distributorClaims: (
    asset: "veBTC" | "veMEZO",
    tokenId: string,
    maxPages: number,
  ) => Promise<ClaimLog | null>
  /** The escrow events (deposits, mints) of one transaction. */
  txLockEvents: (tx: string) => Promise<TxLockEvent[] | null>
  /**
   * Native BTC a Safe sent (executed transactions, multiSend included)
   * and received, from its own events, back to `since`.
   */
  safeNative: (
    safe: Address,
    since: number,
    maxPages: number,
  ) => Promise<NativeRead | null>
  /** Balances now, keyed `holder:token`; BTC is the native balance. */
  balances: (
    pairs: ReadonlyArray<{ holder: Address; token: Address }>,
  ) => Promise<Map<string, bigint>>
  /** The current owner of each lock, keyed by token id. */
  lockOwners: (
    asset: "veBTC" | "veMEZO",
    tokenIds: readonly string[],
  ) => Promise<Map<string, Address>>
  /** Matchscan labels for these addresses (at most 50). */
  labels: (addresses: readonly Address[]) => Promise<Map<string, AddressLabel>>
  /** Matchscan labels whose name starts with `name`. */
  labelSearch: (name: string) => Promise<AddressLabel[]>
  /** The locks an address owns now; null when Matchscan is unavailable. */
  ownerLocks: (owner: Address) => Promise<OwnedLock[] | null>
  /** The votes of every lock an address owns, newest epoch first. */
  ownerVotes: (owner: Address) => Promise<OwnerVote[] | null>
  /** The largest locks of one escrow by locked amount. */
  topLocks: (
    asset: "veBTC" | "veMEZO",
    limit: number,
  ) => Promise<OwnedLock[] | null>
  /** Safe signers by address; addresses that are not Safes are absent. */
  safeOwners: (addresses: readonly Address[]) => Promise<Map<string, Address[]>>
  /**
   * Which of these contracts are voting reward contracts or gauges, for
   * contracts Matchscan has not labelled as either. Others are absent.
   */
  rewardPayers: (
    addresses: readonly Address[],
  ) => Promise<Map<string, RewardPayer>>
}

export function lower(address: string): Address {
  return `0x${address.slice(2).toLowerCase()}`
}

export const ESCROWS = {
  veBTC: lower(CONTRACTS.mainnet.veBTC),
  veMEZO: lower(CONTRACTS.mainnet.veMEZO),
} as const satisfies Record<"veBTC" | "veMEZO", string>

export const ESCROW_ASSET = new Map<string, "veBTC" | "veMEZO">([
  [ESCROWS.veBTC, "veBTC"],
  [ESCROWS.veMEZO, "veMEZO"],
])

/** BTC is Mezo's native coin and also an ERC-20 at this precompile. */
export const BTC_TOKEN: Address = lower(BORROW_CONTRACTS.mainnet.btc)
export const MEZO_TOKEN: Address = lower(CONTRACTS.mainnet.mezoToken)

/**
 * The rewards distributors that compound into locks: MEZO rebases into
 * veMEZO and chain fees (BTC) into veBTC. Each claim for a live lock is a
 * `depositFor` with the distributor as provider; tokens never reach the
 * owner, so token transfers alone miss them.
 */
export const DISTRIBUTORS = new Map<string, "veBTC" | "veMEZO">([
  [lower(REWARDS_DISTRIBUTORS.mainnet.veMEZO), "veMEZO"],
  [lower(REWARDS_DISTRIBUTORS.mainnet.veBTC), "veBTC"],
])

/** Each escrow's distributor, the other way round. */
export const DISTRIBUTOR_OF = {
  veMEZO: lower(REWARDS_DISTRIBUTORS.mainnet.veMEZO),
  veBTC: lower(REWARDS_DISTRIBUTORS.mainnet.veBTC),
} as const satisfies Record<"veBTC" | "veMEZO", string>

function topicSelector(signature: string): string {
  return keccak256(toHex(signature))
}

const TOPIC = {
  deposit: topicSelector(
    "Deposit(address,uint256,uint8,uint256,uint256,uint256)",
  ),
  transfer: topicSelector("Transfer(address,address,uint256)"),
  claimed: topicSelector("Claimed(uint256,uint256,uint256,uint256)"),
  safeTx: topicSelector(
    "SafeMultiSigTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes,bytes)",
  ),
  failure: topicSelector("ExecutionFailure(bytes32,uint256)"),
  executed: topicSelector("ExecutionSuccess(bytes32,uint256)"),
  module: topicSelector("ExecutionFromModuleSuccess(address)"),
} as const

const MULTISEND_SELECTOR = "0x8d80ff0a"

/** A 32-byte topic as an address (its last 20 bytes). */
function topicAddress(topic: string | null | undefined): Address | null {
  if (topic?.length !== 66) return null
  return lower(`0x${topic.slice(26)}`)
}

function topicNumber(topic: string | null | undefined): bigint | null {
  if (topic?.length !== 66) return null
  return BigInt(topic)
}

/** A token id as the 32-byte topic Blockscout's `topic` filter takes. */
export function idTopic(tokenId: string): string {
  return `0x${BigInt(tokenId).toString(16).padStart(64, "0")}`
}

function logTime(log: BlockscoutLog): number | null {
  if (!log.block_timestamp) return null
  const at = Date.parse(log.block_timestamp)
  return Number.isNaN(at) ? null : Math.floor(at / 1000)
}

/** One event log, from Blockscout or from an RPC receipt. */
export type RawLog = {
  tx: string
  block: number
  logIndex: number
  at: number | null
  address: string
  topics: ReadonlyArray<string | null>
  data: string
}

export function blockscoutRaw(log: BlockscoutLog): RawLog {
  return {
    tx: log.transaction_hash.toLowerCase(),
    block: log.block_number,
    logIndex: log.index,
    at: logTime(log),
    address: log.address.hash.toLowerCase(),
    topics: log.topics,
    data: log.data,
  }
}

/** An escrow log as a lock event; null for any other event. */
export function parseLockEvent(
  input: BlockscoutLog | RawLog,
): LockEvent | null {
  const log = "transaction_hash" in input ? blockscoutRaw(input) : input
  const topics = log.topics
  const base = {
    tx: log.tx,
    block: log.block,
    logIndex: log.logIndex,
    at: log.at,
  }
  if (topics[0] === TOPIC.deposit) {
    const provider = topicAddress(topics[1])
    const tokenId = topicNumber(topics[2])
    if (provider === null || tokenId === null || log.data.length < 66) {
      return null
    }
    return {
      ...base,
      kind: "deposit",
      tokenId: tokenId.toString(),
      provider,
      value: BigInt(log.data.slice(0, 66)),
    }
  }
  if (topics[0] === TOPIC.transfer && topics.length === 4) {
    const from = topicAddress(topics[1])
    const to = topicAddress(topics[2])
    const tokenId = topicNumber(topics[3])
    if (from === null || to === null || tokenId === null) return null
    return { ...base, kind: "transfer", tokenId: tokenId.toString(), from, to }
  }
  return null
}

/** A distributor's `Claimed(tokenId, epochStart, epochEnd, amount)`. */
export function parseDistributorClaim(
  log: BlockscoutLog,
): DistributorClaim | null {
  if (log.topics[0] !== TOPIC.claimed || log.data.length < 66) return null
  const tokenId = topicNumber(log.topics[1])
  if (tokenId === null) return null
  return {
    tx: log.transaction_hash.toLowerCase(),
    block: log.block_number,
    logIndex: log.index,
    at: logTime(log),
    tokenId: tokenId.toString(),
    amount: BigInt(log.data.slice(0, 66)),
  }
}

const SAFE_TX_PARAMS = parseAbiParameters(
  "address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures, bytes additionalInfo",
)

type NativeCall = { to: Address; value: bigint }

/** The calls packed in multiSend(bytes): op, to, value, length, data. */
export function multiSendCalls(data: string): NativeCall[] {
  if (!data.toLowerCase().startsWith(MULTISEND_SELECTOR)) return []
  let packed: string
  try {
    const [bytes] = decodeAbiParameters(
      [{ type: "bytes" }],
      `0x${data.slice(10)}` as Hex,
    )
    packed = bytes.slice(2)
  } catch {
    return []
  }
  const calls: NativeCall[] = []
  let at = 0
  // 1 + 20 + 32 + 32 bytes of header per call, in hex characters.
  while (at + 170 <= packed.length) {
    const operation = Number.parseInt(packed.slice(at, at + 2), 16)
    const to = lower(`0x${packed.slice(at + 2, at + 42)}`)
    const value = BigInt(`0x${packed.slice(at + 42, at + 106)}`)
    const length = Number(BigInt(`0x${packed.slice(at + 106, at + 170)}`))
    if (operation === 0 && value > 0n) calls.push({ to, value })
    at += 170 + length * 2
  }
  return calls
}

function nativeTransfer(input: {
  log: BlockscoutLog
  at: number
  from: Address
  to: Address
  value: bigint
  slot: number
}): ChainTransfer {
  return {
    tx: input.log.transaction_hash.toLowerCase(),
    block: input.log.block_number,
    // Past any real log index of the transaction, unique per call.
    logIndex: 1_000_000 + input.log.index * 100 + input.slot,
    at: input.at,
    from: input.from,
    to: input.to,
    token: BTC_TOKEN,
    symbol: "BTC",
    decimals: 18,
    amount: input.value,
    fromName: null,
    toName: null,
    fromContract: false,
    toContract: false,
    native: true,
  }
}

/**
 * A Safe's `SafeMultiSigTransaction` events as native BTC transfers: the
 * value of each executed transaction, and of each call in a
 * delegatecalled multiSend, unless the transaction's execution failed.
 * Logs without a block time are skipped.
 */
export function parseSafeNative(
  safe: Address,
  logs: readonly BlockscoutLog[],
  failed: ReadonlySet<string> = new Set(),
): ChainTransfer[] {
  const self = lower(safe)
  const out: ChainTransfer[] = []
  for (const log of logs) {
    if (log.address.hash.toLowerCase() !== self) continue
    if (log.topics[0] !== TOPIC.safeTx) continue
    const at = logTime(log)
    const tx = log.transaction_hash.toLowerCase()
    if (at === null || failed.has(tx)) continue
    let decoded: readonly unknown[]
    try {
      decoded = decodeAbiParameters(SAFE_TX_PARAMS, log.data as Hex)
    } catch {
      continue
    }
    const [to, value, data, operation] = decoded as [
      Address,
      bigint,
      Hex,
      number,
    ]
    const calls: NativeCall[] =
      operation === 0
        ? value > 0n
          ? [{ to: lower(to), value }]
          : []
        : multiSendCalls(data)
    calls.forEach((call, slot) => {
      out.push(
        nativeTransfer({
          log,
          at,
          from: self,
          to: call.to,
          value: call.value,
          slot,
        }),
      )
    })
  }
  return out
}

function refName(ref: {
  name: string | null
  implementations: Array<{ name: string | null }> | null
}): string | null {
  const implementation = ref.implementations?.find(
    (each) => each.name !== null,
  )?.name
  // A proxy's own name ("TransparentUpgradeableProxy") says less than the
  // implementation behind it ("Enclave").
  return implementation ?? ref.name ?? null
}

type TransferPage = z.infer<typeof tokenTransfersPageSchema>

/** Blockscout transfers to `ChainTransfer`s; ERC-20 with amounts only. */
export function normalizeTransfers(page: TransferPage): ChainTransfer[] {
  const out: ChainTransfer[] = []
  for (const item of page.items) {
    const value = item.total?.value
    if (
      item.token.type !== "ERC-20" ||
      value === null ||
      value === undefined ||
      item.block_number === null ||
      item.timestamp === null
    ) {
      continue
    }
    const decimals = Number(item.token.decimals ?? item.total?.decimals ?? 18)
    out.push({
      tx: item.transaction_hash.toLowerCase(),
      block: item.block_number,
      logIndex: item.log_index ?? 0,
      at: Math.floor(Date.parse(item.timestamp) / 1000),
      from: lower(item.from.hash),
      to: lower(item.to.hash),
      token: lower(item.token.address_hash),
      symbol: (item.token.symbol ?? "TOKEN").slice(0, 16),
      decimals: Number.isFinite(decimals) ? decimals : 18,
      amount: BigInt(value),
      fromName: refName(item.from),
      toName: refName(item.to),
      fromContract: item.from.is_contract === true,
      toContract: item.to.is_contract === true,
    })
  }
  return out
}

/** The keyset cursor Blockscout returns, as the proxy's query string. */
export function cursorQuery(
  next: TransferPage["next_page_params"],
): string | null {
  if (next === null) return null
  const block = next.block_number
  const index = next.index
  if (
    (typeof block !== "number" && typeof block !== "string") ||
    (typeof index !== "number" && typeof index !== "string")
  ) {
    return null
  }
  return `block_number=${encodeURIComponent(String(block))}&index=${encodeURIComponent(String(index))}`
}

/** veBTC or veMEZO NFT transfers to `NftMove`s. */
export function normalizeNftMoves(page: TransferPage): NftMove[] {
  const out: NftMove[] = []
  for (const item of page.items) {
    const asset = ESCROW_ASSET.get(item.token.address_hash.toLowerCase())
    const tokenId = item.total?.token_id
    if (
      asset === undefined ||
      tokenId === null ||
      tokenId === undefined ||
      item.block_number === null ||
      item.timestamp === null
    ) {
      continue
    }
    out.push({
      tx: item.transaction_hash.toLowerCase(),
      block: item.block_number,
      logIndex: item.log_index ?? 0,
      at: Math.floor(Date.parse(item.timestamp) / 1000),
      asset,
      tokenId,
      from: lower(item.from.hash),
      to: lower(item.to.hash),
    })
  }
  return out
}

type ScanResult<T> = { status: "ok"; data: T } | { status: "unavailable" }

const API_ORIGIN = "https://matchbox-developer-api"
const TIMEOUT_MS = 5_000

export function apiScanReader(api: ApiFetcher | null) {
  return async function read<T>(
    path: string,
    schema: z.ZodType<T>,
  ): Promise<ScanResult<T>> {
    if (api === null) return { status: "unavailable" }
    try {
      const response = await api.fetch(
        new Request(`${API_ORIGIN}/internal/scan/${path}`, {
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        }),
      )
      if (!response.ok) return { status: "unavailable" }
      const parsed = schema.safeParse(await response.json())
      return parsed.success
        ? { status: "ok", data: parsed.data }
        : { status: "unavailable" }
    } catch {
      return { status: "unavailable" }
    }
  }
}

export type ScanReader = ReturnType<typeof apiScanReader>

const labelsDocumentSchema = z.object({ data: scanLabelMapSchema })
const labelSearchSchema = z.object({ data: z.array(scanLabelItemSchema) })
const lockPageSchema = scanPageSchema(scanLockItemSchema)

type ScanLabel = z.infer<typeof scanLabelItemSchema>

function toLabel(item: ScanLabel): AddressLabel {
  return {
    address: lower(item.address),
    name: item.name,
    kind: item.kind,
    tags: item.tags,
    source: item.source,
  }
}

function toLock(item: z.infer<typeof scanLockItemSchema>): OwnedLock | null {
  const asset = ESCROW_ASSET.get(item.escrow.toLowerCase())
  if (asset === undefined) return null
  return {
    asset,
    tokenId: item.token_id,
    owner: item.owner === null ? null : lower(item.owner),
    amount: BigInt(item.amount),
    isPermanent: item.is_permanent,
    unlockAt: item.unlock_at,
  }
}

const SAFE_ABI = parseAbi(["function getOwners() view returns (address[])"])
const REWARD_ABI = parseAbi([
  "function ve() view returns (address)",
  "function stakingToken() view returns (address)",
  "function rewardToken() view returns (address)",
])
const addressResultSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/)
const ownersSchema = z.array(z.string().regex(/^0x[0-9a-fA-F]{40}$/))

const OWNER_ABI = parseAbi(["function ownerOf(uint256) view returns (address)"])
const BALANCE_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
])
const bigintResultSchema = z.bigint()

/** Hard caps per question, whatever the tool asks for. */
export const ACTIVITY_LIMITS = {
  pagesPerAddress: 10,
  nftPages: 3,
  claimPages: 2,
  safeLogPages: 8,
  labelsPerRead: 50,
  probesPerRead: 40,
  /** Blockscout pages of one transaction's logs, without an RPC. */
  txLogPages: 4,
  balancesPerRead: 24,
} as const

type LogPage = z.infer<typeof logsPageSchema>

/**
 * Reads Blockscout pages newest first until `done` says the page reached
 * far enough back, the cursor ends, or `pages` are read. Null when even
 * the first page failed.
 */
async function readPages<
  P extends { next_page_params: TransferPage["next_page_params"] },
>(
  blockscout: BlockscoutReader,
  path: string,
  base: string,
  schema: z.ZodType<P>,
  pages: number,
  done: (page: P) => boolean,
): Promise<{ pages: P[]; complete: boolean } | null> {
  const read: P[] = []
  let cursor: string | null = ""
  while (cursor !== null && read.length < pages) {
    const query = [base, cursor].filter(Boolean).join("&")
    const result = await blockscout(
      `${path}${query ? `?${query}` : ""}`,
      schema,
    )
    if (result.status !== "ok") {
      if (read.length === 0) return null
      return { pages: read, complete: false }
    }
    read.push(result.data)
    cursor = cursorQuery(result.data.next_page_params)
    if (cursor === null || done(result.data)) {
      return { pages: read, complete: true }
    }
  }
  return { pages: read, complete: cursor === null }
}

function memo<T>(
  cache: Map<string, Promise<T>>,
  key: string,
  load: () => Promise<T>,
): Promise<T> {
  const cached = cache.get(key)
  if (cached) return cached
  const promise = load()
  cache.set(key, promise)
  return promise
}

export function createChainActivity(input: {
  blockscout: BlockscoutReader
  scan: ScanReader
  rpc: MezoClient | null
}): ChainActivitySource {
  const transferMemo = new Map<string, Promise<TransferRead | null>>()
  const nftMemo = new Map<string, Promise<NftRead | null>>()
  const claimMemo = new Map<string, Promise<ClaimLog | null>>()
  const txMemo = new Map<string, Promise<TxLockEvent[] | null>>()
  const nativeMemo = new Map<string, Promise<NativeRead | null>>()

  /**
   * Every log of a transaction: the RPC receipt (all of them, however
   * long), else Blockscout's pages up to the cap. Null when unread.
   */
  async function txLogs(hash: string): Promise<RawLog[] | null> {
    if (input.rpc !== null) {
      try {
        const receipt = await input.rpc.getTransactionReceipt({
          hash: hash as Hex,
        })
        return receipt.logs.map((log) => ({
          tx: hash,
          block: Number(log.blockNumber),
          logIndex: log.logIndex,
          at: null,
          address: log.address.toLowerCase(),
          topics: log.topics,
          data: log.data,
        }))
      } catch {
        // Fall back to Blockscout.
      }
    }
    const result = await readPages(
      input.blockscout,
      `api/v2/transactions/${hash}/logs`,
      "",
      logsPageSchema,
      ACTIVITY_LIMITS.txLogPages,
      () => false,
    )
    if (result === null || !result.complete) return null
    return result.pages.flatMap((page) => page.items).map(blockscoutRaw)
  }

  return {
    nftMoves(address, since, maxPages) {
      const pages = Math.min(maxPages, ACTIVITY_LIMITS.nftPages)
      const key = `${address.toLowerCase()}:${since}:${pages}`
      return memo(nftMemo, key, async () => {
        const result = await readPages(
          input.blockscout,
          `api/v2/addresses/${address.toLowerCase()}/token-transfers`,
          "type=ERC-721",
          tokenTransfersPageSchema,
          pages,
          (page) => {
            const oldest = page.items.at(-1)?.timestamp
            return oldest != null && Date.parse(oldest) / 1000 < since
          },
        )
        if (result === null) return null
        const moves = result.pages
          .flatMap(normalizeNftMoves)
          .filter((move) => move.at >= since)
        return { moves, complete: result.complete }
      })
    },
    distributorClaims(asset, tokenId, maxPages) {
      const pages = Math.min(maxPages, ACTIVITY_LIMITS.claimPages)
      const key = `${asset}:${tokenId}:${pages}`
      return memo(claimMemo, key, async () => {
        if (!/^\d{1,30}$/.test(tokenId)) return null
        const result = await readPages(
          input.blockscout,
          `api/v2/addresses/${DISTRIBUTOR_OF[asset]}/logs`,
          `topic=${idTopic(tokenId)}`,
          logsPageSchema,
          pages,
          () => false,
        )
        if (result === null) return null
        const claims = result.pages
          .flatMap((page) => page.items)
          .map(parseDistributorClaim)
          .filter(
            (claim): claim is DistributorClaim =>
              claim !== null && claim.tokenId === tokenId,
          )
          .sort((a, b) => a.block - b.block || a.logIndex - b.logIndex)
        return { asset, tokenId, claims, complete: result.complete }
      })
    },
    txLockEvents(tx) {
      const hash = tx.toLowerCase()
      return memo(txMemo, hash, async () => {
        if (!/^0x[0-9a-f]{64}$/.test(hash)) return null
        const logs = await txLogs(hash)
        if (logs === null) return null
        return logs.flatMap((log): TxLockEvent[] => {
          const asset = ESCROW_ASSET.get(log.address)
          const event = asset === undefined ? null : parseLockEvent(log)
          return asset !== undefined && event !== null ? [{ asset, event }] : []
        })
      })
    },
    safeNative(safe, since, maxPages) {
      const pages = Math.min(maxPages, ACTIVITY_LIMITS.safeLogPages)
      const key = `${safe.toLowerCase()}:${since}:${pages}`
      return memo(nativeMemo, key, async () => {
        const path = `api/v2/addresses/${safe.toLowerCase()}/logs`
        // Executed transactions only, and failed executions and module
        // calls apart (rare: one page each), rather than every event the
        // Safe emits.
        const [executed, failures, modules] = await Promise.all([
          readPages(
            input.blockscout,
            path,
            `topic=${TOPIC.safeTx}`,
            logsPageSchema,
            pages,
            (page: LogPage) => {
              const oldest = page.items.at(-1)
              const at = oldest ? logTime(oldest) : null
              return at !== null && at < since
            },
          ),
          input.blockscout(`${path}?topic=${TOPIC.failure}`, logsPageSchema),
          input.blockscout(`${path}?topic=${TOPIC.module}`, logsPageSchema),
        ])
        if (executed === null || failures.status !== "ok") return null
        const logs = executed.pages.flatMap((page) => page.items)
        // Module calls carry their value in no event this reads: unknown
        // (a failed read) counts as some.
        const moduleCalls =
          modules.status !== "ok" ||
          modules.data.items.some((log) => {
            const at = logTime(log)
            return (
              log.topics[0] === TOPIC.module && (at === null || at >= since)
            )
          })
        // No SafeMultiSigTransaction at all: an L1 Safe emits none, so
        // check whether it executed anything (only then: one page).
        let notL2 = false
        if (logs.length === 0) {
          const plain = await input.blockscout(
            `${path}?topic=${TOPIC.executed}`,
            logsPageSchema,
          )
          notL2 =
            plain.status !== "ok" ||
            plain.data.items.some((log) => log.topics[0] === TOPIC.executed)
        }
        const undecoded = moduleCalls ? "module" : notL2 ? "notL2" : null
        const failed = new Set(
          failures.data.items
            .filter((log) => log.topics[0] === TOPIC.failure)
            .map((log) => log.transaction_hash.toLowerCase()),
        )
        const times = logs.map(logTime)
        const dated = times.filter((at): at is number => at !== null)
        const undated = dated.length !== times.length
        return {
          transfers: parseSafeNative(safe, logs, failed).filter(
            (each) => each.at >= since,
          ),
          // Undated events (an older API) cannot be placed in the period.
          complete: executed.complete && !undated && undecoded === null,
          oldest: dated.length ? Math.min(...dated) : null,
          pages: executed.pages.length + 2 + (logs.length === 0 ? 1 : 0),
          undated,
          ...(undecoded === null ? {} : { undecoded }),
        }
      })
    },
    async balances(pairs) {
      const found = new Map<string, bigint>()
      if (input.rpc === null) return found
      const rpc = input.rpc
      const wanted = pairs.slice(0, ACTIVITY_LIMITS.balancesPerRead)
      const native = wanted.filter((pair) => pair.token === BTC_TOKEN)
      const tokens = wanted.filter((pair) => pair.token !== BTC_TOKEN)
      await Promise.all([
        ...native.map(async (pair) => {
          try {
            const balance = await rpc.getBalance({ address: pair.holder })
            found.set(`${pair.holder}:${pair.token}`, balance)
          } catch {
            // Unknown: the held amount stays unchecked.
          }
        }),
        (async () => {
          if (tokens.length === 0) return
          try {
            const results = await multicallParsed(
              rpc,
              tokens.map((pair) => ({
                address: pair.token,
                abi: BALANCE_ABI,
                functionName: "balanceOf",
                args: [pair.holder],
              })),
              bigintResultSchema,
            )
            results.forEach((result, index) => {
              const pair = tokens[index]
              if (pair && result !== null) {
                found.set(`${pair.holder}:${pair.token}`, result)
              }
            })
          } catch {
            // Unknown: the held amounts stay unchecked.
          }
        })(),
      ])
      return found
    },
    async lockOwners(asset, tokenIds) {
      const owners = new Map<string, Address>()
      const ids = tokenIds.filter((id) => /^\d{1,30}$/.test(id)).slice(0, 20)
      if (input.rpc === null || ids.length === 0) return owners
      try {
        const results = await multicallParsed(
          input.rpc,
          ids.map((id) => ({
            address: ESCROWS[asset] as Address,
            abi: OWNER_ABI,
            functionName: "ownerOf",
            args: [BigInt(id)],
          })),
          addressResultSchema,
        )
        results.forEach((result, index) => {
          const id = ids[index]
          if (id !== undefined && result !== null) owners.set(id, lower(result))
        })
      } catch {
        // Unknown owners stay unknown.
      }
      return owners
    },
    transfers(address, since, maxPages) {
      const pages = Math.min(maxPages, ACTIVITY_LIMITS.pagesPerAddress)
      const key = `${address.toLowerCase()}:${since}:${pages}`
      const cached = transferMemo.get(key)
      if (cached) return cached
      const load = (async (): Promise<TransferRead | null> => {
        const transfers: ChainTransfer[] = []
        let cursor: string | null = ""
        let read = 0
        let complete = false
        while (cursor !== null && read < pages) {
          const query: string = `type=ERC-20${cursor ? `&${cursor}` : ""}`
          const result = await input.blockscout(
            `api/v2/addresses/${address.toLowerCase()}/token-transfers?${query}`,
            tokenTransfersPageSchema,
          )
          if (result.status !== "ok") {
            if (read === 0) return null
            break
          }
          read += 1
          const batch = normalizeTransfers(result.data)
          transfers.push(...batch)
          const oldest = batch.at(-1)?.at ?? null
          cursor = cursorQuery(result.data.next_page_params)
          if (cursor === null || (oldest !== null && oldest < since)) {
            complete = true
            break
          }
        }
        const kept = transfers.filter((each) => each.at >= since)
        return {
          transfers: kept,
          complete,
          oldest: transfers.at(-1)?.at ?? null,
          pages: read,
        }
      })()
      transferMemo.set(key, load)
      return load
    },
    async labels(addresses) {
      const wanted = [...new Set(addresses.map((each) => each.toLowerCase()))]
        .filter((each) => /^0x[0-9a-f]{40}$/.test(each))
        .slice(0, ACTIVITY_LIMITS.labelsPerRead)
      if (wanted.length === 0) return new Map()
      const result = await input.scan(
        `labels?address=${wanted.join(",")}`,
        labelsDocumentSchema,
      )
      if (result.status !== "ok") return new Map()
      return new Map(
        Object.entries(result.data.data).map(([address, item]) => [
          address.toLowerCase(),
          toLabel(item),
        ]),
      )
    },
    async labelSearch(name) {
      const q = name.trim().slice(0, 64)
      if (!q) return []
      const result = await input.scan(
        `labels/search?q=${encodeURIComponent(q)}`,
        labelSearchSchema,
      )
      return result.status === "ok" ? result.data.data.map(toLabel) : []
    },
    async ownerLocks(owner) {
      const result = await input.scan(
        `owners/${owner.toLowerCase()}/locks?limit=100`,
        lockPageSchema,
      )
      if (result.status !== "ok") return null
      return result.data.data
        .map(toLock)
        .filter((lock): lock is OwnedLock => lock !== null)
    },
    async ownerVotes(owner) {
      const result = await input.scan(
        `owners/${owner.toLowerCase()}/votes?limit=100`,
        scanOwnerVotesPageSchema,
      )
      if (result.status !== "ok") return null
      const labels = result.data.labels
      return result.data.data.flatMap((vote): OwnerVote[] => {
        const asset = ESCROW_ASSET.get(vote.escrow.toLowerCase())
        if (asset === undefined) return []
        const gauge = lower(vote.gauge)
        return [
          {
            asset,
            tokenId: vote.token_id,
            epochStart: vote.epoch_start,
            gauge,
            gaugeName: labels[gauge]?.name ?? labels[vote.gauge]?.name ?? null,
            weight: BigInt(vote.weight),
            source: vote.source,
          },
        ]
      })
    },
    async topLocks(asset, limit) {
      const result = await input.scan(
        `locks?escrow=${asset.toLowerCase()}&order=amount&limit=${Math.min(limit, 100)}`,
        lockPageSchema,
      )
      if (result.status !== "ok") return null
      return result.data.data
        .map(toLock)
        .filter((lock): lock is OwnedLock => lock !== null)
    },
    async safeOwners(addresses) {
      const owners = new Map<string, Address[]>()
      if (input.rpc === null || addresses.length === 0) return owners
      try {
        const results = await multicallParsed(
          input.rpc,
          addresses.map((address) => ({
            address,
            abi: SAFE_ABI,
            functionName: "getOwners",
          })),
          ownersSchema,
        )
        results.forEach((result, index) => {
          const address = addresses[index]
          if (result && result.length > 0 && address) {
            owners.set(address.toLowerCase(), result.map(lower))
          }
        })
      } catch {
        // Not a Safe, or the RPC failed: no signers, no "same signers" label.
      }
      return owners
    },
    async rewardPayers(addresses) {
      const found = new Map<string, RewardPayer>()
      const wanted = addresses.slice(0, ACTIVITY_LIMITS.probesPerRead)
      if (input.rpc === null || wanted.length === 0) return found
      const getters = ["ve", "stakingToken", "rewardToken"] as const
      try {
        const results = await multicallParsed(
          input.rpc,
          wanted.flatMap((address) =>
            getters.map((functionName) => ({
              address,
              abi: REWARD_ABI,
              functionName,
            })),
          ),
          addressResultSchema,
        )
        wanted.forEach((address, index) => {
          const [ve, staking, reward] = getters.map(
            (_, slot) => results[index * getters.length + slot] ?? null,
          )
          const key = address.toLowerCase()
          // A gauge first: vault and pool gauges answer ve() too.
          if (reward) {
            found.set(key, {
              kind: "gauge",
              stakingToken: staking ? lower(staking) : null,
              rewardToken: lower(reward),
            })
            return
          }
          const asset = ve ? ESCROW_ASSET.get(ve.toLowerCase()) : undefined
          if (asset) found.set(key, { kind: "voting", asset })
        })
      } catch {
        // Unknown: the claim is left out rather than guessed.
      }
      return found
    },
  }
}

/** For tests and local dev without the API: nothing to read. */
export const unavailableChainActivity: ChainActivitySource = {
  transfers: async () => null,
  nftMoves: async () => null,
  distributorClaims: async () => null,
  txLockEvents: async () => null,
  safeNative: async () => null,
  balances: async () => new Map(),
  lockOwners: async () => new Map(),
  labels: async () => new Map(),
  labelSearch: async () => [],
  ownerLocks: async () => null,
  ownerVotes: async () => null,
  topLocks: async () => null,
  safeOwners: async () => new Map(),
  rewardPayers: async () => new Map(),
}
