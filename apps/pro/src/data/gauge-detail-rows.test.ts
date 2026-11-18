import type { GaugeDetails } from "@matchbox/contracts/read-models"
import { describe, expect, it } from "vitest"
import { gaugeDetailRows } from "./gauge-detail-rows"

const address = (pair: string): string => `0x${pair.repeat(20)}`
const btc = {
  address: address("7b"),
  symbol: "BTC",
  name: "Bitcoin",
  decimals: 18,
}
const musd = {
  address: address("dd"),
  symbol: "MUSD",
  name: "Mezo USD",
  decimals: 18,
}

const labels = (details: GaugeDetails): string[] =>
  gaugeDetailRows(details).map((row) => `${row.label}: ${row.value}`)

describe("the gauge profile's details", () => {
  it("has nothing to list without details", () => {
    expect(gaugeDetailRows(null)).toEqual([])
    expect(gaugeDetailRows(undefined)).toEqual([])
  })

  it("lists a veBTC gauge's lock, power, boost and what 5× takes", () => {
    expect(
      labels({
        kind: "vebtc",
        tokenId: "1030",
        owner: address("a9"),
        beneficiary: address("a9"),
        lock: { state: "auto-max", unlocksAt: null, amount: "0.1679" },
        vebtcWeight: "0.167908630464777048",
        boost: "5",
        optimalVotes: "26344.830247710143292289",
        locked: {
          token: btc,
          amount: "0.167908630464777048",
          usd: "11594.94",
        },
      }),
    ).toEqual([
      "Lock: veBTC #1030",
      "Locked: 0.1679 BTC, $11,595",
      "Lock state: Auto max",
      "Voting power: 0.1679 veBTC",
      "Boost: 5.00×",
      "Votes for 5×: 26,345 veMEZO",
      // The beneficiary is the owner: not said twice.
    ])
  })

  it("lists a validator, leaving out what the chain does not expose", () => {
    expect(
      labels({
        kind: "validator",
        operator: address("69"),
        status: "active",
        moniker: "Beem",
        beneficiary: address("69"),
        votingPower: null,
        commission: null,
      }),
    ).toEqual(["Validator: Beem", "Status: Active", "Operator: 0x6969…6969"])
  })

  it("lists a pool's pair, type, fee and reserves", () => {
    expect(
      labels({
        kind: "pool",
        poolKind: "cl",
        pool: address("13"),
        tvlUsd: "372.34",
        emissionApr: null,
        tokens: [btc, musd],
        tickSpacing: 200,
        feePercent: "0.3",
        reserves: [
          { token: btc, amount: "0.0021", usd: "145.00" },
          { token: musd, amount: "227.34", usd: "227.34" },
        ],
        stakedPercent: "81.5",
        savingsApr: null,
      }),
    ).toEqual([
      "Pool: BTC/MUSD",
      "Type: Concentrated, tick spacing 200",
      "Swap fee: 0.30%",
      "Liquidity: $372.34",
      "Reserves: 0.00210 BTC, 227.34 MUSD",
      "Staked in gauge: 81.50%",
      "Contract: 0x1313…1313",
    ])
  })

  it("lists where a MEZO gauge's emissions go", () => {
    expect(
      labels({
        kind: "mezo",
        chain: "Base",
        protocol: "Aerodrome",
        wormholeChainId: 30,
        destination: "MEZO/MUSD CL200",
        recipient: address("f0"),
        allocator: address("ea"),
        bridge: "Wormhole NTT",
        metadata: "remote-gauge-aerodrome-mezo-musd-cl200-ef458a32",
        source: "chain",
        url: null,
      }),
    ).toEqual([
      "Chain: Base",
      "Protocol: Aerodrome",
      "Funds: MEZO/MUSD CL200",
      "Bridge: Wormhole NTT",
      "Recipient: 0xf0f0…f0f0",
      "Allocator: 0xeaea…eaea",
    ])
  })
})
