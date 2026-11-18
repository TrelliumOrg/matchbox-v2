import {
  stuartRequestSchema,
  stuartResponseSchema,
} from "@matchbox/stuart-ui/contract"
import type { Address } from "viem"
import { describe, expect, it } from "vitest"
import type { StuartProviders } from "./context"
import { fakeDomain, fakeProviders, fakeTarget, NOW, WALLET } from "./fakes"
import { byAmountDesc, type FlowBucket, type TokenFlow } from "./flows"
import { outcomeDraft, runStuartQuery } from "./orchestrator"
import { IdScope } from "./outcome"
import type {
  AddressLabel,
  ChainActivitySource,
  ChainTransfer,
  OwnedLock,
} from "./providers/chainActivity"
import { routeQuery } from "./router"
import { subjectCandidates } from "./subjects"
import {
  heldShare,
  joinPlaces,
  liquidPlaces,
  liquidSentence,
  traceRewardsTool,
} from "./tools/chain"
import {
  buildLens,
  ownerAtFrom,
  periodOf,
  periodSpanText,
  periodWord,
  sinceSeconds,
} from "./tools/chainCommon"

const E18 = 10n ** 18n
const DAY = 86_400
const NOW_S = Math.floor(NOW.getTime() / 1000)

// The SNF voting Safe is a curated address; the Enclave owns veBTC #6033,
// the boost gauge named "SNF". A same-signer Safe receives stablecoins.
const SAFE: Address = "0xf36593cd2e5eb2cc8ccbe5ad3b5bb2353cf98bc4"
const ENCLAVE: Address = "0x147379a0174780570d07d70a14fb244ee5f2d786"
const OPS_SAFE: Address = "0xc62b9391cc427dd8dc919365c80282a601623ffc"
const FEES: Address = "0x0453820c89084e20658068a27ebb90824f1a6c6d"
const WHALE: Address = "0x4da9e77114ee66d64ca9457da1fca94d4b06fb99"
const VEBTC: Address = "0x3d4b1b884a7a1e59fe8589a3296ec8f8cbb6f279"
const MUSD: Address = "0xdd468a1ddc392dcdbef6db6e34e89aa338f9f186"
const BTC: Address = "0x7b7c000000000000000000000000000000000000"
const SIGNERS: Address[] = [
  "0x718bef4a71d9f64a034d8060c014f8015f7d4799",
  "0x9be76d5ab050aa8c77f6ad25f25f633b2cb8ed85",
]

let sequence = 0
function transfer(
  from: Address,
  to: Address,
  token: Address,
  amount: bigint,
  daysAgo: number,
  toName: string | null = null,
): ChainTransfer {
  sequence += 1
  return {
    tx: `0x${sequence.toString(16).padStart(64, "0")}`,
    block: 13_000_000 + sequence,
    logIndex: 1,
    at: NOW_S - daysAgo * DAY,
    from,
    to,
    token,
    symbol:
      token === MUSD
        ? "MUSD"
        : token === "0x7b7c000000000000000000000000000000000001"
          ? "MEZO"
          : "BTC",
    decimals: 18,
    amount,
    fromName: null,
    toName,
    fromContract: from === FEES,
    toContract: toName !== null,
  }
}

const TRANSFERS: ChainTransfer[] = [
  transfer(FEES, ENCLAVE, MUSD, 100n * E18, 20),
  transfer(FEES, ENCLAVE, BTC, E18 / 100n, 20),
  transfer(ENCLAVE, SAFE, MUSD, 100n * E18, 18, "GnosisSafeL2"),
  transfer(ENCLAVE, SAFE, BTC, E18 / 100n, 18, "GnosisSafeL2"),
  transfer(SAFE, OPS_SAFE, MUSD, 60n * E18, 15, "GnosisSafeL2"),
  transfer(SAFE, VEBTC, BTC, E18 / 100n, 15, "VotingEscrow"),
]

const FEE_LABEL: AddressLabel = {
  address: FEES,
  name: "Fees vAMM BTC/MUSD",
  kind: "feeVotingReward",
  tags: ["rewards"],
  source: "contracts",
}

function lock(
  asset: "veBTC" | "veMEZO",
  tokenId: string,
  owner: Address,
  amount: bigint,
): OwnedLock {
  return { asset, tokenId, owner, amount, isPermanent: true, unlockAt: null }
}

const LOCKS = [
  lock("veMEZO", "1172", SAFE, 9_988_214n * E18),
  lock("veBTC", "6033", ENCLAVE, 250n * E18),
  lock("veBTC", "6114", WHALE, 500n * E18),
]

const chain: ChainActivitySource = {
  nftMoves: async () => ({ moves: [], complete: true }),
  distributorClaims: async (asset, tokenId) => ({
    asset,
    tokenId,
    claims: [],
    complete: true,
  }),
  // The Safe's BTC deposit tops up the Enclave's veBTC #6033.
  txLockEvents: async (tx) => {
    const deposit = TRANSFERS.find(
      (each) => each.tx === tx && each.to === VEBTC,
    )
    return deposit
      ? [
          {
            asset: "veBTC",
            event: {
              kind: "deposit",
              tx,
              block: deposit.block,
              logIndex: 9,
              at: deposit.at,
              tokenId: "6033",
              provider: deposit.from,
              value: deposit.amount,
            },
          },
        ]
      : []
  },
  safeNative: async () => ({
    transfers: [],
    complete: true,
    oldest: null,
    pages: 1,
  }),
  balances: async () => new Map(),
  lockOwners: async () => new Map(),
  transfers: async (address, since) => ({
    transfers: TRANSFERS.filter(
      (each) =>
        (each.from === address || each.to === address) && each.at >= since,
    ),
    complete: true,
    oldest: null,
    pages: 1,
  }),
  labels: async (addresses) =>
    new Map(
      addresses.flatMap((address) =>
        address === FEES ? [[FEES as string, FEE_LABEL] as const] : [],
      ),
    ),
  labelSearch: async () => [],
  ownerLocks: async (owner) => LOCKS.filter((each) => each.owner === owner),
  ownerVotes: async (owner) =>
    owner === ENCLAVE
      ? [
          {
            asset: "veBTC",
            tokenId: "6033",
            epochStart: NOW_S - 2 * DAY,
            gauge: "0x9cbc1537d255768b431488305b1c7efc2ac95022",
            gaugeName: "BTC/MUSD CL200",
            weight: 100n * E18,
            source: "POOLS_VOTER",
          },
        ]
      : [],
  topLocks: async (asset) =>
    asset === "veBTC"
      ? LOCKS.filter((each) => each.asset === "veBTC").sort((a, b) =>
          byAmountDesc(a.amount, b.amount),
        )
      : null,
  safeOwners: async (addresses) =>
    new Map(
      addresses
        .filter((address) => address === SAFE || address === OPS_SAFE)
        .map((address) => [address as string, SIGNERS]),
    ),
  rewardPayers: async () => new Map(),
}

const providers: Partial<StuartProviders> = {
  chain,
  votingDomain: async () =>
    fakeDomain([
      {
        ...fakeTarget({ index: 7, name: "SNF", weight: E18, mezo: E18 }),
        tokenId: "6033",
      },
    ]),
  lockStates: async (asset, tokenIds) => {
    const base = await fakeProviders().lockStates(asset, tokenIds)
    return {
      ...base,
      locks: base.locks.map((state) => ({
        ...state,
        owner:
          LOCKS.find(
            (each) =>
              each.asset === asset && each.tokenId === state.tokenId.toString(),
          )?.owner ?? state.owner,
      })),
    }
  },
}

async function ask(
  query: string,
  withWallet = false,
  overrides: Partial<ChainActivitySource> = {},
) {
  const logs: Array<Record<string, unknown>> = []
  const response = await runStuartQuery(
    stuartRequestSchema.parse({
      version: 1,
      query,
      sessionId: "6f1c1b8e-3c55-4a3f-9b8a-1d2e3f4a5b6c",
      turn: 0,
      surface: "rail",
      chainId: 31_612,
      ...(withWallet ? { wallet: { address: WALLET, mode: "connected" } } : {}),
    }),
    {
      providers: fakeProviders({
        ...providers,
        chain: { ...chain, ...overrides },
      }),
      secret: "test-secret",
      now: () => NOW,
      claude: null,
      log: (event) => logs.push(event),
    },
  )
  // No unsourced numbers or addresses, and a valid wire response.
  expect(logs.filter((event) => event.message !== "stuart.query")).toEqual([])
  expect(stuartResponseSchema.safeParse(response).success).toBe(true)
  const shown = [
    response.answer.text,
    ...(response.why?.items ?? []).map((item) => item.text),
  ].join("\n")
  return { response, shown }
}

/** A tool context over these chain reads. */
function toolContext(source: ChainActivitySource) {
  return {
    providers: fakeProviders({ ...providers, chain: source }),
    wallet: {
      address: WALLET,
      mode: "connected" as const,
      label: "Connected wallet",
    },
    query: "test",
    choice: null,
    now: () => NOW,
    secret: "test-secret-test-secret-test-secret-00",
    scope: new IdScope("c1"),
  }
}

const SNF_QUESTION =
  "what does the Supernormal Foundation (SNF) (the wallet that owns the veBTC NFT labelled SNF) do with the incentives received from their NFTs?"

describe("chain activity tools", () => {
  it("resolves SNF to its voting Safe and the owner of veBTC #6033", async () => {
    const { response, shown } = await ask("who is SNF?")
    expect(response.intent).toBe("chain_activity")
    expect(shown).toContain("0xf365…8bc4 (voting Safe)")
    expect(shown).toContain("0x1473…d786 (owner of veBTC #6033)")
    expect(shown).toContain("a Safe with 2 signers")
    expect(response.evidence.map((each) => each.url)).toContain(
      `https://scan.matchbox.markets/address/${ENCLAVE}`,
    )
  })

  it("answers who owns a lock from ownerOf, not from who votes with it", async () => {
    const { response } = await ask("who owns veBTC #6033")
    expect(response.answer.text).toContain("0x1473…d786")
    expect(response.answer.text).not.toContain("0xf365…8bc4")
  })

  it("follows SNF's claimed rewards to where they went, with the method", async () => {
    const { response, shown } = await ask(SNF_QUESTION)
    expect(response.intent).toBe("chain_activity")
    expect(response.answer.text).toContain("0xf365…8bc4 and 0x1473…d786")
    expect(shown).toContain(
      "100.00 MUSD claimed in 1 claim: 60.00 MUSD sent to 0xc62b…3ffc (Safe, same signers), 40.00 not moved yet.",
    )
    expect(shown).toContain(
      "0.0100 BTC claimed in 1 claim: 0.0100 BTC locked into veBTC #6033.",
    )
    expect(shown).toMatch(
      /Method: each claim is followed to the end of the period, also through own addresses. An outflow spends the oldest/,
    )
    expect(response.evidence.some((each) => each.url?.includes("/tx/0x"))).toBe(
      true,
    )
    expect(response.proposedActions).toEqual([])
  })

  it("says plainly when nothing carries a label", async () => {
    const { response } = await ask(
      "what does Acme Capital do with its incentives?",
    )
    expect(response.answer.text).toBe(
      'Nothing on Mezo is labelled "Acme Capital". Checked Matchbox\'s named entities, Matchscan labels and boost gauge names.',
    )
    expect(response.answer.kind).toBe("empty")
  })

  it("summarizes an entity's activity by counterparty and its votes", async () => {
    const { shown } = await ask("what has SNF been doing?")
    expect(shown).toMatch(
      /made 6 token transfers with 3 counterparties: 2 reward claims, 1 lock deposit/,
    )
    expect(shown).toContain("0xc62b…3ffc (Safe, same signers): 0 in, 1 out.")
    expect(shown).toContain("most on BTC/MUSD CL200")
  })

  it("ranks the largest veBTC holders with their votes and gauge names", async () => {
    const { response, shown } = await ask(
      "who are the largest veBTC holders and what do they vote for?",
    )
    expect(response.answer.text).toContain(
      "0x4da9…fb99: 500.0000 BTC in 1 lock",
    )
    expect(shown).toContain(
      "0x1473…d786 (SNF): 250.0000 BTC in 1 lock, voted 1 gauge, most on BTC/MUSD CL200.",
    )
  })

  it("classifies what holders do with claims when asked about selling", async () => {
    const { shown } = await ask(
      "which veBTC voters claim and sell incentives vs re-lock?",
    )
    expect(shown).toMatch(/0x1473…d786 \(SNF\).*Claims: \d+ sent/)
  })

  it("uses the selected wallet for first person questions", async () => {
    const { response } = await ask("where did my rewards go?", true)
    expect(response.answer.text).toMatch(/claimed no rewards since/)
  })
})

describe("routing chain questions", () => {
  it("sends the owner's question to trace_rewards with the subject as written", () => {
    expect(routeQuery(SNF_QUESTION)).toEqual({
      kind: "tool",
      intent: "chain_activity",
      tool: "trace_rewards",
      input: {
        subject:
          "the Supernormal Foundation (SNF) (the wallet that owns the veBTC NFT labelled SNF)",
        days: null,
        since: null,
        until: null,
        windowDays: null,
      },
    })
  })

  it("reads periods and the other question shapes", () => {
    expect(
      routeQuery("what has 0xabc been doing in the last 30 days"),
    ).toMatchObject({
      tool: "address_activity",
      input: { subject: "0xabc", days: 30, since: null },
    })
    expect(routeQuery("where did SNF's rewards go since March")).toMatchObject({
      tool: "trace_rewards",
      input: { subject: "SNF", since: "march" },
    })
    expect(routeQuery("who owns veBTC #6033")).toMatchObject({
      tool: "resolve_holder",
      input: { subject: "veBTC #6033" },
    })
    expect(routeQuery("top 3 vemezo holders")).toMatchObject({
      tool: "compare_holders",
      input: { asset: "veMEZO", limit: 3, measure: "votes" },
    })
    expect(routeQuery("does SNF sell its incentives?")).toMatchObject({
      tool: "trace_rewards",
      input: { subject: "SNF" },
    })
    expect(routeQuery("where did my rewards go")).toMatchObject({
      tool: "trace_rewards",
      input: { subject: null },
    })
  })

  it("leaves gauge explanations and claim requests alone", () => {
    expect(routeQuery("what happened to SNF incentives")).toMatchObject({
      tool: "explain_gauge",
    })
    expect(routeQuery("claim and relock my rewards")).toMatchObject({
      tool: "prepare_claim_relock",
    })
  })
})

describe("subjects and periods", () => {
  it("tries labels, parentheses and the bare name", () => {
    expect(
      subjectCandidates(
        "the Supernormal Foundation (SNF) (the wallet that owns the veBTC NFT labelled SNF)",
      ),
    ).toEqual([
      "SNF",
      "wallet that owns the veBTC NFT labelled SNF",
      "Supernormal Foundation",
    ])
  })

  it("dates 'since' from a month or an ISO date", () => {
    const now = new Date("2026-11-16T12:00:00Z")
    expect(sinceSeconds("march", now)).toBe(Date.UTC(2026, 2, 1) / 1000)
    expect(sinceSeconds("december", now)).toBe(Date.UTC(2025, 11, 1) / 1000)
    expect(sinceSeconds("2026-03-15", now)).toBe(Date.UTC(2026, 2, 15) / 1000)
    expect(sinceSeconds("someday", now)).toBeNull()
    expect(periodOf(now, null, 90, "march")?.days).toBe(261)
    expect(periodOf(now, 7, 90)?.days).toBe(7)
  })

  it("dates 'since' from a day and month, and from this week, month or year", () => {
    const now = new Date("2026-11-16T12:00:00Z")
    expect(sinceSeconds("23 apr", now)).toBe(Date.UTC(2026, 3, 23) / 1000)
    expect(sinceSeconds("23 April", now)).toBe(Date.UTC(2026, 3, 23) / 1000)
    // Still ahead this year: last year's.
    expect(sinceSeconds("20 nov", now)).toBe(Date.UTC(2025, 10, 20) / 1000)
    expect(sinceSeconds("31 feb", now)).toBeNull()
    // 16 Nov 2026 is a Monday.
    expect(sinceSeconds("this week", now)).toBe(Date.UTC(2026, 10, 16) / 1000)
    expect(sinceSeconds("this week", new Date("2026-11-22T12:00:00Z"))).toBe(
      Date.UTC(2026, 10, 16) / 1000,
    )
    expect(sinceSeconds("this month", now)).toBe(Date.UTC(2026, 10, 1) / 1000)
    expect(sinceSeconds("this year", now)).toBe(Date.UTC(2026, 0, 1) / 1000)
    expect(periodOf(now, null, 90, "2026-04-23")?.since).toBe(
      Date.UTC(2026, 3, 23) / 1000,
    )
  })

  // Fourth review of PR #84: an end date, calendar "last month", and
  // dates that are ahead, unreal or a day ahead in the user's time zone.
  it("reads an end: a month, a day, or last month as the whole month", () => {
    const now = new Date("2026-11-16T12:00:00Z")
    const at = (year: number, month: number, day: number) =>
      Date.UTC(year, month, day) / 1000
    const march = periodOf(now, null, 90, "march", "march")
    expect(march).toEqual({
      since: at(2026, 2, 1),
      until: at(2026, 3, 1) - 1,
      days: 31,
      now: now.getTime() / 1000,
      ended: true,
    })
    expect(periodOf(now, null, 90, "last month")).toMatchObject({
      since: at(2026, 9, 1),
      until: at(2026, 10, 1) - 1,
      ended: true,
    })
    // The model may pass the end as well: the same month.
    expect(periodOf(now, null, 90, "last month", "last month")).toEqual(
      periodOf(now, null, 90, "last month"),
    )
    // 16 Nov 2026 is a Monday: last week is 9 to 15 Nov.
    expect(periodOf(now, null, 90, "last week")).toMatchObject({
      since: at(2026, 10, 9),
      until: at(2026, 10, 16) - 1,
    })
    expect(periodOf(now, null, 90, "23 April 2026", "5 May")).toMatchObject({
      since: at(2026, 3, 23),
      until: at(2026, 4, 6) - 1,
      ended: true,
    })
    expect(periodOf(now, null, 90, "april", "june")).toMatchObject({
      since: at(2026, 3, 1),
      until: at(2026, 6, 1) - 1,
    })
    // An end today or later is now.
    expect(periodOf(now, null, 90, "march", "this month")).toMatchObject({
      until: now.getTime() / 1000,
      ended: false,
    })
    // Days back from the end when there is no start: whole days, from
    // the day after the end (fifth review: not 23:59:59 the day before).
    expect(periodOf(now, 30, 90, null, "2026-09-30")).toMatchObject({
      since: at(2026, 8, 1),
      until: at(2026, 9, 1) - 1,
      days: 30,
    })
    // Since, without an end: to now, as before.
    expect(periodOf(now, null, 90, "1 october")).toMatchObject({
      since: at(2026, 9, 1),
      ended: false,
    })
  })

  it("refuses future, unreal and backwards periods instead of 90 days", () => {
    const now = new Date("2026-11-16T12:00:00Z")
    expect(periodOf(now, null, 90, "2027-01-01")).toBeNull()
    expect(periodOf(now, null, 90, "december 2026")).toBeNull()
    expect(periodOf(now, null, 90, "2026-02-30")).toBeNull()
    expect(periodOf(now, null, 90, "31 february")).toBeNull()
    expect(periodOf(now, null, 90, "someday")).toBeNull()
    expect(periodOf(now, null, 90, "decade")).toBeNull()
    expect(periodOf(now, null, 90, "june", "march")).toBeNull()
    expect(periodOf(now, null, 90, "march", "whenever")).toBeNull()
    expect(sinceSeconds("2026-02-30", now)).toBeNull()
  })

  it("starts an end without a start on a whole day, and names one day once", () => {
    const now = new Date("2026-11-16T12:00:00Z")
    const at = (year: number, month: number, day: number) =>
      Date.UTC(year, month, day) / 1000
    const march = periodOf(now, null, 90, null, "march")
    expect(march).toMatchObject({
      since: at(2026, 0, 1),
      until: at(2026, 3, 1) - 1,
      days: 90,
    })
    if (march === null) throw new Error("no period")
    expect(periodSpanText(march)).toBe("1 Jan to 31 Mar 2026")
    expect(periodWord(march)).toBe("From")
    const day = periodOf(now, null, 90, "30 april", "30 april")
    if (day === null) throw new Error("no period")
    expect(periodSpanText(day)).toBe("30 Apr 2026")
    expect(periodWord(day)).toBe("On")
    const open = periodOf(now, null, 90, "1 october")
    if (open === null) throw new Error("no period")
    expect(periodWord(open)).toBe("Since")
  })

  it("takes a date up to tomorrow (UTC) as this year's, no further", () => {
    // Midday 16 Nov UTC: at most +14h east of UTC is 17 Nov, never 18.
    const now = new Date("2026-11-16T12:00:00Z")
    const today = Date.UTC(2026, 10, 16) / 1000
    expect(sinceSeconds("17 november", now)).toBe(Date.UTC(2026, 10, 17) / 1000)
    expect(periodOf(now, null, 90, "17 november")).toMatchObject({
      since: today,
    })
    expect(sinceSeconds("18 november", now)).toBe(Date.UTC(2025, 10, 18) / 1000)
    expect(periodOf(now, null, 90, "18 november")).toMatchObject({
      since: Date.UTC(2025, 10, 18) / 1000,
    })
    // With a year, a day after tomorrow is ahead: for the model.
    expect(periodOf(now, null, 90, "2026-11-17")).toMatchObject({
      since: today,
    })
    expect(periodOf(now, null, 90, "2026-11-18")).toBeNull()
  })

  it("takes a date a day ahead as this year's, from today", () => {
    // Late on 15 Nov in UTC: already 16 Nov for a user east of UTC.
    const now = new Date("2026-11-15T22:00:00Z")
    const today = Date.UTC(2026, 10, 15) / 1000
    expect(sinceSeconds("16 november", now)).toBe(Date.UTC(2026, 10, 16) / 1000)
    expect(periodOf(now, null, 90, "16 november")).toMatchObject({
      since: today,
      ended: false,
    })
    // Further ahead: last year's.
    expect(sinceSeconds("20 november", now)).toBe(Date.UTC(2025, 10, 20) / 1000)
    expect(sinceSeconds("sept", now)).toBe(Date.UTC(2026, 8, 1) / 1000)
    expect(sinceSeconds("Sept 3", now)).toBe(Date.UTC(2026, 8, 3) / 1000)
  })
})

// --- review fixes: compounded rewards, lock funding, native BTC, balances,
// partial reads, routing, label kinds and signer sets

const VEMEZO: Address = "0xb90fdad3dfd180458d62cc6acedc983d78e20122"
const MEZO: Address = "0x7b7c000000000000000000000000000000000001"
const REBASE: Address = "0x075108f275ed81c9cfc01065e6e50ceea81d6363"
const CHAIN_FEES: Address = "0xb58477e074265bdc7f7ca6100ed0f7de264f74a2"
const FUNDED: Address = "0x5959ad00d315a81c57b06516e794b82261440965"
const ZERO: Address = "0x0000000000000000000000000000000000000000"

function claimLog(
  asset: "veBTC" | "veMEZO",
  tokenId: string,
  entries: Array<{ daysAgo: number; amount: bigint }>,
) {
  return {
    asset,
    tokenId,
    claims: entries.map((entry, index) => ({
      tx: `0xd${tokenId.padStart(4, "0")}${index.toString().padStart(59, "0")}`,
      block: 13_000_000 - entry.daysAgo * 1000,
      logIndex: index,
      at: NOW_S - entry.daysAgo * DAY,
      tokenId,
      amount: entry.amount,
    })),
    complete: true,
  }
}

describe("follow the money: what the review found", () => {
  it("counts rebases compounded into locks, including a lock withdrawn since", async () => {
    const { response, shown } = await ask(SNF_QUESTION, false, {
      // The Safe withdrew veMEZO #1182 four days ago (burned to zero).
      nftMoves: async (address) => ({
        moves:
          address === SAFE
            ? [
                {
                  tx: `0x${"e1".repeat(32)}`,
                  block: 13_000_000 - 4_000,
                  logIndex: 0,
                  at: NOW_S - 4 * DAY,
                  asset: "veMEZO",
                  tokenId: "1182",
                  from: SAFE,
                  to: ZERO,
                },
              ]
            : [],
        complete: true,
      }),
      distributorClaims: async (asset, tokenId) =>
        asset === "veMEZO" && tokenId === "1172"
          ? claimLog(asset, tokenId, [
              { daysAgo: 200, amount: 999n * E18 },
              { daysAgo: 10, amount: 200n * E18 },
              { daysAgo: 3, amount: 100n * E18 },
            ])
          : asset === "veMEZO" && tokenId === "1182"
            ? claimLog(asset, tokenId, [
                // Owned by the Safe then, withdrawn since: counted.
                { daysAgo: 9, amount: 50n * E18 },
                // After the withdrawal: not the Safe's.
                { daysAgo: 2, amount: 7n * E18 },
              ])
            : asset === "veBTC" && tokenId === "6033"
              ? claimLog(asset, tokenId, [{ daysAgo: 12, amount: E18 / 50n }])
              : claimLog(asset, tokenId, []),
    })
    expect(response.answer.text).toContain(
      "Compounded into locks: 350.00 MEZO of rebases into veMEZO and 0.0200 BTC of chain fees into veBTC.",
    )
    expect(shown).toContain("350.00 MEZO compounded into 2 veMEZO locks")
    expect(shown).toContain("0.0200 BTC compounded into veBTC #6033")
  })

  it("calls a deposit into someone else's new lock funding, not relocking", async () => {
    const claim = transfer(FEES, SAFE, MEZO, 200n * E18, 6)
    const fund = transfer(SAFE, VEMEZO, MEZO, 500n * E18, 5, "VotingEscrow")
    const transfers = [claim, fund]
    const overrides: Partial<ChainActivitySource> = {
      transfers: async (address, since) => ({
        transfers: transfers.filter(
          (each) =>
            (each.from === address || each.to === address) && each.at >= since,
        ),
        complete: true,
        oldest: null,
        pages: 1,
      }),
      txLockEvents: async (tx) =>
        tx === fund.tx
          ? [
              {
                asset: "veMEZO",
                event: {
                  kind: "transfer",
                  tx,
                  block: fund.block,
                  logIndex: 1,
                  at: fund.at,
                  tokenId: "2930",
                  from: ZERO,
                  to: FUNDED,
                },
              },
              {
                asset: "veMEZO",
                event: {
                  kind: "deposit",
                  tx,
                  block: fund.block,
                  logIndex: 2,
                  at: fund.at,
                  tokenId: "2930",
                  provider: SAFE,
                  value: fund.amount,
                },
              },
            ]
          : [],
    }
    const traced = await ask(SNF_QUESTION, false, overrides)
    expect(traced.shown).toContain(
      "200.00 MEZO funded veMEZO #2930 for 0x5959…0965, part of 500.00 MEZO locked",
    )
    expect(traced.shown).not.toMatch(/locked into veMEZO/)
    const activity = await ask("what has SNF been doing?", false, overrides)
    expect(activity.response.answer.text).toContain(
      "0 lock deposits, 1 lock funded for another address",
    )
  })

  it("follows native BTC a member Safe sent, which token transfers miss", async () => {
    const claim = transfer(FEES, ENCLAVE, BTC, E18 / 100n, 20)
    const sweep = transfer(ENCLAVE, SAFE, BTC, E18 / 100n, 18, "GnosisSafeL2")
    // Native sends carry no names: the recipient is probed as a Safe.
    const native: ChainTransfer = {
      ...transfer(SAFE, OPS_SAFE, BTC, E18 / 100n, 16),
      logIndex: 1_000_100,
      native: true,
    }
    const transfers = [claim, sweep]
    const { shown } = await ask(SNF_QUESTION, false, {
      transfers: async (address, since) => ({
        transfers: transfers.filter(
          (each) =>
            (each.from === address || each.to === address) && each.at >= since,
        ),
        complete: true,
        oldest: null,
        pages: 1,
      }),
      safeNative: async (safe) => ({
        transfers: safe === SAFE ? [native] : [],
        complete: true,
        oldest: null,
        pages: 1,
      }),
    })
    expect(shown).toContain(
      "0.0100 BTC claimed in 1 claim: 0.0100 BTC sent to 0xc62b…3ffc (Safe, same signers).",
    )
  })

  it("never says more is still held than the address has now", async () => {
    const claim = transfer(FEES, ENCLAVE, BTC, E18 / 100n, 2)
    const { shown } = await ask(SNF_QUESTION, false, {
      transfers: async (address, since) => ({
        transfers: [claim].filter(
          (each) =>
            (each.from === address || each.to === address) && each.at >= since,
        ),
        complete: true,
        oldest: null,
        pages: 1,
      }),
      balances: async (pairs) =>
        new Map(
          pairs
            .filter((pair) => pair.holder === ENCLAVE && pair.token === BTC)
            .map((pair) => [`${pair.holder}:${pair.token}`, E18 / 250n]),
        ),
    })
    expect(shown).toContain(
      "0.0100 BTC claimed in 1 claim: 0.0060 no longer held, route not in token transfers, 0.0040 still held.",
    )
  })

  it("names a member whose history failed or stopped short, with the date read", async () => {
    const failed = await ask(SNF_QUESTION, false, {
      transfers: async (address, since) =>
        address === ENCLAVE
          ? null
          : {
              transfers: TRANSFERS.filter(
                (each) =>
                  (each.from === address || each.to === address) &&
                  each.at >= since,
              ),
              complete: true,
              oldest: null,
              pages: 1,
            },
    })
    expect(failed.response.answer.text).toContain(
      "(transfers of 0x1473…d786 unavailable)",
    )
    expect(failed.response.evidence.map((each) => each.label)).toContain(
      "Token transfers, partial",
    )
    const short = await ask("what has SNF been doing?", false, {
      transfers: async (address, since) => ({
        transfers: TRANSFERS.filter(
          (each) =>
            (each.from === address || each.to === address) && each.at >= since,
        ),
        complete: address !== SAFE,
        oldest: address === SAFE ? NOW_S - 30 * DAY : null,
        pages: 4,
      }),
    })
    expect(short.response.answer.text).toMatch(
      /^Since \d+ \w+ 2026 \(transfers of 0xf365…8bc4 read back to 21 Sep 2026 only\),/,
    )
  })

  it("says when a holder's claims were read only partly", async () => {
    const { response } = await ask(
      "which veBTC voters claim and sell incentives vs re-lock?",
      false,
      {
        transfers: async (address, since) => ({
          transfers: TRANSFERS.filter(
            (each) =>
              (each.from === address || each.to === address) &&
              each.at >= since,
          ),
          complete: address !== WHALE,
          oldest: null,
          pages: 2,
        }),
      },
    )
    expect(response.answer.text).toContain("Claims read partly for 1 holder.")
  })
})

describe("routing what is not about one holder", () => {
  it("keeps rankings, eligibility and protocol nouns away from resolve_holder and trace_rewards", () => {
    expect(routeQuery("who holds the most veBTC?")).toMatchObject({
      tool: "compare_holders",
      input: { asset: "veBTC", measure: "votes" },
    })
    for (const query of [
      "who is eligible for the MEZO airdrop?",
      "who are the validators?",
      "who is the top voter?",
    ]) {
      const decision = routeQuery(query)
      expect(decision.kind === "tool" && decision.tool).not.toBe(
        "resolve_holder",
      )
    }
    expect(routeQuery("who is SNF voting for?")).toMatchObject({
      tool: "address_activity",
      input: { subject: "SNF" },
    })
    const longest = routeQuery("which voters hold their veMEZO longest?")
    expect(longest.kind === "tool" && longest.tool).not.toBe("compare_holders")
    const fees = routeQuery("what does veBTC do with fees?")
    expect(fees.kind === "tool" && fees.tool).not.toBe("trace_rewards")
    // Named holders still route.
    expect(routeQuery("who is SNF?")).toMatchObject({ tool: "resolve_holder" })
    expect(
      routeQuery("which wallet owns the veBTC NFT labelled SNF"),
    ).toMatchObject({ tool: "resolve_holder" })
    expect(
      routeQuery("which veMEZO holders sell their rewards?"),
    ).toMatchObject({ tool: "compare_holders", input: { measure: "rewards" } })
  })
})

describe("the lens", () => {
  const subject = (members: Address[]) => ({
    name: "test",
    members: members.map((address) => ({
      address,
      role: "member",
      source: "test",
    })),
    locks: [],
  })

  it("maps distributor payouts and probes labelled contracts of other kinds", async () => {
    const POOL_LIKE: Address = "0x00000000000000000000000000000000000000f1"
    const probed: string[] = []
    const lens = await buildLens(
      {
        ...chain,
        labels: async () =>
          new Map([
            [
              POOL_LIKE as string,
              {
                address: POOL_LIKE,
                name: "Mystery",
                kind: "pool",
                tags: [],
                source: "curated",
              },
            ],
          ]),
        rewardPayers: async (addresses) => {
          probed.push(...addresses)
          return new Map([
            [
              POOL_LIKE as string,
              { kind: "voting" as const, asset: "veBTC" as const },
            ],
          ])
        },
      },
      subject([SAFE]),
      [
        transfer(POOL_LIKE, SAFE, MUSD, E18, 1),
        { ...transfer(CHAIN_FEES, SAFE, BTC, E18, 1), fromContract: true },
        { ...transfer(REBASE, SAFE, MEZO, E18, 1), fromContract: true },
      ].map((each) => ({ ...each, fromContract: true })),
    )
    expect(probed).toEqual([POOL_LIKE])
    const [pool, fees, rebase] = [
      transfer(POOL_LIKE, SAFE, MUSD, E18, 1),
      transfer(CHAIN_FEES, SAFE, BTC, E18, 1),
      transfer(REBASE, SAFE, MEZO, E18, 1),
    ].map((each) => lens.claimOf(each))
    expect(pool?.kind).toBe("rewards")
    expect(fees?.kind).toBe("chainFees")
    expect(rebase?.kind).toBe("rebase")
  })

  it("calls a Safe 'same signers' only against one member Safe's own set", async () => {
    const OTHER_MEMBER: Address = "0x00000000000000000000000000000000000000f2"
    const UNION_SAFE: Address = "0x00000000000000000000000000000000000000f3"
    const A = SIGNERS[0] as Address
    const B = SIGNERS[1] as Address
    const C: Address = "0x00000000000000000000000000000000000000c3"
    const D: Address = "0x00000000000000000000000000000000000000c4"
    const lens = await buildLens(
      {
        ...chain,
        safeOwners: async () =>
          new Map<string, Address[]>([
            [SAFE, [A, B]],
            [OTHER_MEMBER, [C, D]],
            [UNION_SAFE, [A, B, C, D]],
          ]),
      },
      subject([SAFE, OTHER_MEMBER]),
      [transfer(SAFE, UNION_SAFE, MUSD, E18, 1, "GnosisSafeL2")],
    )
    expect(lens.related.get(UNION_SAFE)).toBe("Safe, 2 of 4 signers shared")
  })
})

// --- re-review of PR #84: gauges, generic subjects, the window, the lock
// cap, model rows, undated reads, same-block ownership, repayments and
// bridge fees

const VAULT_GAUGE: Address = "0x677817bf3e44b90e8f95222f75e2950b7904a401"
const CL_GAUGE: Address = "0x6d446e27505c71ee39d632488ce849fef6affc57"
const SMUSD: Address = "0xb4d498029af77680cd1ef828b967f010d06c51cc"
const NTT: Address = "0x50f11fe8de0ac2acb5b1d1fd4c3a7e0b0e9b8f71"

/** Transfers in one transaction, in order. */
function sameTx(...transfers: ChainTransfer[]): ChainTransfer[] {
  const [first] = transfers
  return transfers.map((each, index) => ({
    ...each,
    tx: first?.tx ?? each.tx,
    block: first?.block ?? each.block,
    at: first?.at ?? each.at,
    logIndex: index + 1,
  }))
}

function reading(
  transfers: readonly ChainTransfer[],
): Partial<ChainActivitySource> {
  return {
    transfers: async (address, since) => ({
      transfers: transfers.filter(
        (each) =>
          (each.from === address || each.to === address) && each.at >= since,
      ),
      complete: true,
      oldest: null,
      pages: 1,
    }),
  }
}

function gaugePayers(
  gauges: Record<string, Address | null>,
): Partial<ChainActivitySource> {
  return {
    rewardPayers: async (addresses) =>
      new Map(
        addresses.flatMap((address) => {
          const staking = gauges[address]
          return staking === undefined
            ? []
            : [
                [
                  address as string,
                  {
                    kind: "gauge" as const,
                    stakingToken: staking,
                    rewardToken: MEZO,
                  },
                ] as const,
              ]
        }),
      ),
  }
}

describe("re-review of PR #84", () => {
  it("never counts a gauge's principal or emissions as a claimed reward", async () => {
    const unstake = {
      ...transfer(VAULT_GAUGE, WHALE, SMUSD, 5_250_000n * E18, 20),
      symbol: "sMUSD",
      fromContract: true,
      fromName: "VaultGauge",
    }
    const emission = {
      ...transfer(VAULT_GAUGE, WHALE, MEZO, 1_000n * E18, 20),
      symbol: "MEZO",
      fromContract: true,
      fromName: "VaultGauge",
    }
    const claim = transfer(FEES, WHALE, MUSD, 100n * E18, 15)
    const { shown } = await ask(`where did ${WHALE} rewards go?`, false, {
      ...reading([unstake, emission, claim]),
      // The vault gauge answers ve() with the veBTC escrow, like a voting
      // reward contract; its rewardToken() says it is a gauge.
      ...gaugePayers({ [VAULT_GAUGE]: SMUSD }),
      ...({
        rewardEscrows: async () =>
          new Map([[VAULT_GAUGE as string, "veBTC" as const]]),
      } as Partial<ChainActivitySource>),
    })
    expect(shown).toContain("100.00 MUSD claimed in 1 claim")
    expect(shown).not.toMatch(/sMUSD claimed|MEZO claimed/)
    expect(shown).toContain(
      "Not counted as rewards: 1 gauge's payouts (staked principal returned, gauge emissions).",
    )
  })

  it("follows a claim to the end of the period unless asked for a window", async () => {
    const claim = transfer(FEES, ENCLAVE, MUSD, 100n * E18, 40)
    const sweep = transfer(
      ENCLAVE,
      OPS_SAFE,
      MUSD,
      100n * E18,
      10,
      "GnosisSafeL2",
    )
    const { shown } = await ask(SNF_QUESTION, false, reading([claim, sweep]))
    expect(shown).toContain(
      "100.00 MUSD claimed in 1 claim: 100.00 MUSD sent to 0xc62b…3ffc (Safe, same signers).",
    )
    const windowed = await traceRewardsTool.execute(
      toolContext({ ...chain, ...reading([claim, sweep]) }),
      { subject: "SNF", days: null, since: null, windowDays: 14 },
    )
    if ("invalid" in windowed) throw new Error(windowed.invalid)
    expect(windowed.why?.items.map((item) => item.text).join("\n")).toContain(
      "100.00 MUSD claimed in 1 claim: 100.00 kept past 14 days, later moves not attributed.",
    )
  })

  it("says how many locks were read when the cap leaves some out, largest first", async () => {
    // Matchscan lists them smallest first; the cap must drop the smallest.
    const many = Array.from({ length: 17 }, (_, index) =>
      lock("veMEZO", String(3000 + index), SAFE, BigInt(index + 1) * E18),
    )
    const read: string[] = []
    const { response } = await ask(SNF_QUESTION, false, {
      ownerLocks: async (owner) => (owner === SAFE ? many : []),
      distributorClaims: async (asset, tokenId) => {
        read.push(tokenId)
        return {
          asset,
          tokenId,
          claims: [
            {
              tx: `0x${tokenId.padStart(64, "0")}`,
              block: 13_000_000,
              logIndex: 1,
              at: NOW_S - 5 * DAY,
              tokenId,
              amount: E18,
            },
          ],
          complete: true,
        }
      },
    })
    expect(read).not.toContain("3000")
    expect(read).toContain("3016")
    expect(response.answer.text).toContain(
      "Compounded into locks (16 of 17 locks read)",
    )
    expect(response.snapshot.label).toMatch(/^partial/)
    expect(response.evidence.map((each) => each.label)).toContain(
      "Lock events, 16 of 17 locks",
    )
  })

  it("gives the model each destination without its amount", async () => {
    const outcome = await traceRewardsTool.execute(toolContext(chain), {
      subject: "SNF",
      days: null,
      since: null,
      windowDays: null,
    })
    if ("invalid" in outcome) throw new Error(outcome.invalid)
    const destinations = outcome.model.rows.map((row) => row.destination)
    expect(destinations).toContain("not moved yet")
    expect(destinations).toContain("sent to 0xc62b…3ffc (Safe, same signers)")
  })

  it("calls native BTC events without block times undated, not read back to the start", async () => {
    const { response } = await ask(SNF_QUESTION, false, {
      safeNative: async (safe) => ({
        transfers: [],
        complete: safe !== SAFE,
        oldest: null,
        pages: 1,
        undated: safe === SAFE,
      }),
    })
    expect(response.answer.text).toContain(
      "(native BTC of 0xf365…8bc4 undated, not counted)",
    )
    expect(response.answer.text).not.toMatch(/read back to/)
  })

  it("reads holders' lock NFT moves so earlier owners' claims are not theirs", async () => {
    const histories: string[] = []
    await ask(
      "which veBTC voters claim and sell incentives vs re-lock?",
      false,
      {
        nftMoves: async (address) => {
          histories.push(address)
          return { moves: [], complete: true }
        },
      },
    )
    expect(histories).toContain(WHALE)
  })

  it("calls a loan repaid beside an unrelated inflow a burn, and a vault redemption a swap", async () => {
    const claim = transfer(FEES, ENCLAVE, MUSD, 100n * E18, 6)
    const repay = sameTx(transfer(ENCLAVE, ZERO, MUSD, 100n * E18, 5), {
      ...transfer(CL_GAUGE, ENCLAVE, MEZO, 50n * E18, 5),
      symbol: "MEZO",
      fromContract: true,
      fromName: "CLGauge",
    })
    const { shown } = await ask(SNF_QUESTION, false, {
      ...reading([claim, ...repay]),
      ...gaugePayers({ [CL_GAUGE]: null }),
    })
    expect(shown).toContain(
      "100.00 MUSD claimed in 1 claim: 100.00 MUSD burned.",
    )
    expect(shown).not.toMatch(/swapped to MEZO/)

    const SHARE: Address = "0x06291b67e3d7660240ab44afc9a708d82b976a8b"
    const shares = {
      ...transfer(FEES, ENCLAVE, SHARE, 10n * E18, 6),
      symbol: "morpho",
    }
    const redeem = sameTx(
      { ...transfer(ENCLAVE, ZERO, SHARE, 10n * E18, 5), symbol: "morpho" },
      { ...transfer(SHARE, ENCLAVE, MUSD, 9n * E18, 5), fromContract: true },
    )
    const redeemed = await ask(
      SNF_QUESTION,
      false,
      reading([shares, ...redeem]),
    )
    expect(redeemed.shown).toContain("swapped to MUSD")
  })

  it("calls native BTC paid with a bridged token the bridge's fee", async () => {
    const claim = transfer(FEES, SAFE, BTC, E18 / 100n, 10)
    const bridged = transfer(
      SAFE,
      NTT,
      MUSD,
      100n * E18,
      5,
      "NttManagerWithExecutor",
    )
    const fee: ChainTransfer = {
      ...transfer(SAFE, NTT, BTC, E18 / 10_000n, 5),
      tx: bridged.tx,
      block: bridged.block,
      logIndex: 1_000_100,
      native: true,
    }
    const { shown } = await ask(SNF_QUESTION, false, {
      ...reading([claim, bridged]),
      safeNative: async (safe) => ({
        transfers: safe === SAFE ? [fee] : [],
        complete: true,
        oldest: null,
        pages: 1,
      }),
    })
    expect(shown).toContain("paid as a bridge fee (NttManagerWithExecutor)")
    expect(shown).not.toMatch(/BTC bridged out/)
  })
})

describe("third review of PR #84", () => {
  const OTHER: Address = "0xd1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1"
  const SMALL: Address = "0xa3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3"

  it("never puts a larger destination under elsewhere to show a smaller one", async () => {
    // 5,000 to the same-signer Safe and 4,000 to a long-named wallet,
    // each part of a larger send, then 500 to a plain wallet: the line
    // keeps the 4,000 (without its batch total) ahead of the 500.
    const transfers = [
      transfer(FEES, SAFE, MUSD, 5_000n * E18, 20),
      transfer(SAFE, OPS_SAFE, MUSD, 50_000n * E18, 19, "GnosisSafeL2"),
      transfer(FEES, SAFE, MUSD, 4_000n * E18, 18),
      transfer(
        SAFE,
        OTHER,
        MUSD,
        40_000n * E18,
        17,
        "Acme Treasury Operations Wallet Number Two",
      ),
      transfer(FEES, SAFE, MUSD, 500n * E18, 16),
      transfer(SAFE, SMALL, MUSD, 500n * E18, 15),
    ]
    const { shown } = await ask(SNF_QUESTION, false, reading(transfers))
    // The why line, not the lead that repeats it.
    const line = shown
      .split("\n")
      .find((each) => each.startsWith("9,500.00 MUSD claimed"))
    expect(line).toContain(
      "5,000.00 MUSD sent to 0xc62b…3ffc (Safe, same signers), part of 50,000.00 MUSD sent, 4,000.00 MUSD sent to 0xd1d1…d1d1",
    )
    expect(line).not.toContain("part of 40,000.00 MUSD sent")
    expect(line?.indexOf("4,000.00 MUSD")).toBeLessThan(
      line?.indexOf(", 500.00 MUSD") ?? -1,
    )
  })

  it("names where liquid rewards went in the answer itself", async () => {
    const mezo = "0x7b7c000000000000000000000000000000000001" as Address
    const transfers = [
      transfer(FEES, SAFE, MUSD, 100n * E18, 20),
      transfer(SAFE, OPS_SAFE, MUSD, 60n * E18, 15, "GnosisSafeL2"),
      transfer(FEES, ENCLAVE, BTC, E18 / 100n, 20),
      transfer(ENCLAVE, SAFE, BTC, E18 / 100n, 18, "GnosisSafeL2"),
      transfer(SAFE, OPS_SAFE, BTC, E18 / 200n, 14, "GnosisSafeL2"),
      transfer(FEES, SAFE, mezo, 300n * E18, 12),
      transfer(SAFE, OTHER, mezo, 200n * E18, 11),
    ]
    const { response } = await ask(SNF_QUESTION, false, {
      ...reading(transfers),
      balances: async () =>
        new Map([
          [`${SAFE}:${MUSD}`, 40n * E18],
          [`${SAFE}:${BTC}`, E18 / 200n],
          [`${SAFE}:${mezo}`, 100n * E18],
        ]),
    })
    const answer = response.answer.text
    expect(answer).toMatch(
      /Liquid rewards: sent to 0xc62b…3ffc \(Safe, same signers\) and 0xd1d1…d1d1\./,
    )
    expect(answer.length).toBeLessThanOrEqual(400)
  })

  it("ranks a token's main liquid destination ahead of another token's dust", async () => {
    // MEZO (the first token): mostly compounded, then 200 sent to the
    // same-signer Safe. MUSD: 1 MUSD of dust sent to another address.
    const transfers = [
      transfer(FEES, SAFE, MEZO, 300n * E18, 12),
      transfer(SAFE, OPS_SAFE, MEZO, 200n * E18, 11, "GnosisSafeL2"),
      transfer(FEES, SAFE, MUSD, 100n * E18, 20),
      transfer(SAFE, OTHER, MUSD, E18, 15),
    ]
    const { response, shown } = await ask(SNF_QUESTION, false, {
      ...reading(transfers),
      balances: async () =>
        new Map([
          [`${SAFE}:${MUSD}`, 99n * E18],
          [`${SAFE}:${MEZO}`, 100n * E18],
        ]),
      distributorClaims: async (asset, tokenId) =>
        asset === "veMEZO" && tokenId === "1172"
          ? claimLog(asset, tokenId, [
              { daysAgo: 10, amount: 1000n * E18 },
              { daysAgo: 3, amount: 1000n * E18 },
            ])
          : claimLog(asset, tokenId, []),
    })
    // MEZO's line leads with the compounded bucket.
    expect(shown).toMatch(
      /MEZO claimed in \d+ claims: 2,000\.00 MEZO compounded/,
    )
    expect(response.answer.text).toMatch(
      /Liquid rewards: sent to 0xc62b…3ffc \(Safe, same signers\) and 0xd1d1…d1d1/,
    )
  })

  it("fits the liquid destinations to the room left, places before the held clause", () => {
    const places = [
      { where: "sent to 0xc62b…3ffc (Safe, same signers)", refs: ["a"] },
      { where: "deposited into CLPool 0xcc37…ac1a", refs: ["b"] },
      { where: "funded veMEZO #2930 for 0x5959…0965", refs: ["c"] },
    ]
    const full = liquidSentence(places, "some", 400)
    expect(full.text).toBe(
      " Liquid rewards: sent to 0xc62b…3ffc (Safe, same signers), deposited into CLPool 0xcc37…ac1a and funded veMEZO #2930 for 0x5959…0965. Some still held.",
    )
    expect(full.refs).toEqual(["a", "b", "c"])
    const tight = liquidSentence(places, "some", full.text.length - 1)
    expect(tight.text).not.toContain("Some still held")
    expect(tight.text).toContain("#2930")
    expect(liquidSentence(places, "none", 20)).toEqual({ text: "", refs: [] })
    expect(liquidSentence([], "all", 400).text).toBe(
      " Liquid rewards: still held.",
    )
  })
})

describe("fourth review of PR #84", () => {
  const OTHER: Address = "0xd1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1"
  const SHARE: Address = "0x06291b67e3d7660240ab44afc9a708d82b976a8b"

  it("names a swap on the way in the lead, then where the proceeds went", async () => {
    const shares = {
      ...transfer(FEES, ENCLAVE, SHARE, 10n * E18, 6),
      symbol: "morpho",
    }
    const redeem = sameTx(
      { ...transfer(ENCLAVE, ZERO, SHARE, 10n * E18, 5), symbol: "morpho" },
      { ...transfer(SHARE, ENCLAVE, MUSD, 9n * E18, 5), fromContract: true },
    )
    const sent = transfer(ENCLAVE, OTHER, MUSD, 9n * E18, 4)
    // A second token with its own destination: the lead lists places.
    const fees = transfer(FEES, SAFE, MUSD, 20n * E18, 6)
    const forward = transfer(SAFE, OPS_SAFE, MUSD, 20n * E18, 3, "GnosisSafeL2")
    const { response } = await ask(
      SNF_QUESTION,
      false,
      reading([shares, ...redeem, sent, fees, forward]),
    )
    expect(response.answer.text).toMatch(
      /Liquid rewards: [^\n]*swapped to MUSD[^\n]*sent to [^\n]*0xd1d1…d1d1/,
    )
  })

  it("ranks each token's largest destination before two tokens' dust", () => {
    const place = (key: string, token: number, rank: number) => ({
      key,
      where: `sent to ${key}`,
      token,
      rank,
      refs: [key],
    })
    // DUST took the second place of both tokens; MAIN and SIDE each took
    // a token's first place.
    const places = liquidPlaces([
      place("MAIN", 0, 0),
      place("DUST", 0, 1),
      place("SIDE", 1, 0),
      place("DUST", 1, 1),
    ])
    expect(places.map((each) => each.where)).toEqual([
      "sent to MAIN",
      "sent to SIDE",
      "sent to DUST",
    ])
    // Swaps of several tokens are one place.
    expect(
      liquidPlaces([
        {
          key: "swap",
          where: "swapped",
          swapTo: ["MUSD"],
          token: 0,
          rank: 0,
          refs: [],
        },
        {
          key: "swap",
          where: "swapped",
          swapTo: ["BTC"],
          token: 1,
          rank: 0,
          refs: [],
        },
      ]).map((each) => each.where),
    ).toEqual(["swapped to MUSD and BTC"])
  })

  it("joins places sent to several addresses under one 'sent to'", () => {
    expect(joinPlaces(["sent to A", "sent to B"])).toBe("sent to A and B")
    expect(
      joinPlaces(["sent to A", "funded veMEZO #2930 for C", "sent to B"]),
    ).toBe("sent to A and B, and funded veMEZO #2930 for C")
    expect(joinPlaces(["swapped to MUSD", "deposited into X"])).toBe(
      "swapped to MUSD and deposited into X",
    )
  })

  it("says 'still held' only when every liquid reward is, in every token", () => {
    const bucket = (kind: FlowBucket["kind"]): FlowBucket => ({
      label: kind,
      where: kind,
      via: [],
      kind,
      amount: E18,
      tx: null,
      to: null,
      batchTotal: 0n,
      locks: [],
    })
    const token = (...kinds: FlowBucket["kind"][]): TokenFlow => ({
      token: MUSD,
      symbol: "MUSD",
      decimals: 18,
      claimed: E18 * BigInt(kinds.length),
      compounded: 0n,
      claims: 1,
      buckets: kinds.map(bucket),
    })
    expect(heldShare([token("held"), token("held", "compounded")])).toBe("all")
    // Some left by a route the transfers miss: not all held.
    expect(heldShare([token("held"), token("held", "untracked")])).toBe("some")
    // Only the sixth token went somewhere: not all held either.
    expect(
      heldShare([
        ...Array.from({ length: 5 }, () => token("held")),
        token("sent"),
      ]),
    ).toBe("some")
    expect(heldShare([token("sent"), token("compounded")])).toBe("none")
    expect(liquidSentence([], "some", 400).text).toBe("")
    expect(liquidSentence([], "all", 400).text).toBe(
      " Liquid rewards: still held.",
    )
  })

  it("counts only claims in an ended period, and follows them to today", async () => {
    // NOW is 21 Oct 2026: September's claim is 40 days back, October's 10.
    const september = transfer(FEES, SAFE, MUSD, 100n * E18, 40)
    const october = transfer(FEES, SAFE, MUSD, 50n * E18, 10)
    const sent = transfer(SAFE, OPS_SAFE, MUSD, 100n * E18, 5, "GnosisSafeL2")
    const { response, shown } = await ask(
      "what did SNF do with its rewards in September?",
      false,
      reading([september, october, sent]),
    )
    expect(response.answer.text).toMatch(
      /^From 1 Sep to 30 Sep 2026, Supernormal Foundation \(SNF\) claimed rewards in 1 transactions/,
    )
    expect(shown).toContain(
      "100.00 MUSD claimed in 1 claim: 100.00 MUSD sent to 0xc62b…3ffc (Safe, same signers)",
    )
    expect(shown).not.toContain("150.00 MUSD")
    expect(shown).toContain("Method: each claim is followed to today")
    // Activity counts stop at the end too.
    const activity = await ask(
      "what has SNF been doing in September?",
      false,
      reading([september, october, sent]),
    )
    expect(activity.response.answer.text).toMatch(/^From 1 Sep to 30 Sep 2026/)
  })

  it("says an ended period the read never reached could not be read", async () => {
    // Every member's history stops 5 days back (page cap): September,
    // 21 to 50 days back, was never read.
    const recent = transfer(FEES, SAFE, MUSD, 50n * E18, 3)
    const shortRead = (
      oldestDaysAgo: number,
    ): Partial<ChainActivitySource> => ({
      transfers: async (address) => ({
        transfers: [recent].filter(
          (each) => each.from === address || each.to === address,
        ),
        complete: false,
        oldest: NOW_S - oldestDaysAgo * DAY,
        pages: 6,
      }),
    })
    for (const query of [
      "what did SNF do with its rewards in September?",
      "what has SNF been doing in September?",
    ]) {
      const { response } = await ask(query, false, shortRead(5))
      expect(response.answer.text, query).toMatch(
        /^The history of Supernormal Foundation \(SNF\) from 1 Sep to 30 Sep 2026 could not be read \(transfers of 0x\S+ read back to 16 Oct 2026 only/,
      )
      expect(response.answer.text).not.toMatch(/claimed no rewards|made \d/)
      expect(response.snapshot.label).toMatch(/^partial/)
    }
    // A read that reaches into the period still answers for what it read.
    const { response } = await ask(
      "what did SNF do with its rewards in September?",
      false,
      shortRead(25),
    )
    expect(response.answer.text).toMatch(
      /^Supernormal Foundation \(SNF\) claimed no rewards from 1 Sep to 30 Sep 2026 \(transfers of 0x\S+ read back to 26 Sep 2026 only/,
    )
  })

  it("keeps each subject's result when the model traced several", async () => {
    const snf = await traceRewardsTool.execute(
      { ...toolContext(chain), scope: new IdScope("c1") },
      { subject: "Supernormal", days: null, since: null, windowDays: null },
    )
    const acme = await traceRewardsTool.execute(
      { ...toolContext(chain), scope: new IdScope("c2") },
      { subject: "Acme", days: null, since: null, windowDays: null },
    )
    if ("invalid" in snf || "invalid" in acme) throw new Error("invalid")
    expect(snf.status).toBe("ok")
    expect(acme.status).toBe("empty")
    const draft = outcomeDraft([snf, acme])
    const text = draft?.answer.text ?? ""
    // SNF's result leads (title, why lines), Acme's is not dropped.
    expect(draft?.title).toBe(snf.title)
    expect(text.startsWith(snf.answer.text.split(". ")[0] ?? "-")).toBe(true)
    expect(text).toContain('Nothing on Mezo is labelled "Acme".')
    expect(text.length).toBeLessThanOrEqual(400)
    expect(draft?.answer.factRefs).toEqual(
      expect.arrayContaining(snf.answer.factRefs),
    )
    // The other order: still both, in the order asked.
    const reversed = outcomeDraft([acme, snf])?.answer.text ?? ""
    expect(reversed.startsWith("Nothing on Mezo is labelled")).toBe(true)
    expect(reversed).toContain("claimed rewards")
    // One subject: unchanged.
    expect(outcomeDraft([snf])?.answer.text).toBe(snf.answer.text)
  })

  it("gives each found subject its own room, cut at a sentence or clause", async () => {
    const snf = await traceRewardsTool.execute(
      { ...toolContext(chain), scope: new IdScope("c1") },
      { subject: "Supernormal", days: null, since: null, windowDays: null },
    )
    if ("invalid" in snf) throw new Error("invalid")
    const long = (name: string) =>
      `Since 18 Aug 2026, ${name} claimed rewards in 36 transactions, 7 tokens: 1,052,307.00 MEZO sent to 0xc62b…3ffc and locked into veMEZO #178, 0.0652 BTC swept to the Safe 0xf365…8bc4, 11,888.84 MUSD added to a pool. Compounded into locks: 5,790,546.04 MEZO. Liquid rewards: some still held.`
    const found = (name: string, subject: string): typeof snf => ({
      ...snf,
      subject,
      why: null,
      answer: { ...snf.answer, text: long(name) },
    })
    const numbers = (text: string) => text.match(/\d[\d,.]*\d|\d/g) ?? []
    const originals = new Set(
      [
        long("SNF"),
        long("Acme"),
        long("Acme Capital Partners Holdings"),
      ].flatMap(numbers),
    )
    const two = [
      found("Supernormal Foundation (SNF)", "SNF"),
      found("Acme Capital Partners Holdings", "Acme"),
    ]
    const three = [...two, found("Bravo Treasury", "Bravo")]
    for (const set of [two, three]) {
      const text = outcomeDraft(set)?.answer.text ?? ""
      expect(text.length).toBeLessThanOrEqual(400)
      expect(text).not.toMatch(/\s{2}/)
      // Each subject keeps its opening, and every part ends cleanly.
      const starts = [...text.matchAll(/Since 18 Aug 2026, /g)].length
      expect(starts).toBe(set.length)
      for (const part of text.split(/ (?=Since 18 Aug)/)) {
        expect(part).toMatch(/(\.|…)$/)
        expect(part).toMatch(/^Since 18 Aug 2026, \S.* claimed rewards/)
      }
      // No number is cut.
      for (const number of numbers(text)) {
        expect(originals.has(number), number).toBe(true)
      }
    }
    // A short one passes its spare room to a long one.
    const short = {
      ...found("x", "Acme"),
      answer: { ...snf.answer, text: "Acme claimed 1 token." },
    }
    const mixed = outcomeDraft([two[0] as typeof snf, short])?.answer.text ?? ""
    expect(mixed).toContain("Compounded into locks: 5,790,546.04 MEZO.")
    expect(mixed.endsWith("Acme claimed 1 token.")).toBe(true)
  })

  it("leads with the first found subject and drops unread or repeated calls", async () => {
    const run = (subject: string, since: string | null, prefix: string) =>
      traceRewardsTool.execute(
        { ...toolContext(chain), scope: new IdScope(prefix) },
        { subject, days: null, since, windowDays: null },
      )
    const bad = await run("SNF", "2027-01-01", "c1")
    const snf = await run("SNF", null, "c2")
    const snfSept = await run("SNF", "2026-09-01", "c3")
    if ("invalid" in bad || "invalid" in snf || "invalid" in snfSept) {
      throw new Error("invalid")
    }
    expect(bad.answer.templateId).toBe("trace_rewards.bad_period.v1")
    expect(snf.subject).toBe("SNF")
    // A retry after a bad period shows only the retry.
    expect(outcomeDraft([bad, snf])?.answer.text).toBe(snf.answer.text)
    // A bad period for another subject drops out too.
    const badAcme = { ...bad, subject: "Acme" }
    expect(outcomeDraft([badAcme, snf])?.answer.text).toBe(snf.answer.text)
    // A failed read of another subject stays, named; one of SNF itself,
    // beside SNF found, is a retry and drops out.
    const failure = {
      ...snf,
      status: "unavailable" as const,
      answer: {
        ...snf.answer,
        templateId: "trace_rewards.unavailable.v1",
        text: "Token transfers are unavailable right now.",
      },
    }
    const both = outcomeDraft([snf, { ...failure, subject: "Acme" }])
    expect(both?.answer.text).toContain(
      "Acme: Token transfers are unavailable right now.",
    )
    expect(
      both?.answer.text.startsWith(snf.answer.text.split(". ")[0] ?? "-"),
    ).toBe(true)
    expect(outcomeDraft([failure, snf])?.answer.text).toBe(snf.answer.text)
    // With nothing found, the can't-read answer still shows.
    expect(outcomeDraft([bad])?.answer.text).toBe(bad.answer.text)
    // Two periods for one subject: only the last call.
    expect(snfSept.answer.text).not.toBe(snf.answer.text)
    expect(outcomeDraft([snf, snfSept])?.answer.text).toBe(snfSept.answer.text)
    // Two found subjects: the first leads the title and why lines, as the text does.
    const acme = {
      ...snf,
      subject: "Acme",
      title: "Acme",
      why: snf.why === null ? null : { ...snf.why },
      answer: {
        ...snf.answer,
        text: "Acme claimed rewards in 1 transactions.",
      },
    }
    const draft = outcomeDraft([snf, acme])
    expect(draft?.title).toBe(snf.title)
    expect(draft?.why).toBe(snf.why)
    expect(
      draft?.answer.text.startsWith(snf.answer.text.split(". ")[0] ?? "-"),
    ).toBe(true)
    expect(outcomeDraft([acme, snf])?.why).toBe(acme.why)
  })

  it("answers plainly when the period cannot be read or is ahead", async () => {
    const outcome = await traceRewardsTool.execute(toolContext(chain), {
      subject: "SNF",
      days: null,
      since: "2027-01-01",
      windowDays: null,
    })
    if ("invalid" in outcome) throw new Error(outcome.invalid)
    expect(outcome.answer.text).toBe(
      "That period could not be read, or it has not started yet. Name a past start, such as a month or a date.",
    )
  })
})

describe("lock ownership in one block", () => {
  it("orders a claim and an NFT move in the same block by log index", () => {
    const owner = ownerAtFrom(
      new Set([SAFE]),
      [
        {
          tx: `0x${"aa".repeat(32)}`,
          block: 100,
          logIndex: 9,
          at: NOW_S,
          asset: "veMEZO",
          tokenId: "1172",
          from: SAFE,
          to: OPS_SAFE,
        },
      ],
      [],
    )
    // Claimed at log 3, moved away at log 9: still the Safe's.
    expect(owner("veMEZO", "1172", 100, 3)).toBe(SAFE)
    expect(owner("veMEZO", "1172", 100, 12)).toBeNull()
  })
})
