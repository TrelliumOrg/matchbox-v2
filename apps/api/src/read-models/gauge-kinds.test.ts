import { gaugeQuerySchema } from "@matchbox/contracts/read-models"
import {
  demoGaugeCards,
  demoGaugeDirectory,
} from "@matchbox/contracts/read-models/fixtures"
import { logger } from "@matchbox/logger"
import { describe, expect, it } from "vitest"
import { walletBalances } from "./balances"
import {
  createGaugeDetailsReader,
  destinationFromMetadata,
} from "./gauge-details"
import { crossChainFallbackName, crossChainName } from "./gauge-labels"
import { detailsRequest, gaugeRef, tokensBySymbol } from "./gauges"
import { createIdentityReader, toWalletIdentity } from "./identity"
import { pageGauges } from "./routes"

const gauge = "0x4440a9b2954cb98416c0122e2ea996c46555f4b6"

describe("MEZO gauge names", () => {
  it("names remote gauges from their creation metadata", () => {
    expect(
      crossChainName("remote-gauge-aerodrome-mezo-musd-cl200-ef458a32"),
    ).toBe("Aerodrome MEZO/MUSD CL200")
    expect(
      crossChainName("remote-gauge-uniswap-v4-usdc-musd-fee100-a9bf5691"),
    ).toBe("Uniswap v4 USDC/MUSD 0.01%")
    expect(crossChainName("remote-gauge-curve-musd-2pool-b5571e76")).toBe(
      "Curve MUSD 2pool",
    )
    expect(crossChainName("snf-community")).toBe("SNF Community")
    expect(crossChainName("Mezo Technical")).toBe("Mezo Technical")
    expect(crossChainFallbackName(gauge)).toBe("Cross-chain 0x4440…f4b6")
  })

  it("reads the protocol and destination from metadata", () => {
    expect(
      destinationFromMetadata(
        "remote-gauge-aerodrome-mezo-musd-cl200-ef458a32",
      ),
    ).toEqual({ protocol: "Aerodrome", destination: "MEZO/MUSD CL200" })
    expect(
      destinationFromMetadata(
        "remote-gauge-uniswap-v4-usdc-musd-fee100-a9bf5691",
      ),
    ).toEqual({ protocol: "Uniswap v4", destination: "USDC/MUSD 0.01%" })
    expect(destinationFromMetadata("snf-community")).toEqual({
      protocol: null,
      destination: null,
    })
  })

  it("makes MEZO gauges kind mezo, named by their label", () => {
    const ref = gaugeRef(
      {
        voter: "third-party",
        network: "mezo",
        gaugeAddress: gauge,
        isAlive: true,
        weight: null,
        bribeContract: null,
      },
      undefined,
      {
        label: {
          type: "named",
          name: "Aerodrome MEZO/MUSD CL200",
          metadata: "remote-gauge-aerodrome-mezo-musd-cl200-ef458a32",
        },
      },
    )
    expect(ref).toMatchObject({
      kind: "mezo",
      name: "Aerodrome MEZO/MUSD CL200",
    })
  })
})

describe("pool gauges", () => {
  const base = {
    voter: "pools" as const,
    network: "mezo" as const,
    gaugeAddress: "0x21d7acb0d128fa039064b6ace8db88c0ade0209e",
    isAlive: true,
    weight: null,
    bribeContract: null,
    poolAddress: "0x9cbc1537d255768b431488305b1c7efc2ac95022",
    poolSymbol: null,
    feesContract: null,
  }
  const btc = {
    address: "0x7b7c000000000000000000000000000000000000",
    symbol: "BTC",
    name: "Bitcoin",
    decimals: 18,
  }
  const musd = {
    address: "0xdd468a1ddc392dcdbef6db6e34e89aa338f9f186",
    symbol: "MUSD",
    name: "Mezo USD",
    decimals: 18,
  }

  it("names a CL pool by its pair and asks for CL metadata", () => {
    const label = {
      type: "pair" as const,
      poolType: "cl" as const,
      tickSpacing: 200,
      tokens: [btc, musd] as [typeof btc, typeof musd],
    }
    expect(gaugeRef(base, undefined, { label })).toMatchObject({
      kind: "pool",
      name: "BTC/MUSD",
      poolType: "cl",
      tickSpacing: 200,
      picture: { type: "pair" },
    })
    expect(
      detailsRequest(
        base,
        undefined,
        undefined,
        label,
        tokensBySymbol([]),
        null,
      ),
    ).toEqual({
      kind: "pool",
      gauge: base.gaugeAddress,
      pool: base.poolAddress,
      poolKind: "cl",
      tokens: [btc, musd],
      tickSpacing: 200,
    })
  })

  it("names a vault gauge by its token and gives it the coin", () => {
    const smusd = {
      address: "0xb4d498029af77680cd1ef828b967f010d06c51cc",
      symbol: "sMUSD",
      name: "MUSD Savings Rate",
      decimals: 18,
    }
    const label = { type: "vault" as const, token: smusd }
    const vault = { ...base, poolAddress: smusd.address, poolSymbol: "sMUSD" }
    expect(gaugeRef(vault, undefined, { label })).toMatchObject({
      name: "sMUSD",
      coin: smusd,
      poolType: null,
    })
    expect(
      detailsRequest(
        vault,
        undefined,
        undefined,
        label,
        tokensBySymbol([]),
        null,
      ),
    ).toMatchObject({ kind: "pool", poolKind: "vault", tokens: [smusd] })
  })

  it("reads vAMM and sAMM from classic symbols", () => {
    const classic = { ...base, poolSymbol: "sAMM-mUSDC/MUSD" }
    expect(
      detailsRequest(
        classic,
        undefined,
        undefined,
        null,
        tokensBySymbol([]),
        null,
      ),
    ).toMatchObject({ poolKind: "samm", tickSpacing: null })
  })
})

describe("wallet identity", () => {
  // Mezo's shape, as api.mezo.org/accounts answers (probed 13 Nov 2026).
  const own = "0x449b06b9b6c9b649b610105d1a5e337e1d6d3d1e"
  const answer = {
    mezoId: "alice.mezo",
    linkedAccounts: [
      {
        type: "wallet",
        btcAddress: "bc1qxyz",
        evmAddress: "0x449B06b9B6c9b649B610105D1A5e337E1D6D3d1e",
      },
    ],
  }

  it("maps Mezo's account answer for the account's own wallet", () => {
    expect(toWalletIdentity(own, answer)).toEqual({
      address: own,
      status: "found",
      mezoId: "alice.mezo",
      linkedAccounts: [
        { type: "wallet", evmAddress: own, btcAddress: "bc1qxyz" },
      ],
    })
  })

  it("names no other address by the account's ID", () => {
    // Another address, or an account with a linked (not own) wallet or
    // two wallets: Mezo's ID is not this address's.
    expect(toWalletIdentity("0xab", answer).mezoId).toBeNull()
    for (const linkedAccounts of [
      [{ type: "linked", evmAddress: own }],
      [
        { type: "wallet", evmAddress: own },
        { type: "wallet", evmAddress: `0x${"1".repeat(40)}` },
      ],
    ]) {
      expect(
        toWalletIdentity(own, { mezoId: "alice.mezo", linkedAccounts }).mezoId,
      ).toBeNull()
    }
  })

  it("reads Mezo's 'Account has no Mezo ID' as not found, other 500s as down", async () => {
    const reader = (body: unknown) =>
      createIdentityReader({
        fetcher: async () => Response.json(body, { status: 500 }),
        logger,
      })
    expect(
      (await reader({ error: "Account has no Mezo ID" })(own)).status,
    ).toBe("not-found")
    expect((await reader({ error: "Database down" })(own)).status).toBe(
      "unavailable",
    )
  })

  it("answers not-found and unavailable instead of failing", async () => {
    const address = "0x449b06b9b6c9b649b610105d1a5e337e1d6d3d1e"
    const requested: string[] = []
    const missing = createIdentityReader({
      fetcher: async (url) => {
        requested.push(url)
        return new Response("{}", { status: 404 })
      },
      logger,
    })
    expect((await missing(address)).status).toBe("not-found")
    // Checksummed, as the accounts API wants.
    expect(requested[0]).toBe(
      "https://api.mezo.org/accounts/0x449b06b9b6C9B649B610105D1a5e337e1D6d3d1E",
    )
    const down = createIdentityReader({
      fetcher: async () => {
        throw new TypeError("fetch failed")
      },
      logger,
    })
    expect(await down(address)).toEqual({
      address,
      status: "unavailable",
      mezoId: null,
      linkedAccounts: [],
    })
  })
})

describe("wallet balances", () => {
  it("adds every other registered token the wallet holds, priced", () => {
    const balances = walletBalances(
      "0xab",
      {
        block: 1,
        btc: 0n,
        mezo: 0n,
        musd: 0n,
        others: new Map([
          ["0x04671c72aab5ac02a03c1098314b1bb6b560c197", 25_000_000n],
          ["0xa10ad2570ea7b93d19fdae6bd7189ff4929bc747", 10n ** 16n],
          ["0xb4d498029af77680cd1ef828b967f010d06c51cc", 5n * 10n ** 18n],
        ]),
      },
      {
        btc: {
          usd: "100000",
          change24h: null,
          source: "mezo-oracle",
          updatedAt: 1,
        },
        mezo: null,
      },
    )
    expect(
      balances.tokens.map((token) => [
        token.token.symbol,
        token.amount,
        token.usd,
      ]),
    ).toEqual([
      ["mSolvBTC", "0.01", "1000.00"],
      ["mUSDC", "25", "25.00"],
      ["sMUSD", "5", null],
    ])
  })
})

describe("retired veBTC gauges", () => {
  it("lists expired and withdrawn locks last in every order", () => {
    const expired = {
      ...demoGaugeCards.kilnLabs,
      votes: "99999999",
      apy: "99.00",
      meta: {
        kind: "vebtc" as const,
        tokenId: "5678",
        owner: null,
        beneficiary: null,
        lock: {
          state: "expired" as const,
          unlocksAt: Date.UTC(2026, 4, 7) / 1000,
          amount: "0.0009",
        },
      },
      gauge: { ...demoGaugeCards.kilnLabs.gauge, name: "veBTC #5678" },
    }
    const directory = {
      ...demoGaugeDirectory,
      gauges: [expired, ...demoGaugeDirectory.gauges],
    }
    for (const sort of ["votes", "apy", "incentives"] as const) {
      const page = pageGauges(
        directory,
        gaugeQuerySchema.parse({ sort, limit: 100 }),
      )
      expect(page.gauges.at(-1)?.gauge.name).toBe("veBTC #5678")
    }
  })

  it("reads the lock state into veBTC requests", () => {
    const request = detailsRequest(
      {
        voter: "boost",
        network: "mezo",
        gaugeAddress: "0x1000000000000000000000000000000000000001",
        isAlive: true,
        weight: "0",
        bribeContract: null,
        vebtcTokenId: "5678",
        beneficiary: null,
        boostMultiplier: null,
      },
      undefined,
      undefined,
      null,
      tokensBySymbol([]),
      {
        vemezoTotalVotingPower: null,
        vebtcUnboostedTotal: null,
        locks: new Map(),
        lockInfo: new Map([
          [
            "5678",
            {
              amount: 9n * 10n ** 14n,
              end: 1_778_112_000n,
              isPermanent: false,
            },
          ],
        ]),
      },
    )
    expect(request).toMatchObject({
      kind: "vebtc",
      lock: {
        amount: 9n * 10n ** 14n,
        end: 1_778_112_000n,
        isPermanent: false,
      },
      killed: false,
    })
  })

  it("calls a killed gauge's unreadable lock withdrawn", async () => {
    const client = {
      multicall: async () => [],
      getBlock: async () => ({ number: 1n, timestamp: 1n }),
    }
    const details = await createGaugeDetailsReader({
      client: client as unknown as Parameters<
        typeof createGaugeDetailsReader
      >[0]["client"],
      db: null,
      network: "mezo",
      logger,
    })(
      [
        {
          kind: "vebtc",
          gauge: "0x1000000000000000000000000000000000000001",
          tokenId: null,
          beneficiary: null,
          vebtcWeight: null,
          boost: null,
          optimalVotes: null,
          locked: null,
          lock: null,
          killed: true,
        },
      ],
      null,
      1_794_200_000,
    )
    expect(
      details.get("0x1000000000000000000000000000000000000001"),
    ).toMatchObject({ lock: { state: "withdrawn", amount: "0" } })
  })
})
