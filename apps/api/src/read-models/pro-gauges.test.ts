import type { GaugeCard, GaugeDirectory } from "@matchbox/contracts/read-models"
import {
  demoGaugeCards,
  demoGaugeDirectory,
} from "@matchbox/contracts/read-models/fixtures"
import { describe, expect, it } from "vitest"
import proDirectory from "./pro-gauges"

const template: GaugeCard = demoGaugeCards.kilnLabs

function card(address: string, voter: GaugeCard["gauge"]["voter"]): GaugeCard {
  return { ...template, gauge: { ...template.gauge, address, voter } }
}

// Listed by the Mezo app: Curve bdUSD/MUSD. Not listed: SNF Community.
const curveBdusd = card(
  "0xfee9aa9146e95d233e1b2b48bda69a3bc4e268c1",
  "third-party",
)
const snfCommunity = card(
  "0xbc4156e8bd22efa106498c1dd7a4d5b932fd3219",
  "third-party",
)
const boost = card("0x449b06b9b6c9b649b610105d1a5e337e1d6d3d1e", "boost")
const pool = card("0x21d7acb0d128fa039064b6ace8db88c0ade0209e", "pools")

const directory: GaugeDirectory = {
  ...demoGaugeDirectory,
  gauges: [curveBdusd, snfCommunity, boost, pool],
}

function addresses(result: GaugeDirectory): string[] {
  return result.gauges.map((entry) => entry.gauge.address)
}

describe("proDirectory", () => {
  it("drops MEZO gauges the Mezo app does not list on mainnet", () => {
    expect(addresses(proDirectory(directory, "mezo"))).toEqual([
      curveBdusd.gauge.address,
      boost.gauge.address,
      pool.gauge.address,
    ])
  })

  it("matches a checksummed address", () => {
    const checksummed = card(
      "0xfee9aa9146E95D233e1b2b48bda69a3bC4E268c1",
      "third-party",
    )
    const result = proDirectory({ ...directory, gauges: [checksummed] }, "mezo")
    expect(addresses(result)).toEqual([checksummed.gauge.address])
  })

  it("keeps the vote total, which counts every gauge", () => {
    expect(proDirectory(directory, "mezo").totalVotes).toBe(
      directory.totalVotes,
    )
  })

  it("leaves testnet whole", () => {
    expect(proDirectory(directory, "mezo-testnet")).toBe(directory)
  })
})
