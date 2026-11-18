import { stuartRequestSchema } from "@matchbox/stuart-ui/contract"
import { MAINNET } from "../src/query/providers/abis"
import type { KnownAddresses } from "./grade"
import { BENCH_WALLET, GAUGES } from "./world"

// What the single run (run.test.ts) and the matrix (matrix/) share: the
// request for one question, and the addresses a proposal may point at.

export function knownAddresses(): KnownAddresses {
  const pools = new Set<string>()
  const gauges = new Set<string>()
  for (const gauge of GAUGES) {
    if (gauge.voter === "pools") {
      if (gauge.pool) pools.add(gauge.pool)
    } else {
      gauges.add(gauge.address)
    }
  }
  return {
    wallet: BENCH_WALLET.toLowerCase(),
    poolsVoter: MAINNET.poolsVoter.toLowerCase(),
    contracts: new Set(
      Object.values(MAINNET).map((value) => value.toLowerCase()),
    ),
    pools,
    gauges,
  }
}

export function requestFor(query: string, wallet: boolean) {
  return stuartRequestSchema.parse({
    version: 1,
    query,
    sessionId: "6f1c1b8e-3c55-4a3f-9b8a-1d2e3f4a5b6c",
    turn: 0,
    surface: "rail",
    chainId: 31_612,
    ...(wallet ? { wallet: { address: BENCH_WALLET, mode: "connected" } } : {}),
  })
}
