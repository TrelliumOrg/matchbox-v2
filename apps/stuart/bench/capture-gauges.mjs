// Captures the live gauge directory into bench/fixtures/gauges.mainnet.json
// from public sources only: Matchscan's server-rendered gauge lists (names,
// pool type labels, votes, incentives in USD) and Mezo RPC (each gauge's
// isAlive and, for pool gauges, the pool PoolsVoter votes on).
//
//   node apps/stuart/bench/capture-gauges.mjs
//
// The fixture records where and when it was captured. Stuart's resolver
// tests and the benchmark read it; refresh it when gauges are added.

import { writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { createPublicClient, getAddress, http, parseAbi } from "viem"

const SCAN = "https://scan.matchbox.markets"
const RPC = "https://mainnet.mezo.public.validationcloud.io"

// Mainnet voters (@matchbox/chain addresses.ts).
const VOTERS = {
  boost: "0x2Ba614a598Cffa5a19d683cDCA97bac3a49313d1",
  pools: "0x48233cCC97B87Ba93bCA212cbEe48e3210211f03",
  validators: "0xe99a9ad5Ed26BD30e4DB25397f378817e9b9515a",
  "third-party": "0x2e6D2F2CaCC1d24F9f9358030674eB307397A6EB",
}

// Matchscan's type filter, and the voter each type belongs to.
const TYPES = [
  { type: "pool", voter: "pools", kind: "pool" },
  { type: "validator", voter: "validators", kind: "validator" },
  { type: "vebtc", voter: "boost", kind: "vebtc" },
  { type: "mezo", voter: "third-party", kind: "mezo" },
]

const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11"

const ABI = parseAbi([
  "function isAlive(address) view returns (bool)",
  "function poolForGauge(address) view returns (address)",
])

function text(html) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim()
}

function rowsOf(html) {
  const rows = []
  const parts = html.split(/(?=<a [^>]*href="\/gauges\/0x)/)
  for (const part of parts.slice(1)) {
    const address = /href="\/gauges\/(0x[0-9a-fA-F]{40})"/.exec(part)?.[1]
    const plain = text(part)
    // Rows of the full table end with the vote link; the summary panels
    // at the top of the page do not.
    if (!address || !plain.includes("Vote on Matchbox")) continue
    const name = text(/<bdi[^>]*>([\s\S]*?)<\/bdi>/.exec(part)?.[1] ?? "")
    const label =
      /<span class="flex-none font-medium text-sec">([^<]*)<\/span>/.exec(
        part,
      )?.[1] ?? null
    const votes =
      /([\d,]+(?:\.\d+)?) ve(?:BTC|MEZO)\b/
        .exec(plain)?.[1]
        ?.replace(/,/g, "") ?? "0"
    const usd =
      /\$([\d,]+(?:\.\d+)?)/.exec(plain)?.[1]?.replace(/,/g, "") ?? "0"
    // veBTC gauges: "SNF # 6033 ..." or "veBTC #5910 ...".
    const tokenId = /^[^$]*?#\s?(\d+)/.exec(plain)?.[1] ?? null
    rows.push({
      address: address.toLowerCase(),
      name,
      label,
      votes,
      usd,
      tokenId,
    })
  }
  return {
    rows,
    next:
      /href="\/gauges\?[^"]*?after=(0x[0-9a-fA-F]{40})/.exec(html)?.[1] ?? null,
  }
}

async function getText(url) {
  let last = null
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(url)
      if (response.ok) return await response.text()
      last = new Error(`${url} answered ${response.status}`)
    } catch (error) {
      last = error
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000 * (attempt + 1)))
  }
  throw last
}

async function listType(type) {
  const all = []
  let after = null
  for (let page = 0; page < 40; page += 1) {
    const url = `${SCAN}/gauges?type=${type}${after ? `&after=${after}` : ""}`
    const { rows, next } = rowsOf(await getText(url))
    for (const row of rows) {
      if (!all.some((each) => each.address === row.address)) all.push(row)
    }
    if (next === null || next === after) break
    after = next
  }
  return all
}

const client = createPublicClient({ transport: http(RPC) })

async function chainReads(voter, gauges, withPool) {
  const calls = gauges.flatMap((gauge) => [
    {
      address: VOTERS[voter],
      abi: ABI,
      functionName: "isAlive",
      args: [gauge],
    },
    ...(withPool
      ? [
          {
            address: VOTERS[voter],
            abi: ABI,
            functionName: "poolForGauge",
            args: [gauge],
          },
        ]
      : []),
  ])
  const results = await client.multicall({
    contracts: calls,
    batchSize: 4096,
    multicallAddress: MULTICALL3,
  })
  const step = withPool ? 2 : 1
  return gauges.map((_, index) => ({
    isAlive: results[index * step]?.result ?? null,
    pool: withPool ? (results[index * step + 1]?.result ?? null) : null,
  }))
}

const capturedAt = new Date().toISOString()
const block = await client.getBlockNumber()
const gauges = []
for (const { type, voter, kind } of TYPES) {
  const rows = await listType(type)
  const reads = await chainReads(
    voter,
    rows.map((row) => getAddress(row.address)),
    voter === "pools",
  )
  rows.forEach((row, index) => {
    const read = reads[index]
    gauges.push({
      address: row.address,
      voter,
      kind,
      name: row.name,
      label: row.label,
      tokenId: kind === "vebtc" ? row.tokenId : null,
      pool: read?.pool ? read.pool.toLowerCase() : null,
      isAlive: read?.isAlive ?? true,
      votes: row.votes,
      incentivesUsd: row.usd,
    })
  })
}

const out = {
  capturedAt,
  block: block.toString(),
  sources: [
    `${SCAN}/gauges?type=pool|validator|vebtc|mezo (names, pool type labels, votes, incentives USD)`,
    `${RPC} (isAlive and PoolsVoter.poolForGauge at block ${block})`,
  ],
  gauges,
}
const here = dirname(fileURLToPath(import.meta.url))
const file = join(here, "fixtures", "gauges.mainnet.json")
writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`)
console.log(`${gauges.length} gauges at block ${block} -> ${file}`)
