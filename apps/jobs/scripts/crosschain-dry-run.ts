import { crossChainPools, crossChains } from "@matchbox/chain"
import { formatFixedPoint } from "@matchbox/domain"
import { createLogger } from "@matchbox/logger"
import { coingeckoBudget } from "../src/coingecko-budget"
import {
  headlineOf,
  musdPriceStatements,
  readMusdQuotes,
  venues,
} from "../src/crosschain/musd-price"
import { poolDepthChains } from "../src/crosschain/pools"
import { crossChainClients } from "../src/crosschain/rpc"
import {
  type CrossChainPart,
  keylessPools,
  type PoolSchedule,
  planPart,
} from "../src/crosschain/run"
import { onchainPoolsRequest } from "../src/crosschain/sources"
import { inlineStatement } from "../src/scan/statements"

// What one cross-chain job run would store, read from the real public
// sources (RPCs, GeckoTerminal, DefiLlama, Curve, Merkl, Wormholescan) and
// printed. It writes nothing anywhere: no database, no KV.
//
//   pnpm --filter @matchbox/jobs crosschain:dry-run           # summary
//   pnpm --filter @matchbox/jobs crosschain:dry-run -- --sql  # and the SQL
//
// Optional env: MEZO_RPC_URLS, ETHEREUM_RPC_URL, BASE_RPC_URL, BSC_RPC_URL,
// and COINGECKO_API_KEY with COINGECKO_API_PLAN (demo or pro) and
// COINGECKO_REFRESH_SECONDS: with a key, pool depth is read through
// CoinGecko's keyed onchain endpoint (3 calls). The key is never printed.

const showSql = process.argv.includes("--sql")
const logger = createLogger({ level: "warn" })
const env = (name: string) => {
  const value = process.env[name]?.trim()
  return value === undefined || value.length === 0 ? null : value
}
const clients = crossChainClients({
  mezo: env("MEZO_RPC_URLS")?.split(",") ?? null,
  ethereum: env("ETHEREUM_RPC_URL"),
  base: env("BASE_RPC_URL"),
  bsc: env("BSC_RPC_URL"),
})
const nowSeconds = Math.floor(Date.now() / 1000)
const apiKey = env("COINGECKO_API_KEY")
const plan = env("COINGECKO_API_PLAN") === "pro" ? "pro" : "demo"
const configuredRefresh = Number.parseInt(
  env("COINGECKO_REFRESH_SECONDS") ?? "",
  10,
)
const refreshSetting =
  Number.isInteger(configuredRefresh) && configuredRefresh > 0
    ? configuredRefresh
    : null
const budget = coingeckoBudget({
  plan,
  hasKey: apiKey !== null,
  configuredRefreshSeconds: refreshSetting,
  poolChains: poolDepthChains().length,
})
const pools: PoolSchedule =
  apiKey === null || budget.keyedPoolsEveryHours === null
    ? keylessPools
    : {
        keyed: { apiKey, plan },
        everyHours: budget.keyedPoolsEveryHours,
      }
const usd = (wad: bigint) => formatFixedPoint(wad, 18)

console.log(
  `Cross-chain dry run at ${new Date(nowSeconds * 1000).toISOString()}`,
)

// -- MUSD price (the minute job) --------------------------------------------
const { quotes, failed } = await readMusdQuotes(clients)
console.log("\nMUSD venue quotes")
for (const quote of quotes) {
  console.log(
    `  ${venues[quote.venue].label.padEnd(22)} ${quote.chain.padEnd(9)} $${usd(quote.price).slice(0, 8)}  depth $${usd(quote.depth).split(".")[0]}  (${quote.method}, block ${quote.block})`,
  )
}
for (const item of failed) console.log(`  FAILED ${item.venue}: ${item.reason}`)
const headline = headlineOf(quotes)
if (headline === null)
  console.log("  headline: none (CoinGecko fallback would run)")
else {
  console.log(
    `  headline $${usd(headline.price).slice(0, 8)} (liquidity-weighted median of ${headline.venuesUsed.length}), spread ${headline.spreadBps} bps, diverged ${headline.diverged}`,
  )
}
const priceStatements = musdPriceStatements(quotes, headline, nowSeconds)
console.log(
  `  would write ${priceStatements.length} statement(s) to market_quotes${priceStatements.length > 1 ? " and market_price_daily" : ""}`,
)
if (showSql) for (const s of priceStatements) console.log(inlineStatement(s))

// -- Hourly parts -----------------------------------------------------------
for (const part of ["supply", "pools", "bridge"] as CrossChainPart[]) {
  const plan = await planPart(part, {
    clients,
    fetcher: (url, init) => fetch(url, init),
    nowSeconds,
    logger,
    pools,
    poolsKeyed: pools.keyed,
  })
  console.log(
    `\n${part}: ${plan.complete ? "complete" : "PARTIAL"}, ${plan.statements.length} statement(s)`,
  )
  if (part === "pools") {
    const { pools, ...rest } = plan.summary as {
      pools: Record<string, string | number | null>[]
    }
    console.log(JSON.stringify(rest))
    for (const row of pools) {
      console.log(
        `  ${String(row.pool_id).padEnd(34)} tvl ${row.tvl_usd ?? "-"}  vol ${row.volume_24h_usd ?? "-"}  apr fees ${row.apr_fees ?? "-"} rewards ${row.apr_rewards ?? "-"} merkl ${row.apr_merkl ?? "-"}`,
      )
    }
  } else console.log(JSON.stringify(plan.summary, null, 2))
  if (showSql) for (const s of plan.statements) console.log(inlineStatement(s))
}
// -- CoinGecko budget and the keyed pool path --------------------------------
console.log(
  `\nCoinGecko (${apiKey === null ? "no key" : `${plan} key`}): MEZO price every ${budget.priceEveryMinutes} min (refresh ${budget.refreshSeconds} s, ${budget.priceCallsPerMonth} calls in a 31-day month)`,
)
const keyedPlan = coingeckoBudget({
  plan,
  hasKey: true,
  configuredRefreshSeconds: refreshSetting,
  poolChains: poolDepthChains().length,
})
console.log(
  `  with a ${plan} key: MEZO price every ${keyedPlan.priceEveryMinutes} min (${keyedPlan.priceCallsPerMonth} calls), pools every ${keyedPlan.keyedPoolsEveryHours ?? "-"} h (${keyedPlan.keyedPoolCallsPerMonth} calls), planned ${keyedPlan.plannedCallsPerMonth ?? "uncapped"} a month${apiKey === null ? " (not used: no key)" : ""}`,
)
for (const chain of poolDepthChains()) {
  const network = crossChains[chain].geckoterminalNetwork
  if (network === null) continue
  const addresses = crossChainPools
    .filter((pool) => pool.chain === chain && pool.venue !== "mezo-savings")
    .map((pool) => pool.address.toLowerCase())
  const request = onchainPoolsRequest(network, addresses, {
    apiKey: "unused",
    plan,
  })
  const header = Object.keys(request.headers).find((name) =>
    name.startsWith("x-cg-"),
  )
  console.log(`  keyed ${chain}: GET ${request.url}  (header ${header})`)
}
