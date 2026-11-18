// Captures one entity's chain activity into bench/fixtures/activity.snf.json
// from public sources only: Blockscout's token transfers (the same API the
// Matchbox API proxies for Stuart) and Mezo RPC (Safe signers, which
// senders are voting reward contracts, lock owners and amounts).
//
//   node apps/stuart/bench/capture-activity.mjs [--extras | --slim]
//
// The entity is the Supernormal Foundation: its voting Safe and the
// Enclave that owns veBTC #6033 (the boost gauge labelled "SNF"). The
// window ends at the benchmark's clock (world.ts BENCH_NOW) and starts 90
// days before it, Stuart's default period.

import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  createPublicClient,
  decodeAbiParameters,
  encodeAbiParameters,
  http,
  parseAbi,
  parseAbiParameters,
} from "viem"

const BLOCKSCOUT = "https://api.explorer.mezo.org/api/v2"
const RPC = "https://mainnet.mezo.public.validationcloud.io"
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11"

const BENCH_NOW = Date.parse("2026-11-13T12:00:00.000Z") / 1000
const SINCE = BENCH_NOW - 90 * 86_400
// Claims near the start need their following window too.
const MEMBERS = {
  safe: "0xf36593cd2e5eb2cc8ccbe5ad3b5bb2353cf98bc4",
  enclave: "0x147379a0174780570d07d70a14fb244ee5f2d786",
}
const ESCROWS = {
  veBTC: "0x3d4b1b884a7a1e59fe8589a3296ec8f8cbb6f279",
  veMEZO: "0xb90fdad3dfd180458d62cc6acedc983d78e20122",
}
const SNF_LOCK = 6033n

const ABI = parseAbi([
  "function getOwners() view returns (address[])",
  "function ve() view returns (address)",
  "function stakingToken() view returns (address)",
  "function rewardToken() view returns (address)",
  "function ownerOf(uint256) view returns (address)",
  "function balanceOf(address) view returns (uint256)",
  "function ownerToNFTokenIdList(address, uint256) view returns (uint256)",
  "function locked(uint256) view returns ((int128 amount, uint256 end, bool isPermanent))",
])

const client = createPublicClient({
  chain: {
    id: 31_612,
    name: "Mezo",
    nativeCurrency: { name: "BTC", symbol: "BTC", decimals: 18 },
    rpcUrls: { default: { http: [RPC] } },
    contracts: { multicall3: { address: MULTICALL3 } },
  },
  transport: http(RPC),
})

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Only the fields @matchbox/contracts/blockscout tokenTransferSchema reads. */
function trimRef(ref) {
  return {
    hash: ref.hash,
    name: ref.name ?? null,
    is_contract: ref.is_contract ?? null,
    is_verified: ref.is_verified ?? null,
    implementations: (ref.implementations ?? []).map((each) => ({
      address_hash: each.address_hash,
      name: each.name ?? null,
    })),
  }
}

function trim(item) {
  return {
    transaction_hash: item.transaction_hash,
    block_number: item.block_number,
    log_index: item.log_index,
    timestamp: item.timestamp,
    type: item.type,
    method: item.method ?? null,
    from: trimRef(item.from),
    to: trimRef(item.to),
    token: {
      address_hash: item.token.address_hash,
      name: item.token.name ?? null,
      symbol: item.token.symbol ?? null,
      decimals: item.token.decimals ?? null,
      type: item.token.type,
      icon_url: null,
    },
    total: item.total
      ? {
          value: item.total.value ?? null,
          decimals: item.total.decimals ?? null,
          token_id: item.total.token_id ?? null,
        }
      : null,
  }
}

async function transfers(address) {
  const items = []
  let query = "type=ERC-20"
  for (let page = 0; page < 20; page += 1) {
    const response = await fetch(
      `${BLOCKSCOUT}/addresses/${address}/token-transfers?${query}`,
    )
    if (!response.ok) throw new Error(`Blockscout ${response.status}`)
    const body = await response.json()
    for (const item of body.items) {
      const at = Date.parse(item.timestamp) / 1000
      if (at <= BENCH_NOW && at >= SINCE) items.push(trim(item))
    }
    const oldest = body.items.at(-1)
    const next = body.next_page_params
    if (!next || !oldest || Date.parse(oldest.timestamp) / 1000 < SINCE) break
    query = `type=ERC-20&block_number=${next.block_number}&index=${next.index}`
    await sleep(300)
  }
  return items
}

async function multicall(contracts) {
  const results = await client.multicall({ contracts, allowFailure: true })
  return results.map((each) => (each.status === "success" ? each.result : null))
}

async function captureBase() {
  const byMember = {}
  for (const [name, address] of Object.entries(MEMBERS)) {
    byMember[address] = await transfers(address)
    console.log(name, byMember[address].length)
  }
  const all = Object.values(byMember).flat()
  const members = new Set(Object.values(MEMBERS))
  const senders = [
    ...new Set(
      all
        .filter(
          (item) =>
            members.has(item.to.hash.toLowerCase()) &&
            !members.has(item.from.hash.toLowerCase()) &&
            item.from.is_contract === true,
        )
        .map((item) => item.from.hash.toLowerCase()),
    ),
  ]
  const ves = await multicall(
    senders.map((address) => ({ address, abi: ABI, functionName: "ve" })),
  )
  // Gauges (pool, CL, vault) have rewardToken(); vault and pool gauges
  // answer ve() too, but pay principal and emissions, not voting rewards.
  const [stakingTokens, rewardTokens] = await Promise.all(
    ["stakingToken", "rewardToken"].map((functionName) =>
      multicall(
        senders.map((address) => ({ address, abi: ABI, functionName })),
      ),
    ),
  )
  const rewardEscrows = {}
  const gauges = {}
  senders.forEach((address, index) => {
    const reward = rewardTokens[index]?.toLowerCase()
    if (reward) {
      gauges[address] = {
        stakingToken: stakingTokens[index]?.toLowerCase() ?? null,
        rewardToken: reward,
      }
      return
    }
    const ve = ves[index]?.toLowerCase()
    if (ve === ESCROWS.veBTC) rewardEscrows[address] = "veBTC"
    if (ve === ESCROWS.veMEZO) rewardEscrows[address] = "veMEZO"
  })
  const safes = [
    ...new Set([
      ...Object.values(MEMBERS),
      ...all
        .flatMap((item) => [item.from, item.to])
        .filter((ref) =>
          /Safe/.test(ref.implementations?.[0]?.name ?? ref.name ?? ""),
        )
        .map((ref) => ref.hash.toLowerCase()),
    ]),
  ]
  const owners = await multicall(
    safes.map((address) => ({ address, abi: ABI, functionName: "getOwners" })),
  )
  const safeOwners = {}
  safes.forEach((address, index) => {
    const list = owners[index]
    if (Array.isArray(list) && list.length > 0) {
      safeOwners[address] = list.map((each) => each.toLowerCase())
    }
  })

  const [snfOwner] = await multicall([
    {
      address: ESCROWS.veBTC,
      abi: ABI,
      functionName: "ownerOf",
      args: [SNF_LOCK],
    },
  ])
  const [count] = await multicall([
    {
      address: ESCROWS.veMEZO,
      abi: ABI,
      functionName: "balanceOf",
      args: [MEMBERS.safe],
    },
  ])
  const ids = await multicall(
    Array.from({ length: Number(count ?? 0n) }, (_, index) => ({
      address: ESCROWS.veMEZO,
      abi: ABI,
      functionName: "ownerToNFTokenIdList",
      args: [MEMBERS.safe, BigInt(index)],
    })),
  )
  const lockIds = [
    ...ids
      .filter((id) => id !== null)
      .map((id) => ["veMEZO", id, MEMBERS.safe]),
    ["veBTC", SNF_LOCK, snfOwner?.toLowerCase() ?? null],
  ]
  const locked = await multicall(
    lockIds.map(([asset, id]) => ({
      address: ESCROWS[asset],
      abi: ABI,
      functionName: "locked",
      args: [id],
    })),
  )
  const locks = lockIds.map(([asset, id, owner], index) => ({
    asset,
    tokenId: id.toString(),
    owner,
    amount: (locked[index]?.amount ?? 0n).toString(),
    isPermanent: locked[index]?.isPermanent ?? false,
    unlockAt:
      locked[index] && !locked[index].isPermanent
        ? Number(locked[index].end)
        : null,
  }))

  // The largest veBTC locks now (every lock's locked(), then ownerOf for the
  // top 30) and how the top five owners' locks vote on PoolsVoter and
  // ValidatorsVoter (poolVote, votes).
  const VOTERS = {
    pools: "0x48233ccc97b87ba93bca212cbee48e3210211f03",
    validators: "0xe99a9ad5ed26bd30e4db25397f378817e9b9515a",
  }
  const VOTE_ABI = parseAbi([
    "function tokenId() view returns (uint256)",
    "function poolVote(uint256, uint256) view returns (address)",
    "function votes(uint256, address) view returns (uint256)",
  ])
  const lastId = await client.readContract({
    address: ESCROWS.veBTC,
    abi: VOTE_ABI,
    functionName: "tokenId",
  })
  const everyId = Array.from({ length: Number(lastId) }, (_, index) =>
    BigInt(index + 1),
  )
  const everyLocked = []
  for (let start = 0; start < everyId.length; start += 300) {
    const chunk = everyId.slice(start, start + 300)
    everyLocked.push(
      ...(await multicall(
        chunk.map((id) => ({
          address: ESCROWS.veBTC,
          abi: ABI,
          functionName: "locked",
          args: [id],
        })),
      )),
    )
  }
  const largest = everyId
    .map((id, index) => ({ id, locked: everyLocked[index] }))
    .filter((each) => each.locked && each.locked.amount > 0n)
    .sort((a, b) => (b.locked.amount > a.locked.amount ? 1 : -1))
    .slice(0, 30)
  const largestOwners = await multicall(
    largest.map((each) => ({
      address: ESCROWS.veBTC,
      abi: ABI,
      functionName: "ownerOf",
      args: [each.id],
    })),
  )
  const topLocks = largest.map((each, index) => ({
    asset: "veBTC",
    tokenId: each.id.toString(),
    owner: largestOwners[index]?.toLowerCase() ?? null,
    amount: each.locked.amount.toString(),
    isPermanent: each.locked.isPermanent,
    unlockAt: each.locked.isPermanent ? null : Number(each.locked.end),
  }))
  const ownerTotals = new Map()
  for (const lock of topLocks) {
    if (lock.owner === null) continue
    ownerTotals.set(
      lock.owner,
      (ownerTotals.get(lock.owner) ?? 0n) + BigInt(lock.amount),
    )
  }
  const topOwners = [...ownerTotals.entries()]
    .sort((a, b) => (b[1] > a[1] ? 1 : -1))
    .slice(0, 5)
    .map(([owner]) => owner)
  const votedLocks = topLocks.filter((lock) => topOwners.includes(lock.owner))
  const votes = []
  for (const [source, voter] of Object.entries(VOTERS)) {
    for (const lock of votedLocks) {
      const targets = await multicall(
        Array.from({ length: 10 }, (_, index) => ({
          address: voter,
          abi: VOTE_ABI,
          functionName: "poolVote",
          args: [BigInt(lock.tokenId), BigInt(index)],
        })),
      )
      const voted = targets.filter((target) => target !== null)
      const weights = await multicall(
        voted.map((target) => ({
          address: voter,
          abi: VOTE_ABI,
          functionName: "votes",
          args: [BigInt(lock.tokenId), target],
        })),
      )
      voted.forEach((target, index) => {
        votes.push({
          owner: lock.owner,
          tokenId: lock.tokenId,
          source,
          target: target.toLowerCase(),
          weight: (weights[index] ?? 0n).toString(),
        })
      })
    }
  }

  return {
    capturedAt: new Date().toISOString(),
    sources: {
      transfers: `${BLOCKSCOUT}/addresses/<address>/token-transfers?type=ERC-20`,
      chain: `${RPC} (getOwners, ve, ownerOf, locked)`,
    },
    window: {
      since: new Date(SINCE * 1000).toISOString(),
      until: new Date(BENCH_NOW * 1000).toISOString(),
    },
    members: MEMBERS,
    snfLockOwner: snfOwner?.toLowerCase() ?? null,
    transfers: byMember,
    rewardEscrows,
    gauges,
    safeOwners,
    locks,
    topLocks,
    votes,
  }
}

// --- What token transfers miss: lock NFT moves, the distributors' claims
// for every lock the members owned in the window (rebases and chain fees
// compounded into locks), the voting Safe's executed transactions (native
// BTC it sent), the escrow events of each lock deposit, and balances now.

const DISTRIBUTOR_OF = {
  veMEZO: "0x075108f275ed81c9cfc01065e6e50ceea81d6363",
  veBTC: "0xb58477e074265bdc7f7ca6100ed0f7de264f74a2",
}
const SAFE_TX_TOPIC =
  "0x66753cd2356569ee081232e3be8909b950e0a76c1f8460c3a5e3c2be32b11bed"
const FAILURE_TOPIC =
  "0x23428b18acfb3ea64b08dc0c1d296ea9c09702c09083ca5272e64d115b687d23"
const BTC_TOKEN = "0x7b7c000000000000000000000000000000000000"

/** Only the fields @matchbox/contracts/blockscout logSchema reads. */
function trimLog(log) {
  return {
    transaction_hash: log.transaction_hash,
    block_number: log.block_number,
    block_timestamp: log.block_timestamp ?? null,
    block_hash: log.block_hash ?? null,
    index: log.index,
    address: trimRef(log.address),
    topics: log.topics,
    data: log.data,
    decoded: null,
  }
}

async function pagesOf(path, base, keep, stop, cap) {
  const items = []
  let query = base
  for (let page = 0; page < cap; page += 1) {
    const response = await fetch(
      `${BLOCKSCOUT}/${path}${query ? `?${query}` : ""}`,
    )
    if (!response.ok) throw new Error(`Blockscout ${response.status} ${path}`)
    const body = await response.json()
    items.push(...body.items.filter(keep))
    const next = body.next_page_params
    if (!next || stop(body.items.at(-1))) break
    const cursor = `block_number=${next.block_number}&index=${next.index}`
    query = base ? `${base}&${cursor}` : cursor
    await sleep(300)
  }
  return items
}

const inWindow = (at) => at <= BENCH_NOW && at >= SINCE
const timeOf = (iso) => Date.parse(iso) / 1000

async function captureExtras(base) {
  const nftTransfers = {}
  for (const address of Object.values(MEMBERS)) {
    nftTransfers[address] = (
      await pagesOf(
        `addresses/${address}/token-transfers`,
        "type=ERC-721",
        (item) => inWindow(timeOf(item.timestamp)),
        (oldest) => !oldest || timeOf(oldest.timestamp) < SINCE,
        5,
      )
    ).map(trim)
  }
  // Every lock a member owns now or moved in the window.
  const escrowAsset = {
    [ESCROWS.veBTC]: "veBTC",
    [ESCROWS.veMEZO]: "veMEZO",
  }
  const ids = new Set(base.locks.map((lock) => `${lock.asset}:${lock.tokenId}`))
  for (const item of Object.values(nftTransfers).flat()) {
    const asset = escrowAsset[item.token.address_hash.toLowerCase()]
    if (asset && item.total?.token_id)
      ids.add(`${asset}:${item.total.token_id}`)
  }
  const distributorLogs = {}
  for (const key of ids) {
    const [asset, tokenId] = key.split(":")
    const topic = `0x${BigInt(tokenId).toString(16).padStart(64, "0")}`
    distributorLogs[key] = (
      await pagesOf(
        `addresses/${DISTRIBUTOR_OF[asset]}/logs`,
        `topic=${topic}`,
        () => true,
        () => false,
        4,
      )
    ).map(trimLog)
    await sleep(300)
  }
  const safe = MEMBERS.safe
  const safeLogs = {
    [safe]: (
      await pagesOf(
        `addresses/${safe}/logs`,
        `topic=${SAFE_TX_TOPIC}`,
        (log) => inWindow(timeOf(log.block_timestamp)),
        (oldest) => !oldest || timeOf(oldest.block_timestamp) < SINCE,
        10,
      )
    ).map(trimLog),
  }
  const safeFailures = {
    [safe]: (
      await pagesOf(
        `addresses/${safe}/logs`,
        `topic=${FAILURE_TOPIC}`,
        () => true,
        () => true,
        1,
      )
    ).map(trimLog),
  }
  // The escrow events of each member deposit into an escrow.
  const members = new Set(Object.values(MEMBERS))
  const depositTxs = new Set(
    Object.values(base.transfers)
      .flat()
      .filter(
        (item) =>
          members.has(item.from.hash.toLowerCase()) &&
          escrowAsset[item.to.hash.toLowerCase()] !== undefined,
      )
      .map((item) => item.transaction_hash.toLowerCase()),
  )
  const txLogs = {}
  for (const tx of depositTxs) {
    txLogs[tx] = (
      await pagesOf(
        `transactions/${tx}/logs`,
        "",
        () => true,
        () => true,
        1,
      )
    ).map(trimLog)
    await sleep(300)
  }
  // Balances now of every member and token it moved.
  const tokens = new Set(
    Object.values(base.transfers)
      .flat()
      .map((item) => item.token.address_hash.toLowerCase()),
  )
  tokens.add(BTC_TOKEN)
  const pairs = [...members].flatMap((holder) =>
    [...tokens].map((token) => ({ holder, token })),
  )
  const erc20 = pairs.filter((pair) => pair.token !== BTC_TOKEN)
  const results = await multicall(
    erc20.map((pair) => ({
      address: pair.token,
      abi: ABI,
      functionName: "balanceOf",
      args: [pair.holder],
    })),
  )
  const balances = {}
  erc20.forEach((pair, index) => {
    if (results[index] !== null) {
      balances[`${pair.holder}:${pair.token}`] = results[index].toString()
    }
  })
  for (const holder of members) {
    balances[`${holder}:${BTC_TOKEN}`] = (
      await client.getBalance({ address: holder })
    ).toString()
  }
  return {
    nftTransfers,
    distributorLogs,
    safeLogs,
    safeFailures,
    txLogs,
    balances,
    balancesAt: new Date().toISOString(),
  }
}

// Keeps the fixture small: only what the bench reads. Distributor claims
// in the window; Safe executions that sent native BTC, with their
// signatures dropped (the decoded call is unchanged).
const SAFE_TX_PARAMS = parseAbiParameters(
  "address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures, bytes additionalInfo",
)

function sendsNative(data, operation, value) {
  if (operation === 0) return value > 0n
  if (!data.startsWith("0x8d80ff0a")) return false
  const [packed] = decodeAbiParameters(
    [{ type: "bytes" }],
    `0x${data.slice(10)}`,
  )
  const hex = packed.slice(2)
  for (let at = 0; at + 170 <= hex.length; ) {
    const op = Number.parseInt(hex.slice(at, at + 2), 16)
    const amount = BigInt(`0x${hex.slice(at + 42, at + 106)}`)
    const length = Number(BigInt(`0x${hex.slice(at + 106, at + 170)}`))
    if (op === 0 && amount > 0n) return true
    at += 170 + length * 2
  }
  return false
}

function slim(extras) {
  const distributorLogs = Object.fromEntries(
    Object.entries(extras.distributorLogs).map(([key, logs]) => [
      key,
      logs.filter((log) => inWindow(timeOf(log.block_timestamp))),
    ]),
  )
  const safeLogs = Object.fromEntries(
    Object.entries(extras.safeLogs).map(([safe, logs]) => [
      safe,
      logs.flatMap((log) => {
        const fields = decodeAbiParameters(SAFE_TX_PARAMS, log.data)
        const [, value, data, operation] = fields
        if (!sendsNative(data, operation, value)) return []
        const kept = [...fields]
        kept[9] = "0x"
        kept[10] = "0x"
        return [{ ...log, data: encodeAbiParameters(SAFE_TX_PARAMS, kept) }]
      }),
    ]),
  )
  return { ...extras, distributorLogs, safeLogs }
}

const here = dirname(fileURLToPath(import.meta.url))
const file = join(here, "fixtures", "activity.snf.json")
// `--extras` adds only the sections above to the captured fixture;
// `--slim` only trims the captured fixture again, with no network.
const current = () => JSON.parse(readFileSync(file, "utf8"))
const base =
  process.argv.includes("--extras") || process.argv.includes("--slim")
    ? current()
    : await captureBase()
const extras = slim(
  process.argv.includes("--slim") ? base : await captureExtras(base),
)
writeFileSync(
  file,
  `${JSON.stringify({
    ...base,
    sources: {
      ...base.sources,
      logs: `${BLOCKSCOUT}/addresses/<distributor or Safe>/logs?topic=<lock id or event>`,
    },
    ...extras,
  })}\n`,
)
console.log(
  "locks",
  Object.keys(extras.distributorLogs).length,
  "safe executions",
  extras.safeLogs[MEMBERS.safe].length,
  "deposits",
  Object.keys(extras.txLogs).length,
)
