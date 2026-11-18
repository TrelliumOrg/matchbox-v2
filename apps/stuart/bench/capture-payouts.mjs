// Captures what gauges paid two addresses into
// bench/fixtures/activity.payouts.json, from public sources only:
// Blockscout's token transfers and Mezo RPC (what each paying contract is).
//
//   node apps/stuart/bench/capture-payouts.mjs
//
// - The largest veBTC holder, 0x4da9...fb99, over the bench window: two
//   5,250,000 sMUSD stake withdrawals from a VaultGauge (29 Sep, 5 Nov),
//   gauge emissions, and a 10.5M MUSD loan repaid beside a CL gauge
//   emission (5 Nov).
// - An EOA, 0xdc88...6ad1, 9 to 13 Oct only: 153.90 vAMM-BTC/MUSD LP
//   unstaked from a PoolGauge (11 Oct).
// Neither stake withdrawal nor emission is a voting reward.

import { writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { createPublicClient, http, parseAbi } from "viem"

const BLOCKSCOUT = "https://api.explorer.mezo.org/api/v2"
const RPC = "https://rpc-internal.mezo.org"
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11"
const BENCH_NOW = Date.parse("2026-11-13T12:00:00.000Z") / 1000

const SLICES = {
  "0x4da9e77114ee66d64ca9457da1fca94d4b06fb99": {
    from: BENCH_NOW - 90 * 86_400,
    to: BENCH_NOW,
  },
  "0xdc887b3d44bdf789d60d2d427d5e8db6e4ed6ad1": {
    from: Date.parse("2026-10-09T00:00:00Z") / 1000,
    to: Date.parse("2026-10-13T00:00:00Z") / 1000,
  },
}

const ABI = parseAbi([
  "function ve() view returns (address)",
  "function stakingToken() view returns (address)",
  "function rewardToken() view returns (address)",
])
const ESCROWS = {
  "0x3d4b1b884a7a1e59fe8589a3296ec8f8cbb6f279": "veBTC",
  "0xb90fdad3dfd180458d62cc6acedc983d78e20122": "veMEZO",
}

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

async function transfers(address, { from, to }) {
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
      if (at <= to && at >= from) items.push(trim(item))
    }
    const oldest = body.items.at(-1)
    const next = body.next_page_params
    if (!next || !oldest || Date.parse(oldest.timestamp) / 1000 < from) break
    query = `type=ERC-20&block_number=${next.block_number}&index=${next.index}`
    await sleep(300)
  }
  return items
}

const byAddress = {}
for (const [address, slice] of Object.entries(SLICES)) {
  byAddress[address] = await transfers(address, slice)
  console.log(address, byAddress[address].length)
}
const payers = [
  ...new Set(
    Object.entries(byAddress).flatMap(([address, items]) =>
      items
        .filter(
          (item) =>
            item.to.hash.toLowerCase() === address &&
            item.from.is_contract === true,
        )
        .map((item) => item.from.hash.toLowerCase()),
    ),
  ),
]
const calls = payers.flatMap((address) =>
  ["ve", "stakingToken", "rewardToken"].map((functionName) => ({
    address,
    abi: ABI,
    functionName,
  })),
)
const results = (
  await client.multicall({ contracts: calls, allowFailure: true })
).map((each) => (each.status === "success" ? each.result.toLowerCase() : null))
const rewardEscrows = {}
const gauges = {}
payers.forEach((address, index) => {
  const [ve, staking, reward] = results.slice(index * 3, index * 3 + 3)
  if (reward) {
    gauges[address] = { stakingToken: staking, rewardToken: reward }
  } else if (ESCROWS[ve]) {
    rewardEscrows[address] = ESCROWS[ve]
  }
})

const here = dirname(fileURLToPath(import.meta.url))
writeFileSync(
  join(here, "fixtures", "activity.payouts.json"),
  `${JSON.stringify({
    capturedAt: new Date().toISOString(),
    sources: {
      transfers: `${BLOCKSCOUT}/addresses/<address>/token-transfers?type=ERC-20`,
      payers: `${RPC} ve(), stakingToken(), rewardToken()`,
    },
    slices: SLICES,
    transfers: byAddress,
    rewardEscrows,
    gauges,
  })}\n`,
)
console.log("payers", payers.length, "gauges", Object.keys(gauges).length)
