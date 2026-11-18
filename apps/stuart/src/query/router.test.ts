import { percentToBps } from "@matchbox/domain/voteMath"
import { describe, expect, it } from "vitest"
import { parseBallotScript } from "./ballotScript"
import { resolveCard } from "./cards"
import { extractSlots, routeQuery } from "./router"

/** Late on 13 Nov 2026 in UTC: already 14 Nov east of UTC. */
const NOW = new Date("2026-11-13T22:00:00Z")

function tool(query: string): { tool: string; input: unknown } | string {
  const decision = routeQuery(query)
  if (decision.kind === "tool")
    return { tool: decision.tool, input: decision.input }
  if (decision.kind === "clarify") return `clarify:${decision.cardId}`
  return decision.kind
}

describe("deterministic router", () => {
  it("routes wormhole and bridge searches", () => {
    expect(tool("wormhole transactions")).toEqual({
      tool: "search_transactions",
      input: { provider: "wormhole", direction: null, limit: null },
    })
    expect(tool("bridge transactions out of mezo")).toEqual({
      tool: "search_transactions",
      input: { provider: "all", direction: "out", limit: null },
    })
  })

  it("clarifies ambiguous gauge and vote requests", () => {
    expect(tool("which gauges are best?")).toBe("clarify:gauge-objective")
    expect(tool("help me vote")).toBe("clarify:gauge-objective")
  })

  it("uses word boundaries: 'devote' is not a vote", () => {
    expect(tool("I devote my time to Mezo")).toBe("none")
  })

  it("routes the personal optimum and the two research rankings", () => {
    expect(tool("vote on the best gauges this epoch for me")).toEqual({
      tool: "optimize_votes",
      input: { branch: null, lockIds: null },
    })
    expect(tool("which validators have the most incentives")).toEqual({
      tool: "rank_gauges",
      input: {
        objective: "most_incentives_deposited",
        branch: "validators",
        window: null,
      },
    })
    expect(tool("which gauges are consistently funded over 12 epochs")).toEqual(
      {
        tool: "rank_gauges",
        input: {
          objective: "most_consistently_funded",
          branch: null,
          window: 12,
        },
      },
    )
    expect(tool("optimize my veBTC votes")).toBe("clarify:voting-domain")
  })

  it("sends written ballots to the script tool, whole", () => {
    const query =
      "vote like the following: 30% to Stackbridge, 45.5% to Lombard and 24.5% to tBTC / WBTC"
    expect(tool(query)).toEqual({
      tool: "prepare_vote_script",
      input: { script: query },
    })
    expect(
      parseBallotScript(query).lines.map(({ target, percent }) => ({
        target,
        percent,
      })),
    ).toEqual([
      { target: "Stackbridge", percent: "30" },
      { target: "Lombard", percent: "45.5" },
      { target: "tBTC / WBTC", percent: "24.5" },
    ])
  })

  it("keeps questions about sMUSD and guarantees away from deposits", () => {
    expect(
      JSON.stringify(tool("compare incentives on sMUSD and BTC/MUSD CL200")),
    ).not.toMatch(/prepare_zap|clarify/)
    expect(tool("guarantee me 20% APY if I vote for sMUSD")).toEqual({
      tool: "mezo_knowledge",
      input: { question: "guarantee me 20% APY if I vote for sMUSD" },
    })
    // A how-to, never the optimizer: the knowledge tool or the model with it.
    const carry = routeQuery("do my votes carry over to the next epoch?")
    expect(
      carry.kind === "none"
        ? carry.help
        : carry.kind === "tool" && carry.tool === "mezo_knowledge",
    ).toBe(true)
    expect(tool("which pool pays the most?")).toEqual({
      tool: "rank_gauges",
      input: { objective: "highest_apy", branch: "pools", window: null },
    })
  })

  it("converts percents to bps without floating point", () => {
    expect(["33.33", "33.33", "33.34"].map(percentToBps)).toEqual([
      3333, 3333, 3334,
    ])
    expect(percentToBps("33.333")).toBeNull()
    expect(percentToBps("100.01")).toBeNull()
    expect(percentToBps("0.01")).toBe(1)
  })

  it("routes loans: position, scenario, repay, surplus", () => {
    expect(tool("how healthy is my mUSD trove?")).toEqual({
      tool: "get_loan_position",
      input: {},
    })
    expect(tool("If BTC falls 35%, do I get liquidated?")).toEqual({
      tool: "scenario_liquidation",
      input: { drops: null, requested: 35 },
    })
    expect(tool("Repay 5,000 mUSD on my trove")).toEqual({
      tool: "prepare_repay",
      input: { amount: "5,000" },
    })
    expect(tool("repay my loan")).toBe("clarify:repay-amount")
    expect(tool("claim my collateral surplus")).toEqual({
      tool: "claim_collateral_surplus",
      input: {},
    })
  })

  it("lists claimable rewards and prepares claims only on the verb", () => {
    expect(tool("show my claimable rewards")).toEqual({
      tool: "list_claimable_rewards",
      input: { sources: null, lockIds: null },
    })
    expect(tool("claim all my rewards")).toEqual({
      tool: "prepare_claim",
      input: { sources: null, lockIds: null },
    })
  })

  it("never guesses an Earn destination or rewrites LP requests to Savings", () => {
    expect(tool("put $50 in the vault")).toBe("clarify:earn-destination")
    expect(tool("put $50 into the MEZO/MUSD vault")).toBe(
      "clarify:earn-destination",
    )
    expect(tool("zap $100 BTC into the BTC/MUSD LP pool")).toEqual({
      tool: "prepare_zap",
      input: {
        fundingAsset: "BTC",
        amount: null,
        amountUsd: "100",
        destination: "lp-pool",
        slippageBps: null,
      },
    })
    expect(tool("Zap $50 MEZO into the mUSD vault")).toEqual({
      tool: "prepare_zap",
      input: {
        fundingAsset: "MEZO",
        amount: null,
        amountUsd: "50",
        destination: "musd-savings",
        slippageBps: null,
      },
    })
    expect(tool("deposit 50 MUSD into Savings")).toEqual({
      tool: "prepare_zap",
      input: {
        fundingAsset: "MUSD",
        amount: "50",
        amountUsd: null,
        destination: "musd-savings",
        slippageBps: null,
      },
    })
    expect(tool("deposit into savings")).toBe("clarify:zap-amount")
    expect(tool("put $50 into savings")).toBe("clarify:funding-asset")
  })

  it("resolves only options the server could have offered", () => {
    const slots = extractSlots("put $50 into the MEZO/MUSD vault")
    expect(resolveCard("earn-destination", "musd-savings", slots)).toEqual({
      kind: "clarify",
      cardId: "funding-asset",
      slots: { ...slots, destination: "musd-savings" },
    })
    expect(
      resolveCard("funding-asset", "MEZO:musd-savings:50", {
        ...slots,
        destination: "musd-savings",
      }),
    ).toEqual({
      kind: "tool",
      intent: "zap",
      tool: "prepare_zap",
      input: {
        fundingAsset: "MEZO",
        amount: null,
        amountUsd: "50",
        destination: "musd-savings",
        slippageBps: null,
      },
    })
    expect(
      resolveCard("gauge-objective", "highest_incentives", slots),
    ).toBeNull()
    expect(
      resolveCard("zap-amount", "5000:MEZO:musd-savings", slots),
    ).toBeNull()
  })

  it("navigates without tools", () => {
    expect(routeQuery("go to rewards")).toEqual({
      kind: "navigate",
      to: "/rewards",
      label: "Rewards",
    })
  })
})

describe("eval fixes", () => {
  it("answers protocol totals from get_protocol_stats, not the wallet", () => {
    const topic = (query: string) => {
      const decision = routeQuery(query)
      return decision.kind === "tool" && decision.tool === "get_protocol_stats"
        ? decision.input
        : decision
    }
    expect(topic("How much MEZO is locked as veMEZO?")).toEqual({
      topic: "locked",
    })
    expect(topic("How many veMEZO lockers are there?")).toEqual({
      topic: "lockers",
    })
    expect(topic("How much BTC is locked in veBTC?")).toEqual({
      topic: "locked",
    })
    expect(topic("What are total voting incentives this epoch?")).toEqual({
      topic: "incentives",
    })
    expect(topic("What epoch is it and when does it end?")).toEqual({
      topic: "epoch",
    })
    expect(topic("What is the MEZO price?")).toEqual({ topic: "prices" })
    // "My" or "I" makes it the wallet's question.
    expect(tool("How much MEZO do I have locked?")).toEqual({
      tool: "get_wallet_context",
      input: {},
    })
  })

  it("keeps voting power and named-gauge questions out of the vote clarifier", () => {
    expect(tool("How much veMEZO voting power do I have?")).toEqual({
      tool: "get_wallet_context",
      input: {},
    })
    expect(tool("How many votes does the SNF gauge have?")).toMatchObject({
      tool: "explain_gauge",
      input: { gauge: "SNF" },
    })
    expect(
      tool("What is the boost multiplier for the SNF gauge right now?"),
    ).toMatchObject({ tool: "explain_gauge", input: { gauge: "SNF" } })
    expect(tool("How many boost gauges have incentives this epoch?")).toEqual({
      tool: "rank_gauges",
      input: {
        objective: "most_incentives_deposited",
        branch: null,
        window: null,
      },
    })
    expect(tool("optimize my veBTC votes")).toBe("clarify:voting-domain")
  })

  it("sends how-to and troubleshooting questions to the Mezo notes", () => {
    for (const query of [
      "Why does my vote transaction revert on Thursday right after midnight?",
      "Can I vote twice with the same lock in one epoch?",
      "How does boosting a veBTC gauge with veMEZO change what I earn?",
      "A site asks me to approve my veBTC NFT so it can vote for me. Is that ok?",
      "Can I use a relayer to vote without paying gas?",
      "How do I vote for a MEZO gauge?",
      "Where can I borrow MUSD against BTC now?",
      "What is veMEZO?",
      "If my veBTC gets boosted to 5x what happens to my rewards?",
      "What's the difference between veBTC and veMEZO?",
    ]) {
      const decision = routeQuery(query)
      expect(
        decision.kind === "tool"
          ? decision.tool
          : decision.kind === "none" && decision.help
            ? "help"
            : decision.kind,
        query,
      ).toMatch(/^(mezo_knowledge|help)$/)
    }
    // Data questions keep their tools.
    expect(tool("What are my claimable rewards?")).toMatchObject({
      tool: "list_claimable_rewards",
    })
    expect(tool("Why did SNF APY change?")).toMatchObject({
      tool: "explain_gauge",
    })
    expect(tool("how healthy is my mUSD trove?")).toMatchObject({
      tool: "get_loan_position",
    })
    expect(tool("What happens to my trove if BTC drops 20%?")).toMatchObject({
      tool: "scenario_liquidation",
    })
    // Off-topic questions stay off-topic.
    expect(routeQuery("What's the weather in Paris?")).toEqual({
      kind: "none",
      help: false,
    })
  })
})

describe("chain questions about groups, not one holder", () => {
  it("leaves groups of holders to the model and reads 'sell or relock' as one phrase", () => {
    for (const query of [
      "what do the largest holders do with their rewards?",
      "what do big lockers do with their incentives?",
      "what do most voters do with their bribes?",
      "where do whales' incentives go?",
      "what does the treasury do with its fees?",
      "where did the fees go?",
    ]) {
      expect(routeQuery(query).kind, query).toBe("none")
    }
    expect(routeQuery("does SNF sell or relock its rewards?")).toMatchObject({
      tool: "trace_rewards",
      input: { subject: "SNF" },
    })
    expect(
      routeQuery("do the top 5 veMEZO holders sell or relock their rewards?"),
    ).toMatchObject({
      tool: "compare_holders",
      input: { asset: "veMEZO", limit: 5, measure: "rewards" },
    })
    // A proper name is still looked up, and answered plainly when unknown.
    expect(
      routeQuery("what does Acme Capital do with its incentives?"),
    ).toMatchObject({
      tool: "trace_rewards",
      input: { subject: "Acme Capital" },
    })
  })

  // Third review of PR #84: misroutes found over 45 phrasings.
  it("follows 'the rewards of X' to X, not to the wallet's claimables", () => {
    const address = "0x9677b632c2520a3e23bcebf2b2288db59facddde"
    for (const query of [
      `where did the rewards of ${address} go?`,
      `where did the incentives from ${address} end up?`,
      `what happened to the rewards of ${address}?`,
    ]) {
      expect(routeQuery(query), query).toMatchObject({
        tool: "trace_rewards",
        input: { subject: address },
      })
    }
  })

  it("leaves groups, plural acronyms and several subjects to the model", () => {
    for (const query of [
      "does anyone relock their rewards?",
      "what do LPs do with their rewards?",
      "what do DAOs do with their incentives?",
      "what do VCs do with their bribes?",
      "what do Supernormal and Acme do with their rewards?",
      "where did the rewards of SNF and 0x9677b632c2520a3e23bcebf2b2288db59facddde go?",
      "what does SNF or Acme do with its fees?",
    ]) {
      expect(routeQuery(query), query).toEqual({ kind: "none", help: false })
    }
    // A name with an acronym in it is still one holder.
    expect(
      routeQuery("what does Acme LPs Fund do with its rewards?"),
    ).toMatchObject({ tool: "trace_rewards" })
  })

  it("compares holders by rewards whenever a reward word is asked about", () => {
    for (const query of [
      "what do the biggest veBTC whales do with fees?",
      "what do the top veMEZO holders do with their bribes?",
      "do the largest veBTC holders keep their earnings?",
    ]) {
      expect(routeQuery(query), query).toMatchObject({
        tool: "compare_holders",
        input: { measure: "rewards" },
      })
    }
    expect(routeQuery("who holds the most veBTC?")).toMatchObject({
      tool: "compare_holders",
      input: { measure: "votes" },
    })
  })

  it("reads dated and relative periods, and leaves unread ones to the model", () => {
    const period = (query: string) => {
      const decision = routeQuery(query, NOW)
      if (decision.kind !== "tool") return decision
      const input = decision.input as { days: number | null; since: string }
      return { days: input.days, since: input.since }
    }
    expect(
      period("what did SNF do with its rewards since 23 April 2026?"),
    ).toEqual({ days: null, since: "2026-04-23" })
    expect(
      period("what did SNF do with its rewards since April 23rd?"),
    ).toEqual({ days: null, since: "23 apr" })
    expect(period("what did SNF do with its rewards since 1 April?")).toEqual({
      days: null,
      since: "1 apr",
    })
    expect(
      period("what did SNF do with its rewards from September 2026?"),
    ).toEqual({ days: null, since: "2026-09-01" })
    expect(period("what did SNF do with its rewards since April?")).toEqual({
      days: null,
      since: "april",
    })
    // A bare "last month" is the calendar month (fourth review): below.
    expect(period("where did SNF's rewards go in the last month?")).toEqual({
      days: 30,
      since: null,
    })
    expect(period("where did SNF's rewards go in the past week?")).toEqual({
      days: 7,
      since: null,
    })
    expect(
      period("where did SNF's rewards go over the last 4 epochs?"),
    ).toEqual({ days: 28, since: null })
    expect(period("what has SNF been doing this month?")).toEqual({
      days: null,
      since: "this month",
    })
    expect(routeQuery("what has SNF been doing this month?")).toMatchObject({
      tool: "address_activity",
      input: { subject: "SNF" },
    })
    // Named but not read: the model dates it, never a silent 90 days.
    for (const query of [
      "what did SNF do with its rewards since last spring?",
      "what did SNF do with its rewards since 31 February?",
      "where did SNF's rewards go in the last 2 years?",
      "what has SNF been doing since 4/23?",
      "what did SNF do with its rewards yesterday?",
    ]) {
      expect(routeQuery(query, NOW), query).toEqual({
        kind: "none",
        help: false,
      })
    }
  })
})

// Fourth review of PR #84 (live Haiku bench and an independent check).
describe("periods with an end, and the remaining router misroutes", () => {
  const input = (query: string) => {
    const decision = routeQuery(query, NOW)
    return decision.kind === "tool"
      ? (decision.input as Record<string, unknown>)
      : decision
  }

  it("reads a month, a range and calendar last month with their end", () => {
    expect(input("what did SNF do with its rewards in March?")).toMatchObject({
      subject: "SNF",
      since: "march",
      until: "march",
    })
    expect(
      input("what did SNF do with its rewards in October 2026?"),
    ).toMatchObject({ since: "2026-10-01", until: "2026-10" })
    expect(input("where did SNF's rewards go during May?")).toMatchObject({
      since: "may",
      until: "may",
    })
    // Calendar, for the router and the model alike (the tool reads it).
    expect(input("where did SNF's rewards go last month?")).toMatchObject({
      days: null,
      since: "last month",
      until: "last month",
    })
    expect(input("what has SNF been doing last week?")).toMatchObject({
      since: "last week",
      until: "last week",
    })
    // "Since last month" runs to today.
    expect(
      input("what did SNF do with its rewards since last month?"),
    ).toMatchObject({ since: "last month", until: "today" })
    expect(
      input("what did SNF do with its rewards from April to June?"),
    ).toMatchObject({ since: "april", until: "june" })
    expect(
      input(
        "what did SNF do with its rewards between 23 April and 5 May 2026?",
      ),
    ).toMatchObject({ since: "23 apr", until: "2026-05-05" })
    expect(
      input("what did SNF do with its rewards from March 2026 to now?"),
    ).toMatchObject({ since: "2026-03-01", until: null })
  })

  // Fifth review: a qualified "last month" is not the calendar month.
  it("reads 'since the start of last year' to today, and leaves mixed spans to the model", () => {
    for (const [query, since] of [
      [
        "what did SNF do with its rewards since the start of last year?",
        "last year",
      ],
      [
        "where did SNF's rewards go since the beginning of last month",
        "last month",
      ],
      [
        "what did SNF do with its rewards from the start of last week?",
        "last week",
      ],
      [
        "what did SNF do with its rewards from last month to now?",
        "last month",
      ],
    ] as const) {
      expect(input(query), query).toMatchObject({ since, until: "today" })
    }
    for (const query of [
      "what did SNF do with the rewards it got last month and this month",
      "what did SNF do with its rewards from last month",
      "what did SNF do with its rewards at the end of last month?",
      "what did SNF do with its rewards last month to the 5th?",
      // A second period or end beside "last X" (fifth check 6e44d2f..eb8743d).
      "where did SNF's rewards go since the start of last year until June?",
      "where did SNF's rewards go from the beginning of last year to the end of last month?",
      "where did SNF's rewards go last month vs this month?",
      "where did SNF's rewards go between last month and today?",
      "what did SNF do with its rewards last month compared with september?",
    ]) {
      expect(routeQuery(query, NOW), query).toEqual({
        kind: "none",
        help: false,
      })
    }
    // Unqualified, still the calendar month; "the last month" still rolling.
    expect(input("what did SNF do with rewards last month")).toMatchObject({
      since: "last month",
      until: "last month",
    })
    expect(
      input("what did SNF do with its rewards over the last month?"),
    ).toMatchObject({
      days: 30,
      since: null,
    })
  })

  it("reads an ordinal after a month as a day, and a month naming the rewards", () => {
    expect(routeQuery("what has SNF been doing in May 5th", NOW)).toEqual({
      kind: "none",
      help: false,
    })
    expect(routeQuery("what has SNF been doing in May 5", NOW)).toEqual({
      kind: "none",
      help: false,
    })
    expect(input("where did SNF's October rewards go")).toMatchObject({
      subject: "SNF",
      since: "october",
      until: "october",
    })
    expect(input("where did SNF's March 2026 fees go?")).toMatchObject({
      since: "2026-03-01",
      until: "2026-03",
    })
    // A month after "since" or "after" starts a period to now, even with a
    // reward word after it.
    for (const query of [
      "what did SNF do with its rewards since October in fees?",
      "where did SNF's rewards go after the October fees?",
    ]) {
      expect(input(query), query).toMatchObject({
        subject: "SNF",
        since: "october",
        until: null,
      })
    }
    // "From" before a date is not a holder.
    expect(routeQuery("SNF activity from April to June", NOW)).toEqual({
      kind: "none",
      help: false,
    })
    expect(input("show the activity of SNF since March")).toMatchObject({
      subject: "SNF",
      since: "march",
    })
    expect(
      input("transfers from 0x4da9e77114ee66d64ca9457da1fca94d4b06fb99"),
    ).toMatchObject({ subject: "0x4da9e77114ee66d64ca9457da1fca94d4b06fb99" })
    // A name that starts like a month is still a holder after "from".
    expect(input("transfers from Marathon Capital")).toMatchObject({
      subject: "Marathon Capital",
    })
    expect(input("transfers from Decentral Fund since March")).toMatchObject({
      subject: "Decentral Fund",
      since: "march",
    })
  })

  it("trims a date of any length from the subject", () => {
    for (const [query, subject] of [
      ["where did the rewards of SNF from 23 April go?", "SNF"],
      ["where did the rewards of SNF from January go?", "SNF"],
      [
        "where did the rewards of Acme Capital since 2026-04-23 go?",
        "Acme Capital",
      ],
      ["where did the rewards of SNF in September go?", "SNF"],
      ["where did the rewards of SNF from the 3rd of May go?", "SNF"],
    ] as const) {
      expect(input(query), query).toMatchObject({ subject })
    }
  })

  it("leaves future, unreal and unread dates to the model", () => {
    for (const query of [
      "what did SNF do with its rewards since 2027-01-01?",
      "what did SNF do with its rewards since December 2026?",
      "what did SNF do with its rewards since 2026-02-30?",
      "what did SNF do with its rewards after the 5th?",
      "what did SNF do with its rewards from June to March?",
      "what did SNF do with its rewards until March?",
    ]) {
      expect(routeQuery(query, NOW), query).toEqual({
        kind: "none",
        help: false,
      })
    }
    // A date a day ahead of UTC is this year's: east of UTC it is today.
    expect(
      input("what did SNF do with its rewards since 14 November?"),
    ).toMatchObject({ since: "14 nov" })
  })

  it("leaves groups to the model and follows a holder's own rewards", () => {
    for (const query of [
      "what do the DAOs on Mezo do with their rewards?",
      "what do Mezo validators do with their rewards?",
      "where did the rewards of the SNF voters go?",
    ]) {
      expect(routeQuery(query, NOW), query).toEqual({
        kind: "none",
        help: false,
      })
    }
    expect(routeQuery("what happened to SNF's rewards?", NOW)).toMatchObject({
      tool: "trace_rewards",
      input: { subject: "SNF" },
    })
    expect(routeQuery("what happened to SNF incentives", NOW)).toMatchObject({
      tool: "explain_gauge",
    })
    // Still one holder: a lock number with group words around it.
    expect(
      routeQuery("where did the rewards of the owner of #6033 go?", NOW),
    ).toMatchObject({ tool: "trace_rewards" })
  })
})
