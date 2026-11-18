import { demoMeta, demoSummary } from "@matchbox/contracts/read-models/fixtures"
import { stuartRequestSchema } from "@matchbox/stuart-ui/contract"
import { describe, expect, it } from "vitest"
import { fakeProviders, NOW } from "./fakes"
import { runStuartQuery } from "./orchestrator"
import { protocolSnapshot } from "./providers/protocol"
import { displayPrice, displayUtc } from "./tools/protocol"

const E18 = 10n ** 18n

function ask(query: string, providers = fakeProviders()) {
  return runStuartQuery(
    stuartRequestSchema.parse({
      version: 1,
      query,
      sessionId: "6f1c1b8e-3c55-4a3f-9b8a-1d2e3f4a5b6c",
      turn: 0,
      surface: "palette",
      chainId: 31_612,
    }),
    {
      providers,
      secret: "test-secret",
      now: () => NOW,
      claude: null,
      log: () => undefined,
    },
  )
}

describe("protocol totals", () => {
  it("prefer the escrows' on-chain supply over the warehouse sum", () => {
    const summary = { data: demoSummary, meta: demoMeta }
    const chain = {
      blockNumber: 13_102_450n,
      vemezoLocked: 282_928_843n * E18,
      vebtcLocked: 804n * E18,
      vemezoVotingPower: 99_505_321n * E18,
    }
    const live = protocolSnapshot({ summary, chain, now: NOW })
    expect(live.lockedSource).toBe("chain")
    expect(live.vemezoLocked).toBe(chain.vemezoLocked)
    expect(live.blockNumber).toBe(13_102_450n)
    // Without the chain read, the summary's totals stand in and say so.
    const fallback = protocolSnapshot({ summary, chain: null, now: NOW })
    expect(fallback.lockedSource).toBe("read-model")
    expect(fallback.vemezoVotingPower).toBeNull()
    expect(fallback.blockNumber).toBe(BigInt(demoMeta.block))
  })

  it("answer 'how much MEZO is locked' without a wallet", async () => {
    const response = await ask("How much MEZO is locked as veMEZO?")
    expect(response.intent).toBe("protocol_stats")
    expect(response.answer.text).toBe(
      "282,928,843.50 MEZO is locked in veMEZO by 1,353 lockers, and 804.3000 BTC in veBTC.",
    )
    expect(response.evidence.map((item) => item.label)).toContain(
      "veMEZO and veBTC escrows",
    )
  })

  it("mark warehouse totals stale when the chain read failed", async () => {
    const base = fakeProviders()
    const response = await ask(
      "How much MEZO is locked as veMEZO?",
      fakeProviders({
        protocol: async () => ({
          ...(await base.protocol()),
          lockedSource: "read-model",
        }),
      }),
    )
    expect(response.evidence[0]).toMatchObject({
      kind: "indexer",
      status: "stale",
    })
    expect(response.facts[0]).toMatchObject({ status: "stale" })
  })

  it("print sub-dollar prices with six decimals and dates in UTC", () => {
    expect(displayPrice(4_061n)).toBe("$0.004061")
    expect(displayPrice(74_492_115_090n)).toBe("$74,492.12")
    expect(displayPrice(null)).toBe("Unpriced")
    expect(displayUtc(1_794_441_600)).toBe("Thu 12 Nov 2026 00:00 UTC")
  })
})
