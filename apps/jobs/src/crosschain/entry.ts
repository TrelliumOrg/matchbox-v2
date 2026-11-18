import { logger } from "@matchbox/logger"
import { coingeckoBudget } from "../coingecko-budget"
import type { JobsEnv } from "../env"
import { parseScanEnv } from "../scan/env"
import { poolDepthChains } from "./pools"
import { crossChainClients } from "./rpc"
import {
  keylessPools,
  type PoolSchedule,
  runCrossChainHourly,
  runCrossChainMinute,
} from "./run"

// What apps/jobs/src/index.ts calls. A no-op without SCAN_DB; until
// scan-migrations 0006 is applied, each run logs one warning and writes
// nothing.

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

function clientsOf(env: JobsEnv) {
  return crossChainClients({
    mezo: env.MEZO_RPC_URLS,
    ethereum: env.ETHEREUM_RPC_URL,
    base: env.BASE_RPC_URL,
    bsc: env.BSC_RPC_URL,
  })
}

/**
 * Pool depth through CoinGecko's keyed endpoint when a key is set and the
 * plan's budget has room (every 2 hours on Demo), else GeckoTerminal
 * keyless every hour.
 */
export function poolSchedule(env: JobsEnv): PoolSchedule {
  const apiKey = env.COINGECKO_API_KEY
  if (apiKey === null) return keylessPools
  const budget = coingeckoBudget({
    plan: env.COINGECKO_API_PLAN,
    hasKey: true,
    configuredRefreshSeconds: env.COINGECKO_REFRESH_SECONDS,
    poolChains: poolDepthChains().length,
  })
  if (budget.keyedPoolsEveryHours === null) return keylessPools
  return {
    keyed: { apiKey, plan: env.COINGECKO_API_PLAN },
    everyHours: budget.keyedPoolsEveryHours,
  }
}

function missingTables(error: unknown): boolean {
  return error instanceof Error && /no such table/i.test(error.message)
}

/** After the minute price job: MUSD's venue quotes and headline. */
export async function crossChainMinute(
  rawEnv: unknown,
  env: JobsEnv,
): Promise<void> {
  const { scanDb } = parseScanEnv(rawEnv)
  if (scanDb === null) return
  const log = logger.child({ task: "crosschain-price" })
  try {
    await runCrossChainMinute({
      db: scanDb,
      clients: clientsOf(env),
      coingecko: {
        apiKey: env.COINGECKO_API_KEY,
        plan: env.COINGECKO_API_PLAN,
      },
      nowSeconds: nowSeconds(),
      logger: log,
    })
  } catch (error) {
    if (!missingTables(error)) throw error
    log.warn({
      message: "Cross-chain tables missing; apply scan-migrations 0006",
    })
  }
}

/** From the 5-minute live trigger: supply, pools and bridge, hourly. */
export async function crossChainHourly(
  rawEnv: unknown,
  env: JobsEnv,
): Promise<void> {
  const { scanDb } = parseScanEnv(rawEnv)
  if (scanDb === null) return
  const log = logger.child({ task: "crosschain-hourly" })
  try {
    const outcome = await runCrossChainHourly({
      db: scanDb,
      clients: clientsOf(env),
      fetcher: (url, init) => fetch(url, init),
      pools: poolSchedule(env),
      nowSeconds: nowSeconds(),
      logger: log,
    })
    if (Object.values(outcome).some((value) => value !== "skipped")) {
      log.info({ message: "Cross-chain hourly run", ...outcome })
    }
  } catch (error) {
    if (!missingTables(error)) throw error
    log.warn({
      message: "Cross-chain tables missing; apply scan-migrations 0006",
    })
  }
}
