import { z } from "zod"
import { tokenRegistry } from "../read-models/token-registry"
import type { ScanContext } from "./context"
import { scanQueries } from "./queries"

// Token decimals for Morpho markets. The jobs Worker discovers every
// market from CreateMarket logs into READ_DB morpho_known_markets
// (migration 0006) with each token's on-chain decimals(), NULL when the
// token did not answer. A market's decimals are that value, else the API
// token registry's, else null: never 18 by default. Before migration 0006
// (no such table) or before the backfill finds a market, the registry
// alone answers.

export type MarketDecimals = { loan: number | null; collateral: number | null }

const knownRowSchema = z.object({
  market_id: z.string(),
  loan_decimals: z.number().int().min(0).max(36).nullable(),
  collateral_decimals: z.number().int().min(0).max(36).nullable(),
})

/** Decimals the jobs Worker read on chain, per market (lower case). */
export async function knownMarketDecimals(
  scan: ScanContext,
): Promise<Map<string, MarketDecimals>> {
  const known = new Map<string, MarketDecimals>()
  if (scan.deps.readDb === null) return known
  let rows: unknown[]
  try {
    rows = await scan.rows(scanQueries.knownMarkets, [scan.deps.network])
  } catch (error) {
    // Before migration 0006 there is no table: the registry answers.
    const text = error instanceof Error ? error.message : String(error)
    if (text.includes("no such table")) return known
    throw error
  }
  for (const row of rows) {
    const parsed = knownRowSchema.safeParse(row)
    if (!parsed.success) continue
    known.set(parsed.data.market_id.toLowerCase(), {
      loan: parsed.data.loan_decimals,
      collateral: parsed.data.collateral_decimals,
    })
  }
  return known
}

/** A token's decimals: the on-chain read, else the registry, else null. */
export function tokenDecimals(
  onChain: number | null | undefined,
  token: string,
): number | null {
  return (
    onChain ?? tokenRegistry.get(token.toLowerCase())?.token.decimals ?? null
  )
}

/** A market's loan and collateral decimals. */
export function marketDecimalsOf(
  known: ReadonlyMap<string, MarketDecimals>,
  market: { market_id: string; loan_token: string; collateral_token: string },
): MarketDecimals {
  const onChain = known.get(market.market_id.toLowerCase())
  return {
    loan: tokenDecimals(onChain?.loan, market.loan_token),
    collateral: tokenDecimals(onChain?.collateral, market.collateral_token),
  }
}
