import { stuartRequestSchema } from "@matchbox/stuart-ui/contract"
import { describe, expect, it } from "vitest"
import { POOL, SNF_RESOLVABLE, SNF_SCRIPT, VALIDATOR } from "../../bench/cases"
import {
  BENCH_NOW,
  BENCH_WALLET,
  benchDomain,
  benchProviders,
} from "../../bench/world"
import {
  type DirectoryEntry,
  entryLabel,
  parseBallotScript,
  type Resolution,
  resolveGaugeName,
} from "./ballotScript"
import { runStuart } from "./orchestrator"
import { IdScope } from "./outcome"
import {
  directoryEntries,
  prepareVoteScriptTool,
  prepareVoteTool,
} from "./tools/voteScript"

// The live gauge directory (bench/fixtures/gauges.mainnet.json, captured
// from Matchscan and Mezo RPC) is the fixture: every expected address below
// is a real mainnet pool or gauge.

const ENTRIES: DirectoryEntry[] = directoryEntries([
  benchDomain("pools"),
  benchDomain("validators"),
  benchDomain("boost"),
])

function target(resolution: Resolution): string {
  return resolution.kind === "match"
    ? resolution.entry.target
    : `${resolution.kind}:${resolution.kind === "none" ? resolution.reason : resolution.options.map(entryLabel).join("|")}`
}

function resolve(text: string): string {
  return target(resolveGaugeName(text, ENTRIES))
}

describe("parseBallotScript", () => {
  it("reads the SNF post line by line", () => {
    const script = parseBallotScript(SNF_SCRIPT)
    expect(script.lines.map((line) => [line.percent, line.target])).toEqual([
      ["25", "the BTC/MUSD-200 pool"],
      ["20", "the MUSD Savings Vault"],
      ["20", "the MUSD/USDC-10 pool"],
      ["10", "the BTC/MUSD pool"],
      ["10", "the USDC/BTC-200 pool"],
      ["5", "the new USDC Lending Vault"],
      ["5", "the MEZO/MUSD-200 pool"],
      ["5", "the BTC/MEZO-2000 pool"],
    ])
    expect(script.lines.reduce((sum, line) => sum + (line.bps ?? 0), 0)).toBe(
      10_000,
    )
    expect(script.asset).toBe("veBTC")
    expect(script.keepMezoGauges).toBe(true)
  })

  it("reads the same post with its newlines dropped or as a list", () => {
    const expected = parseBallotScript(SNF_SCRIPT).lines.map(
      (line) => line.target,
    )
    const flattened = SNF_SCRIPT.split("\n").join("")
    expect(parseBallotScript(flattened).lines.map((l) => l.target)).toEqual(
      expected,
    )
    // "; " typed, " | " from Stuart's inputs (stuart-ui paste.ts).
    for (const separator of ["; ", " | "]) {
      const listed = SNF_SCRIPT.split("\n").join(separator)
      expect(parseBallotScript(listed).lines.map((l) => l.target)).toEqual(
        expected,
      )
    }
  })

  it("handles short ballots, decimals and the lock named at the end", () => {
    expect(
      parseBallotScript("vote 60% BTC/MUSD CL200, 39.5% sMUSD and 0.5% Boar")
        .lines,
    ).toMatchObject([
      { target: "BTC/MUSD CL200", bps: 6_000 },
      { target: "sMUSD", bps: 3_950 },
      { target: "Boar", bps: 50 },
    ])
    const vemezo = parseBallotScript("vote 100% to sMUSD with my veMEZO")
    expect(vemezo.lines[0]?.target).toBe("sMUSD")
    expect(vemezo.asset).toBe("veMEZO")
    expect(parseBallotScript("vote 150% to sMUSD").lines[0]?.bps).toBeNull()
  })
})

describe("resolveGaugeName over the live directory", () => {
  it("resolves every SNF line to the real pool", () => {
    expect(resolve("the BTC/MUSD-200 pool")).toBe(POOL.btcMusdCl200)
    expect(resolve("the MUSD Savings Vault")).toBe(POOL.smusd)
    expect(resolve("the MUSD/USDC-10 pool")).toBe(POOL.musdcMusdCl10)
    // No pool type while BTC/MUSD has a basic and two concentrated pools:
    // asked, with the basic pool first.
    expect(resolve("the BTC/MUSD pool")).toBe(
      "ambiguous:BTC/MUSD Volatile|BTC/MUSD CL200|BTC/MUSD CL2000",
    )
    expect(resolve("the USDC/BTC-200 pool")).toBe(POOL.musdcBtcCl200)
    expect(resolve("the MEZO/MUSD-200 pool")).toBe(POOL.mezoMusdCl200)
    expect(resolve("the BTC/MEZO-2000 pool")).toBe(POOL.btcMezoCl2000)
  })

  it("never invents the USDC Lending Vault", () => {
    const resolution = resolveGaugeName("the new USDC Lending Vault", ENTRIES)
    expect(resolution.kind).toBe("none")
    // A similar vault is offered, never chosen.
    expect(
      resolution.kind === "none" && resolution.options.map(entryLabel),
    ).toEqual(["mlvBTC-mUSDC"])
  })

  it("accepts the awkward spellings", () => {
    for (const text of [
      "BTC/MUSD CL200",
      "btc/musd cl200",
      "BTC/MUSD-CL200",
      "BTC/MUSD (CL200)",
      "MUSD/BTC-200",
      "BTC / MUSD 200 pool",
      "BTC/MUSD cl 200",
    ]) {
      expect(resolve(text), text).toBe(POOL.btcMusdCl200)
    }
    expect(resolve("mSolvBTC/MUSD")).toBe(POOL.msolvbtcMusdVolatile)
    expect(resolve("SolvBTC/MUSD pool")).toBe(POOL.msolvbtcMusdVolatile)
    expect(resolve("USDC/MUSD stable")).toBe(POOL.musdcMusdStable)
    expect(resolve("sMUSD")).toBe(POOL.smusd)
    expect(resolve("MUSD savings")).toBe(POOL.smusd)
    expect(resolve("BTC/MUSD volatile")).toBe(POOL.btcMusdVolatile)
    expect(resolve("Boar")).toBe(VALIDATOR.boar)
    expect(resolve(POOL.smusd)).toBe(POOL.smusd)
  })

  it("drops the m only from bridged tokens", () => {
    expect(resolve("USDC/BTC-200")).toBe(POOL.musdcBtcCl200)
    // "USD" is not MUSD.
    expect(resolve("USD/BTC-200")).toBe("none:no live USD/BTC CL200 gauge")
    expect(resolve("T/MUSD volatile")).toBe(
      "none:no live T/MUSD Volatile gauge",
    )
  })

  it("never turns part of a name into a gauge", () => {
    // Whole words of longer names are offered, never matched.
    expect(resolve("Club")).toBe("none:no live gauge by that name")
    expect(resolve("Simply")).toBe("none:no live gauge by that name")
    const club = resolveGaugeName("Club", ENTRIES)
    expect(club.kind === "none" && club.options.map(entryLabel)).toEqual([
      "Millennium Club (MCLB)",
    ])
  })

  it("asks instead of guessing", () => {
    expect(resolve("USDC/MUSD")).toBe(
      "ambiguous:mUSDC/MUSD Stable|mUSDC/MUSD CL10|mUSDC/MUSD CL1",
    )
    expect(resolve("mUSDC/MUSD cl")).toBe(
      "ambiguous:mUSDC/MUSD CL10|mUSDC/MUSD CL1",
    )
    expect(resolve("BTC/MUSD-300")).toBe("none:no live BTC/MUSD CL300 gauge")
    expect(resolve("Stackbridge")).toBe("none:no live gauge by that name")
    // ChooseMe is a validator and a veBTC gauge: the tool settles it by the
    // domain the request names.
    expect(resolve("ChooseMe")).toMatch(/^ambiguous:/)
  })
})

describe("the SNF post end to end", () => {
  async function ask(
    query: string,
    clarification?: { cardId: "entity-disambiguation"; optionId: string },
  ) {
    const logs: Array<Record<string, unknown>> = []
    const run = await runStuart(
      stuartRequestSchema.parse({
        version: 1,
        query,
        sessionId: "6f1c1b8e-3c55-4a3f-9b8a-1d2e3f4a5b6c",
        turn: 0,
        surface: "rail",
        chainId: 31_612,
        wallet: { address: BENCH_WALLET, mode: "connected" },
        ...(clarification ? { context: { clarification } } : {}),
      }),
      {
        providers: benchProviders(),
        secret: "test-secret-test-secret-test-secret-00",
        now: () => BENCH_NOW,
        claude: null,
        log: (event) => logs.push(event),
      },
    )
    if (run.kind !== "answer") throw new Error("busy")
    expect(
      logs.filter(
        (event) =>
          event.message === "stuart.unsourced_answer" ||
          event.message === "stuart.schema_violation",
      ),
    ).toEqual([])
    return run.response
  }

  function cardOf(response: Awaited<ReturnType<typeof ask>>) {
    const card = response.uiBlocks.find(
      (block) => block.type === "clarification_card",
    )
    if (card?.type !== "clarification_card") throw new Error("no card")
    return card
  }

  async function pick(
    response: Awaited<ReturnType<typeof ask>>,
    label: string,
  ) {
    const card = cardOf(response)
    const option = card.options.find((each) => each.label === label)
    if (!option) throw new Error(`no option ${label}`)
    // What Pro sends: the card's query, with the option as the pick.
    return ask(card.query ?? "", {
      cardId: "entity-disambiguation",
      optionId: option.id,
    })
  }

  it("asks which BTC/MUSD pool, then about the lending vault", async () => {
    const response = await ask(SNF_SCRIPT)
    expect(response.proposedActions).toEqual([])
    expect(response.answer.text).toBe(
      "6 of 8 lines resolved (85%). 10% to the BTC/MUSD pool: matches BTC/MUSD Volatile, BTC/MUSD CL200 and BTC/MUSD CL2000, pick one. No ballot until it resolves.",
    )
    const card = cardOf(response)
    expect(card.prompt).toBe("Which gauge for the BTC/MUSD pool?")
    expect(card.options.map((option) => [option.label, option.detail])).toEqual(
      [
        ["BTC/MUSD Volatile", `Basic volatile pool, ${POOL.btcMusdVolatile}`],
        [
          "BTC/MUSD CL200",
          `Concentrated pool, tick spacing 200, ${POOL.btcMusdCl200}`,
        ],
        [
          "BTC/MUSD CL2000",
          "Concentrated pool, tick spacing 2000, 0x76fd06b064063ade870e5f005277e17acb42d292",
        ],
      ],
    )
    const why = response.why?.items.map((item) => item.text) ?? []
    expect(why).toContain(
      "5% to the new USDC Lending Vault: not in the live gauge directory. Similar: mlvBTC-mUSDC.",
    )
    expect(why).toContain(
      "MEZO gauges: votes persist across epochs, so the veMEZO votes from last epoch stay. No MEZO gauge ballot prepared.",
    )

    // Picking the Volatile pool leaves only the vault, which never resolves.
    const picked = await pick(response, "BTC/MUSD Volatile")
    expect(picked.proposedActions).toEqual([])
    expect(picked.answer.text).toBe(
      "7 of 8 lines resolved (95%). 5% to the new USDC Lending Vault: not in the live gauge directory. Similar: mlvBTC-mUSDC. No ballot until it resolves.",
    )
    expect(picked.why?.items[0]?.text).toBe(
      "Resolved: 25% BTC/MUSD CL200, 20% sMUSD, 20% mUSDC/MUSD CL10, 10% BTC/MUSD Volatile, 10% mUSDC/BTC CL200, 5% MEZO/MUSD CL200, 5% BTC/MEZO CL2000",
    )
  })

  it("prepares the unsigned veBTC ballot once every line resolves", async () => {
    const response = await pick(await ask(SNF_RESOLVABLE), "BTC/MUSD Volatile")
    expect(response.intent).toBe("custom_vote")
    const proposal = response.proposedActions[0]
    expect(proposal?.kind).toBe("vote")
    expect(proposal?.canSign).toBe(true)
    if (proposal?.content.kind !== "vote") throw new Error("not a vote")
    const [ballot] = proposal.content.ballots
    expect(ballot).toMatchObject({
      branch: "pools",
      governanceAsset: "veBTC",
      tokenId: "6100",
      votingContract: "0x48233cCC97B87Ba93bCA212cbEe48e3210211f03",
    })
    expect(
      Object.fromEntries(
        ballot?.allocations.map((allocation) => [
          allocation.targetAddress.toLowerCase(),
          [allocation.name, allocation.bps],
        ]) ?? [],
      ),
    ).toEqual({
      [POOL.btcMusdCl200]: ["BTC/MUSD CL200", 2_500],
      [POOL.smusd]: ["sMUSD", 2_000],
      [POOL.musdcMusdCl10]: ["mUSDC/MUSD CL10", 2_000],
      [POOL.btcMusdVolatile]: ["BTC/MUSD Volatile", 1_000],
      [POOL.musdcBtcCl200]: ["mUSDC/BTC CL200", 1_000],
      [POOL.mezoMusdCl200]: ["MEZO/MUSD CL200", 500],
      [POOL.btcMezoCl2000]: ["BTC/MEZO CL2000", 500],
      [POOL.msolvbtcMusdVolatile]: ["mSolvBTC/MUSD Volatile", 500],
    })
    // Pro opens the review step from the composer block, nothing signed.
    expect(
      response.uiBlocks.some((block) => block.type === "vote_composer"),
    ).toBe(true)
    expect(response.presentation.openCanvas).toBe(true)
  })

  it("settles a shared name by the domain the request names", async () => {
    const response = await ask(
      "vote 50% to Boar and 50% to ChooseMe validators",
    )
    const proposal = response.proposedActions[0]
    if (proposal?.content.kind !== "vote") throw new Error("not a vote")
    expect(
      proposal.content.ballots[0]?.allocations
        .map((allocation) => allocation.targetAddress.toLowerCase())
        .sort(),
    ).toEqual([VALIDATOR.boar, VALIDATOR.chooseMe].sort())
  })

  it("keeps the first pick when the second card is answered", async () => {
    const query = "vote 50% to mUSDC/MUSD cl, 50% to BTC/MUSD-300"
    const first = await ask(query)
    expect(cardOf(first).options.map((option) => option.label)).toEqual([
      "mUSDC/MUSD CL10",
      "mUSDC/MUSD CL1",
    ])
    const second = await pick(first, "mUSDC/MUSD CL10")
    expect(second.proposedActions).toEqual([])
    // The second card is for the second line and carries the first pick.
    expect(cardOf(second).prompt).toBe("Which gauge for BTC/MUSD-300?")
    expect(cardOf(second).query).toBe(
      // Carried picks keep the gauge's first eight hex digits.
      `${query} | picks: 0=${POOL.musdcMusdCl10.slice(0, 10)}`,
    )
    const third = await pick(second, "BTC/MUSD CL200")
    const proposal = third.proposedActions[0]
    if (proposal?.content.kind !== "vote") throw new Error("not a vote")
    expect(
      Object.fromEntries(
        proposal.content.ballots[0]?.allocations.map((allocation) => [
          allocation.targetAddress.toLowerCase(),
          allocation.bps,
        ]) ?? [],
      ),
    ).toEqual({ [POOL.musdcMusdCl10]: 5_000, [POOL.btcMusdCl200]: 5_000 })
  })

  it("never votes for part of a name, whatever the domain", async () => {
    for (const query of [
      "vote 50% to Boar, 50% to Club",
      "vote 30% to Simply, 70% to Boar validators",
    ]) {
      const response = await ask(query)
      expect(response.proposedActions, query).toEqual([])
    }
  })

  it("never cuts picks off a long post: it says the post is too long", async () => {
    // 1,993 characters: a card plus two picks would not fit in 2,000.
    const query = `vote 50% to mUSDC/MUSD cl, 50% to BTC/MUSD-300. ${"x".repeat(1_945)}`
    expect(query.length).toBe(1_993)
    const response = await ask(query)
    expect(
      response.uiBlocks.some((block) => block.type === "clarification_card"),
    ).toBe(false)
    expect(response.proposedActions).toEqual([])
    expect(response.answer.text).toMatch(
      /The post is too long to pick gauges here\. Shorten it, or name each gauge exactly/,
    )
  })

  it("keeps both picks on a post just short enough for them", async () => {
    const query = `vote 50% to mUSDC/MUSD cl, 50% to BTC/MUSD-300. ${"x".repeat(1_880)}`
    const first = await ask(query)
    const second = await pick(first, "mUSDC/MUSD CL10")
    expect(cardOf(second).query?.length).toBeLessThanOrEqual(2_000)
    const third = await pick(second, "BTC/MUSD CL200")
    expect(third.proposedActions).toHaveLength(1)
  })

  it("takes picks only for lines that had a card, from what it showed", async () => {
    const club = resolveGaugeName("Club", ENTRIES)
    if (club.kind !== "none") throw new Error("Club resolved")
    const millennium = club.options[0]?.target ?? ""
    // One suggestion, so no card: a typed pick cannot settle it.
    for (const response of [
      await ask(`vote 50% to Boar, 50% to Club | picks: 1=${millennium}`),
      await ask("vote 50% to Boar, 50% to Club", {
        cardId: "entity-disambiguation",
        optionId: `1=${millennium}`,
      }),
    ]) {
      expect(response.proposedActions).toEqual([])
    }
    // A gauge the card did not show cannot be picked either.
    const response = await ask(
      `vote 100% to mUSDC/MUSD cl | picks: 0=${POOL.smusd}`,
    )
    expect(response.proposedActions).toEqual([])
  })

  it("reads picks from the user's request on the model path", async () => {
    const context = (query: string) => ({
      providers: benchProviders(),
      wallet: {
        address: BENCH_WALLET,
        mode: "connected" as const,
        label: "Connected wallet",
      },
      query,
      choice: null,
      now: () => BENCH_NOW,
      secret: "test-secret-test-secret-test-secret-00",
      scope: new IdScope("c1"),
    })
    const post = "vote 50% to mUSDC/MUSD cl, 50% to sMUSD"
    const picked = `${post} | picks: 0=${POOL.musdcMusdCl10.slice(0, 10)}`
    // The model lists the lines in another order: the pick still lands on
    // the post's first line.
    const listed = await prepareVoteTool.execute(context(picked), {
      branch: null,
      allocations: [
        { target: "sMUSD", percent: "50" },
        { target: "mUSDC/MUSD cl", percent: "50" },
      ],
    })
    if ("invalid" in listed) throw new Error(listed.invalid)
    const vote = listed.proposals[0]?.content
    if (vote?.kind !== "vote") throw new Error("no ballot")
    expect(
      vote.ballots[0]?.allocations
        .map((allocation) => allocation.targetAddress.toLowerCase())
        .sort(),
    ).toEqual([POOL.musdcMusdCl10, POOL.smusd].sort())
    // A pick the model writes into its copy of the script is ignored.
    const forged = await prepareVoteScriptTool.execute(context(post), {
      script: picked,
    })
    if ("invalid" in forged) throw new Error(forged.invalid)
    expect(forged.proposals).toEqual([])
  })

  it("names a single suggestion and says the line blocks the ballot", async () => {
    const response = await ask("vote 50% to Upwelling")
    expect(response.answer.text).toBe(
      "0 of 1 lines resolved (0%). 50% to Upwelling: no live gauge by that name. Similar: The Upwelling Group. No ballot until it resolves.",
    )
  })

  it("refuses a veMEZO ballot on pools", async () => {
    const response = await ask("vote 100% to sMUSD with my veMEZO")
    expect(response.proposedActions).toEqual([])
    expect(response.answer.text).toMatch(/veBTC votes/)
  })
})
