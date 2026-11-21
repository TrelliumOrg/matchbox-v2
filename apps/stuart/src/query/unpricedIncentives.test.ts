import {
  stuartRequestSchema,
  stuartResponseSchema,
} from "@matchbox/stuart-ui/contract"
import type { Address } from "viem"
import { describe, expect, it } from "vitest"
import type { StuartProviders } from "./context"
import {
  fakeDomain,
  fakeProviders,
  fakeTarget,
  NOW,
  PRICES,
  WALLET,
} from "./fakes"
import { runStuartQuery } from "./orchestrator"
import type { ClaimableLock } from "./providers/claims"
import type { VoteTarget } from "./providers/voting"

// Incentive tokens are permissionless: anyone can deploy a worthless token
// named "7777USD" or "FAKEBTC" and post it on a gauge. Stuart prices tokens
// by registry address only, so such a token is unpriced: it adds nothing to
// a USD total, the optimizer never allocates to a gauge on its account, and
// the answer says the incentive exists without giving it a dollar value.

const E18 = 10n ** 18n
const NOW_ISO = NOW.toISOString()
const MUSD: Address = "0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186"
const FAKE_USD: Address = "0x7777777777777777777777777777777777777777"
const FAKE_BTC: Address = "0x8888888888888888888888888888888888888888"
const FAKE_MUSD: Address = "0x9999999999999999999999999999999999999998"
const MEZO: Address = "0x7B7c000000000000000000000000000000000001"

function withOnly(
  target: VoteTarget,
  incentives: Array<{ token: Address; symbol: string; amount: bigint }>,
): VoteTarget {
  return {
    ...target,
    incentives: incentives.map((incentive) => ({
      contract: target.rewardContracts[0] ?? target.gaugeAddress,
      decimals: 18,
      ...incentive,
    })),
  }
}

// One real gauge paying MEZO, and one whose only incentive is a fake token
// worth $7,777 if it were priced by its symbol.
function scamDomain(
  incentives: Array<{ token: Address; symbol: string; amount: bigint }>,
) {
  return fakeDomain([
    fakeTarget({
      index: 1,
      name: "Stackbridge",
      weight: 1_000n * E18,
      mezo: 30_000n * E18,
    }),
    withOnly(
      fakeTarget({ index: 2, name: "Scam Gauge", weight: 1n * E18, mezo: 0n }),
      incentives,
    ),
  ])
}

const FAKES: Array<[string, Address, string]> = [
  ["7777USD", FAKE_USD, "7777USD"],
  ["FAKEBTC", FAKE_BTC, "FAKEBTC"],
  ["CLAIM 7777 MUSD", FAKE_MUSD, "CLAIM 7777 MUSD"],
  ["lower-case musd", FAKE_MUSD, "musd"],
  ["exact MUSD symbol at another address", FAKE_MUSD, "MUSD"],
  ["exact BTC symbol at another address", FAKE_BTC, "BTC"],
]

async function ask(query: string, overrides: Partial<StuartProviders>) {
  const logs: Array<Record<string, unknown>> = []
  const response = await runStuartQuery(
    stuartRequestSchema.parse({
      version: 1,
      query,
      sessionId: "6f1c1b8e-3c55-4a3f-9b8a-1d2e3f4a5b6c",
      turn: 0,
      surface: "palette",
      chainId: 31_612,
      wallet: { address: WALLET, mode: "connected" },
    }),
    {
      providers: fakeProviders(overrides),
      secret: "test-secret",
      now: () => NOW,
      claude: null,
      log: (event) => logs.push(event),
    },
  )
  expect(logs.filter((event) => event.message !== "stuart.query")).toEqual([])
  expect(stuartResponseSchema.safeParse(response).success).toBe(true)
  return response
}

function scamOnly(symbol: string, token: Address): Partial<StuartProviders> {
  return {
    votingDomain: async () =>
      scamDomain([{ token, symbol, amount: 7_777n * E18 }]),
  }
}

describe("a worthless token as a gauge's only incentive", () => {
  it.each(FAKES)(
    "never recommends the gauge for %s",
    async (_, token, symbol) => {
      const response = await ask("optimize my votes", scamOnly(symbol, token))
      expect(response.intent).toBe("optimize_votes")
      const text = JSON.stringify(response)
      expect(text).not.toMatch(/7,77\d/)
      const ballot = response.uiBlocks.find(
        (block) => block.type === "gauge_ranking",
      )
      if (ballot?.type !== "gauge_ranking") throw new Error("no ballot")
      const scam = ballot.rows.find((row) => row.name === "Scam Gauge")
      expect(scam?.allocationBps ?? null).toBeNull()
      const stack = ballot.rows.find((row) => row.name === "Stackbridge")
      expect(stack?.allocationBps).toBe(10_000)
    },
  )
})

describe("mixed real and fake incentives", () => {
  // Stackbridge carries 30,000 MEZO ($300.00) plus a fake "7777USD".
  const mixed: Partial<StuartProviders> = {
    votingDomain: async () => {
      const domain = scamDomain([
        { token: FAKE_USD, symbol: "7777USD", amount: 7_777n * E18 },
      ])
      const [stack, scam] = domain.targets
      if (!stack || !scam) throw new Error("fixture")
      return {
        ...domain,
        targets: [
          withOnly(stack, [
            { token: MEZO, symbol: "MEZO", amount: 30_000n * E18 },
            { token: FAKE_USD, symbol: "7777USD", amount: 7_777n * E18 },
          ]),
          scam,
        ],
      }
    },
  }

  it("counts only the priced part and says the rest exists", async () => {
    const response = await ask("explain the Stackbridge gauge", mixed)
    expect(response.intent).toBe("explain_gauge")
    expect(response.answer.text).toMatch(
      /^Stackbridge: \$300\.00 incentives this epoch, APY \S+ at 1,000\.00 veMEZO\. 1 unpriced incentive is not counted\./,
    )
    expect(JSON.stringify(response)).not.toMatch(/7,77\d/)
    // Each line carries its token address and whether it is priced, so a
    // fake token is told from a real one with the same symbol.
    const block = response.uiBlocks.find(
      (item) => item.type === "gauge_explain",
    )
    if (block?.type !== "gauge_explain") throw new Error("no block")
    expect(
      block.incentives.map((line) => [line.symbol, line.token, line.priced]),
    ).toEqual([
      ["MEZO", MEZO, true],
      ["7777USD", FAKE_USD, false],
    ])
  })

  it("ranks by priced incentives and names the unpriced ones", async () => {
    const response = await ask("which gauges have the most incentives", mixed)
    expect(response.intent).toBe("rank_gauges")
    expect(response.answer.text).toMatch(
      /^.*Stackbridge has the most incentives deposited this epoch, \$300\.00\./,
    )
    const why = response.why?.items.map((item) => item.text) ?? []
    expect(why).toContain(
      "Stackbridge also has 1 unpriced incentive, not counted in its USD figure.",
    )
    expect(why).toContain(
      "1 live target has only unpriced incentives, tokens with no verified price, so it is not ranked.",
    )
    const ranking = response.uiBlocks.find(
      (block) => block.type === "gauge_ranking",
    )
    if (ranking?.type !== "gauge_ranking") throw new Error("no ranking")
    expect(ranking.rows.map((row) => row.name)).toEqual(["Stackbridge"])
    expect(ranking.rows[0]?.depositedUsd).toBe("300.000000")
    expect(ranking.rows[0]?.pricingStatus).toBe("partial")
  })

  it("never ranks the fake-only gauge by APY", async () => {
    // Stackbridge with votes above the APY floor of 10,000 veMEZO.
    const response = await ask("which gauge pays the most this epoch", {
      votingDomain: async (branch) => {
        if (mixed.votingDomain === undefined) throw new Error("fixture")
        const domain = await mixed.votingDomain(branch)
        return {
          ...domain,
          targets: domain.targets.map((target) =>
            target.name === "Stackbridge"
              ? { ...target, weight: 100_000n * E18 }
              : target,
          ),
        }
      },
    })
    expect(response.intent).toBe("rank_gauges")
    expect(response.answer.text).toMatch(/^.*Stackbridge pays the most/)
    const ranking = response.uiBlocks.find(
      (block) => block.type === "gauge_ranking",
    )
    if (ranking?.type !== "gauge_ranking") throw new Error("no ranking")
    expect(ranking.rows.map((row) => row.name)).toEqual(["Stackbridge"])
    expect(JSON.stringify(response)).not.toMatch(/7,77\d/)
  })

  it("optimizes on priced value only and says unpriced value is left out", async () => {
    const response = await ask("optimize my votes", mixed)
    const ballot = response.uiBlocks.find(
      (block) => block.type === "gauge_ranking",
    )
    if (ballot?.type !== "gauge_ranking") throw new Error("no ballot")
    expect(ballot.rows.map((row) => [row.name, row.allocationBps])).toEqual([
      ["Stackbridge", 10_000],
    ])
    expect(response.why?.items.map((item) => item.text)).toContain(
      "Unpriced incentives on 2 targets are left out of USD totals and the optimizer rather than given a price.",
    )
  })
})

describe("a gauge whose only incentives are unpriced", () => {
  it("is explained without a dollar value", async () => {
    const response = await ask(
      "explain the Scam Gauge",
      scamOnly("7777USD", FAKE_USD),
    )
    expect(response.intent).toBe("explain_gauge")
    expect(response.answer.text).toMatch(
      /^Scam Gauge: 1 unpriced incentive this epoch and no priced ones, so no USD value or APY, at 1\.00 veMEZO\./,
    )
    expect(response.answer.text).not.toMatch(/\$/)
    const block = response.uiBlocks.find(
      (item) => item.type === "gauge_explain",
    )
    expect(block).toMatchObject({ incentivesUsd: null, apyBps: null })
  })

  it("is left out of the optimal ballot because it is unpriced", async () => {
    const response = await ask(
      "why isn't Scam Gauge in my ballot",
      scamOnly("FAKEBTC", FAKE_BTC),
    )
    expect(response.answer.text).toBe(
      "Scam Gauge's incentives are unpriced, so the optimizer leaves it out.",
    )
  })
})

describe("registered tokens keep their prices", () => {
  it("prices a registry token by address whatever its on-chain symbol", async () => {
    const odd: Partial<StuartProviders> = {
      votingDomain: async () =>
        scamDomain([{ token: MUSD, symbol: "CLAIM ME", amount: 500n * E18 }]),
    }
    const response = await ask("explain the Scam Gauge", odd)
    expect(response.answer.text).toMatch(
      /^Scam Gauge: \$500\.00 incentives this epoch/,
    )
  })

  it("leaves the default fixtures' golden values unchanged", async () => {
    const response = await ask("explain the Stackbridge gauge", {})
    expect(response.answer.text).toMatch(
      /^Stackbridge: \$300\.00 incentives this epoch, APY /,
    )
    const claims = await ask("show my claimable rewards", {})
    expect(claims.answer.text).toBe(
      "$241.20 claimable from veMEZO #4821. 1 reward is unpriced.",
    )
  })
})

describe("claimable rewards in fake tokens", () => {
  function claimsOf(
    entries: Array<{ token: Address; symbol: string; earned: bigint }>,
  ): Partial<StuartProviders> {
    const locks: ClaimableLock[] = [
      {
        source: "boost_bribes",
        voter: "0x2Ba614a598Cffa5a19d683cDCA97bac3a49313d1",
        tokenId: 4821n,
        entries: entries.map((entry) => ({
          contract: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb1",
          decimals: 18,
          ...entry,
        })),
      },
    ]
    return {
      claims: async () => ({ locks, blockNumber: 12_482_113n }),
    }
  }

  it("never gives a dollar value for fake-only rewards", async () => {
    const response = await ask(
      "show my claimable rewards",
      claimsOf([
        { token: FAKE_USD, symbol: "7777USD", earned: 7_777n * E18 },
        { token: FAKE_MUSD, symbol: "CLAIM 7777 MUSD", earned: 7_777n * E18 },
      ]),
    )
    expect(response.answer.text).toBe(
      "2 unpriced rewards claimable from veMEZO #4821.",
    )
    expect(JSON.stringify(response.facts)).not.toMatch(/\$/)
    const block = response.uiBlocks.find((item) => item.type === "claim_review")
    expect(block).toMatchObject({ totalUsd: null, unpricedCount: 2 })
  })

  it("totals only the registry tokens in a mixed claim", async () => {
    const response = await ask(
      "show my claimable rewards",
      claimsOf([
        { token: MUSD, symbol: "MUSD", earned: 12n * E18 },
        { token: FAKE_BTC, symbol: "FAKEBTC", earned: 7_777n * E18 },
      ]),
    )
    expect(response.answer.text).toBe(
      "$12.00 claimable from veMEZO #4821. 1 reward is unpriced.",
    )
  })
})

// Two live gauges whose only incentives are fake tokens: nothing is priced.
const unpricedOnly: Partial<StuartProviders> = {
  votingDomain: async () => {
    const domain = scamDomain([
      { token: FAKE_BTC, symbol: "FAKEBTC", amount: 7_777n * E18 },
    ])
    const [stack, scam] = domain.targets
    if (!stack || !scam) throw new Error("fixture")
    return {
      ...domain,
      targets: [
        withOnly(stack, [
          { token: FAKE_MUSD, symbol: "MUSD", amount: 500n * E18 },
        ]),
        scam,
      ],
    }
  },
}

describe("optimizing when nothing is priced", () => {
  it("says no target is priced, not that the wallet has no lock", async () => {
    const response = await ask("optimize my votes", unpricedOnly)
    expect(response.intent).toBe("optimize_votes")
    expect(response.answer.text).toBe(
      "No live target has priced incentives this epoch. 2 live targets have only unpriced incentives, tokens with no verified price. There is nothing to optimize.",
    )
    expect(response.answer.text).not.toMatch(/lock/)
    expect(
      response.uiBlocks.some((block) => block.type === "gauge_ranking"),
    ).toBe(false)
  })

  it("says a missing price is the reason when the MEZO price is unavailable", async () => {
    const response = await ask("optimize my votes", {
      prices: async () => ({
        ...PRICES,
        mezo: { priceUsd: null, source: "unavailable", fetchedAt: NOW_ISO },
      }),
    })
    expect(response.intent).toBe("optimize_votes")
    expect(response.answer.text).toBe(
      "The MEZO price is unavailable right now, so incentives on 4 live targets can't be valued. Try again shortly.",
    )
  })

  it("says there are no incentives when no live target has any", async () => {
    const response = await ask("optimize my votes", {
      votingDomain: async () =>
        fakeDomain([
          fakeTarget({ index: 1, name: "Stackbridge", weight: E18, mezo: 0n }),
        ]),
    })
    expect(response.answer.text).toBe(
      "No live target has incentives this epoch, so there is nothing to optimize.",
    )
  })

  it("still says no lock when the wallet has none", async () => {
    const response = await ask("optimize my votes", {
      ...unpricedOnly,
      walletLocks: async () => [],
    })
    expect(response.answer.text).toBe(
      "No veMEZO lock with voting power for this wallet.",
    )
  })

  it("never says no lock for a written ballot on unpriced targets", async () => {
    const response = await ask("vote 100% to Scam Gauge", unpricedOnly)
    expect(response.answer.text).not.toMatch(/No veMEZO lock/)
  })
})

describe("ranking empty states with unpriced targets", () => {
  it("says how many targets are unpriced when ranking by deposits", async () => {
    const response = await ask(
      "which gauges have the most incentives",
      unpricedOnly,
    )
    expect(response.intent).toBe("rank_gauges")
    expect(response.answer.text).toBe(
      "No priced incentives on live targets this epoch. 2 live targets have only unpriced incentives, tokens with no verified price.",
    )
  })

  it("says how many targets are unpriced when ranking by APY", async () => {
    const response = await ask(
      "which gauge pays the most this epoch",
      unpricedOnly,
    )
    expect(response.intent).toBe("rank_gauges")
    expect(response.answer.text).toBe(
      "No live target has priced incentives and votes this epoch. 2 live targets have only unpriced incentives, tokens with no verified price.",
    )
  })
})

describe("most consistently funded", () => {
  it("names targets funded only in unpriced tokens", async () => {
    const response = await ask("which gauges are most consistently funded", {
      ...scamOnly("FAKEBTC", FAKE_BTC),
      fundedEpochs: async (domain) => {
        const [stack, scam] = domain.targets
        if (!stack || !scam) throw new Error("fixture")
        return {
          counts: new Map([[stack.targetAddress.toLowerCase(), 5]]),
          unpricedOnly: new Set([scam.targetAddress.toLowerCase()]),
        }
      },
    })
    expect(response.intent).toBe("rank_gauges")
    expect(response.answer.text).toBe(
      "Stackbridge was funded in 5 of the last 8 epochs.",
    )
    const ranking = response.uiBlocks.find(
      (block) => block.type === "gauge_ranking",
    )
    if (ranking?.type !== "gauge_ranking") throw new Error("no ranking")
    expect(ranking.rows.map((row) => row.name)).toEqual(["Stackbridge"])
    expect(response.why?.items.map((item) => item.text)).toContain(
      "1 live target had only unpriced tokens or dust in those epochs, which do not count as funded.",
    )
  })
})
