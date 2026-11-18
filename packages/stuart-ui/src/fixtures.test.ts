import { describe, expect, it } from "vitest"
import { type StuartRequest, stuartResponseSchema } from "./contract"
import { fixtureTurn } from "./fixtures"

function request(query: string, extra?: Partial<StuartRequest>): StuartRequest {
  return {
    version: 1,
    query,
    sessionId: "6f1c1b8e-3c55-4a3f-9b8a-1d2e3f4a5b6c",
    turn: 0,
    surface: "composer",
    chainId: 31_612,
    ...extra,
  }
}

describe("fixtures", () => {
  it.each([
    [
      "Which veBTC gauges pay best for my #2207 votes this epoch?",
      "rank_gauges",
    ],
    ["Move the Kiln Labs 70% to Sats Collective", "custom_vote"],
    ["How far is it from 5×?", "explain_gauge"],
  ])("answers %s with a contract-valid %s response", (query, intent) => {
    const turn = fixtureTurn(
      request(query, {
        wallet: {
          address: "0x7c21095156ab25e989c3c084bcb06037c6539e0b",
          mode: "connected",
        },
      }),
    )
    const parsed = stuartResponseSchema.safeParse(turn.response)
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true)
    expect(turn.response.intent).toBe(intent)
    expect(turn.status.length).toBeGreaterThan(0)
  })

  it("keeps the vote proposal read only without a connected wallet", () => {
    const turn = fixtureTurn(
      request("Move the Kiln Labs 70% to Sats Collective"),
    )
    const proposal = turn.response.proposedActions[0]
    expect(proposal?.canSign).toBe(false)
    expect(proposal?.blockedReason).toBe("connect_this_wallet")
    expect(stuartResponseSchema.safeParse(turn.response).success).toBe(true)
  })

  it("explains the pinned gauge when asked about one", () => {
    const turn = fixtureTurn(
      request("Anything I should know?", {
        context: {
          page: {
            route: "/gauges/0x1",
            entity: { type: "gauge", id: "0x1", label: "Kiln Labs" },
          },
        },
      }),
    )
    expect(turn.response.uiBlocks[0]?.type).toBe("gauge_explain")
  })
})
