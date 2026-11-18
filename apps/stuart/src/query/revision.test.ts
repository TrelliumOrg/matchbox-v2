import {
  demoGaugeDirectory,
  demoMeta,
  demoWalletOverview,
  demoWalletRewards,
} from "@matchbox/contracts/read-models/fixtures"
import {
  type ParsedStuartRequest,
  type Proposal,
  stuartRequestSchema,
} from "@matchbox/stuart-ui/contract"
import { describe, expect, it } from "vitest"
import type { StuartProviders } from "./context"
import { fakeProviders, NOW, WALLET } from "./fakes"
import { lockVerdict, mergeTargetVerdict } from "./lockRules"
import { runStuartQuery, traceSummary } from "./orchestrator"
import { IdScope } from "./outcome"
import { claimCandidates } from "./providers/claimsChain"
import type { LockChainState } from "./providers/locks"
import { createFixtureReadModels } from "./providers/readModels"
import { routeQuery } from "./router"
import { searchQuery } from "./search"
import { checkModelAnswer, emptySourcedSet, SUPPORT_LIMITS } from "./sourced"
import { consistencyOutcome } from "./tools/consistency"

const E18 = 10n ** 18n
const NOW_S = BigInt(Math.floor(NOW.getTime() / 1000))
const WEEK = 604_800n
const VEMEZO = "0xb90fdad3dfd180458d62cc6acedc983d78e20122"
const VEBTC = "0x3d4b1b884a7a1e59fe8589a3296ec8f8cbb6f279"
const APPROVE = "0x095ea7b3"
const APPROVE_ALL = "0xa22cb465"

function request(
  query: string,
  mode: "connected" | "watching" = "connected",
): ParsedStuartRequest {
  return stuartRequestSchema.parse({
    version: 1,
    query,
    sessionId: "6f1c1b8e-3c55-4a3f-9b8a-1d2e3f4a5b6c",
    turn: 0,
    surface: "palette",
    chainId: 31_612,
    wallet: { address: WALLET, mode },
  })
}

function ask(query: string, overrides: Partial<StuartProviders> = {}) {
  return runStuartQuery(request(query), {
    providers: fakeProviders(overrides),
    secret: "test-secret",
    now: () => NOW,
    claude: null,
    log: () => undefined,
  })
}

function lock(overrides: Partial<LockChainState> = {}): LockChainState {
  return {
    asset: "veMEZO",
    tokenId: 4821n,
    owner: WALLET,
    amount: 10_000n * E18,
    end: NOW_S + 52n * WEEK,
    isPermanent: false,
    vestingEnd: 0n,
    escrowType: 0,
    votedVoters: [],
    lastVoted: {},
    ...overrides,
  }
}

/** No ERC-721 approval anywhere, and ERC-20 approvals never to an escrow. */
function assertNoCustody(proposal: Proposal): void {
  for (const call of proposal.calls) {
    const selector = call.data.slice(0, 10).toLowerCase()
    expect(selector).not.toBe(APPROVE_ALL)
    if (selector === APPROVE) {
      expect([VEMEZO, VEBTC]).not.toContain(call.to.toLowerCase())
    }
  }
}

describe("claims read on chain", () => {
  it("looks where each lock voted and where its rewards came from", () => {
    const candidates = claimCandidates({
      overview: demoWalletOverview,
      rewards: demoWalletRewards,
      tokenIds: null,
    })
    expect(candidates.length).toBeGreaterThan(0)
    const keys = new Set(
      candidates.map((c) => `${c.voter}:${c.gauge.toLowerCase()}:${c.tokenId}`),
    )
    expect(keys.size).toBe(candidates.length)
  })

  it("claim all proposes every lock's claim with plain-word steps", async () => {
    const response = await ask("claim all my rewards")
    const proposal = response.proposedActions[0]
    expect(proposal?.kind).toBe("claim")
    expect(proposal?.calls[0]?.label).toMatch(/^Claim veMEZO #\d+$/)
    expect(proposal?.calls[0]?.detail).toMatch(
      /^Boost rewards through Epoch \d+$/,
    )
    expect(response.answer.text).toMatch(
      /to claim from veMEZO #\d+\. One signature\./,
    )
    if (proposal) assertNoCustody(proposal)
  })
})

describe("lock rules", () => {
  it("follows the Decided 9 Nov edge cases", () => {
    expect(
      lockVerdict(lock({ vestingEnd: NOW_S + WEEK }), "add", NOW_S, WALLET),
    ).toMatchObject({ ok: false, reason: "lock_vesting" })
    expect(
      lockVerdict(lock({ escrowType: 2 }), "extend", NOW_S, WALLET),
    ).toMatchObject({ ok: false, reason: "lock_managed" })
    const expired = lock({ end: NOW_S - 10n })
    expect(lockVerdict(expired, "add", NOW_S, WALLET)).toMatchObject({
      ok: false,
      reason: "lock_expired",
    })
    expect(lockVerdict(expired, "withdraw", NOW_S, WALLET)).toMatchObject({
      ok: true,
    })
    expect(lockVerdict(lock(), "withdraw", NOW_S, WALLET)).toMatchObject({
      ok: false,
      reason: "lock_not_expired",
    })
    expect(
      lockVerdict(
        lock({ isPermanent: true, end: 0n }),
        "extend",
        NOW_S,
        WALLET,
      ),
    ).toMatchObject({ ok: false, reason: "lock_auto_max" })
    // Voted this epoch: merge waits for next Thursday 01:00.
    const voted = lock({
      votedVoters: ["boost"],
      lastVoted: { boost: NOW_S - 60n },
    })
    expect(lockVerdict(voted, "merge", NOW_S, WALLET)).toMatchObject({
      ok: false,
      reason: "lock_voted_this_epoch",
    })
    // Voted in an earlier epoch: reset first, then merge.
    const earlier = lock({
      votedVoters: ["boost"],
      lastVoted: { boost: NOW_S - 2n * WEEK },
    })
    expect(lockVerdict(earlier, "merge", NOW_S, WALLET)).toEqual({
      ok: true,
      resets: ["boost"],
    })
    // A voted lock transfers as it is: the chain needs no reset.
    expect(lockVerdict(voted, "transfer", NOW_S, WALLET)).toEqual({
      ok: true,
      resets: [],
    })
    expect(lockVerdict(earlier, "transfer", NOW_S, WALLET)).toEqual({
      ok: true,
      resets: [],
    })
    expect(
      lockVerdict(
        lock({ owner: "0x0000000000000000000000000000000000000001" }),
        "add",
        NOW_S,
        WALLET,
      ),
    ).toMatchObject({ ok: false, reason: "lock_not_owned" })
    expect(
      mergeTargetVerdict(
        lock(),
        lock({ asset: "veBTC", tokenId: 6033n }),
        NOW_S,
        WALLET,
      ),
    ).toMatchObject({ ok: false, reason: "different_escrows" })
    expect(
      mergeTargetVerdict(
        lock(),
        lock({ tokenId: 4966n, end: NOW_S - 1n }),
        NOW_S,
        WALLET,
      ),
    ).toMatchObject({ ok: false, reason: "lock_expired" })
  })
})

describe("lock actions propose transactions", () => {
  it("adds with an exact MEZO approval, never an NFT approval", async () => {
    const response = await ask("add 1000 mezo to #4966")
    const proposal = response.proposedActions[0]
    expect(proposal?.kind).toBe("lock")
    expect(proposal?.content).toMatchObject({
      kind: "lock",
      action: "add",
      tokenId: "4966",
    })
    expect(proposal?.calls.map((call) => call.kind)).toEqual([
      "approve",
      "lock",
    ])
    expect(proposal?.calls[0]?.detail).toBe("Exactly this amount, nothing more")
    expect(response.answer.text).toBe(
      "Add 1,000.00 MEZO to veMEZO #4966. 2 signatures.",
    )
    if (proposal) assertNoCustody(proposal)
  })

  it("merges after clearing votes from an earlier epoch", async () => {
    const response = await ask("merge #4966 into #4821", {
      lockStates: async (asset, ids) => ({
        blockNumber: 1n,
        now: NOW_S,
        locks: ids.map((tokenId) =>
          lock({
            asset,
            tokenId,
            ...(tokenId === 4966n
              ? {
                  votedVoters: ["boost"],
                  lastVoted: { boost: NOW_S - 3n * WEEK },
                }
              : {}),
          }),
        ),
      }),
    })
    const proposal = response.proposedActions[0]
    expect(proposal?.calls.map((call) => call.kind)).toEqual(["reset", "lock"])
    expect(proposal?.calls[1]?.label).toBe("Merge #4966 into #4821")
  })

  it("refuses a vesting lock with its end date, and proposes nothing", async () => {
    const response = await ask("extend #4966 by 10 weeks", {
      lockStates: async (asset, ids) => ({
        blockNumber: 1n,
        now: NOW_S,
        locks: ids.map((tokenId) =>
          lock({ asset, tokenId, vestingEnd: NOW_S + 10n * WEEK }),
        ),
      }),
    })
    expect(response.proposedActions).toEqual([])
    expect(response.answer.text).toMatch(
      /^This lock is vesting until \w{3} \d{1,2} \w{3} \d{4}\.$/,
    )
  })

  it("transfers with safeTransferFrom to a 0x address", async () => {
    const to = "0x1111111111111111111111111111111111111111"
    const response = await ask(`transfer #4966 to ${to}`)
    const proposal = response.proposedActions[0]
    expect(proposal?.content).toMatchObject({
      action: "transfer",
      recipient: "0x1111111111111111111111111111111111111111",
    })
    expect(proposal?.calls.at(-1)?.data.slice(0, 10)).toBe("0x42842e0e")
    if (proposal) assertNoCustody(proposal)
  })

  it("claims and relocks the MEZO into the largest open lock", async () => {
    const response = await ask("claim my rewards and relock them into #4966")
    const proposal = response.proposedActions[0]
    expect(proposal?.kind).toBe("claim_relock")
    expect(proposal?.calls.at(-1)).toMatchObject({
      kind: "lock",
      label: "Add to #4966",
    })
    if (proposal) assertNoCustody(proposal)
  })
})

describe("routing", () => {
  it("ranks consistency by funded epochs, never claimables", () => {
    const decision = routeQuery(
      "Which gauges have most consistently had rewards?",
    )
    expect(decision).toMatchObject({
      kind: "tool",
      tool: "rank_gauges",
      input: { objective: "most_consistently_funded" },
    })
  })

  it("routes lock actions, and leaves questions about them to help", () => {
    expect(routeQuery("withdraw my expired lock")).toMatchObject({
      tool: "prepare_lock_action",
      input: { action: "withdraw" },
    })
    expect(routeQuery("turn on auto max for #4821")).toMatchObject({
      input: { action: "auto_max", tokenId: "4821" },
    })
    expect(routeQuery("extend lock 4966 to the max")).toMatchObject({
      input: { action: "extend", tokenId: "4966", weeks: null },
    })
    expect(routeQuery("claim and relock my rewards")).toMatchObject({
      tool: "prepare_claim_relock",
    })
    expect(routeQuery("can I merge my locks?")).not.toMatchObject({
      tool: "prepare_lock_action",
    })
  })
})

describe("consistency ranking", () => {
  it("uses the API's funded epochs and names the window", () => {
    const outcome = consistencyOutcome({
      context: {
        providers: fakeProviders(),
        wallet: { address: WALLET, mode: "connected", label: "x" },
        query: "",
        choice: null,
        now: () => NOW,
        secret: "s",
        scope: new IdScope("c1"),
      },
      ranking: {
        throughEpoch: 46,
        window: 8,
        gauges: demoGaugeDirectory.gauges.slice(0, 3).map((card, index) => ({
          gauge: card.gauge,
          recent: 8 - index,
          window: 8,
          total: 20,
          streak: 8 - index,
        })),
      },
      kind: null,
      blockNumber: null,
    })
    expect(outcome?.answer.text).toMatch(
      /was funded in 8 of the last 8 completed epochs, 8 in a row/,
    )
    const block = outcome?.blocks[0]
    expect(block?.type === "gauge_ranking" && block.rows[0]?.kind).toBeTruthy()
  })
})

describe("search", () => {
  const models = createFixtureReadModels()

  it("finds a transaction, a wallet and gauges", async () => {
    const hash = `0x${"ab".repeat(32)}`
    expect((await searchQuery(hash, models)).results[0]).toMatchObject({
      type: "transaction",
      url: `https://scan.matchbox.markets/tx/${hash}`,
    })
    const wallet = await searchQuery(WALLET, models)
    expect(wallet.results[0]).toMatchObject({ type: "wallet" })
    const name = demoGaugeDirectory.gauges[0]?.gauge.name ?? ""
    const gauges = await searchQuery(name.slice(0, 4), models)
    expect(gauges.results.some((result) => result.type === "gauge")).toBe(true)
    expect((await searchQuery("  ", models)).results).toEqual([])
    expect(demoMeta.block).toBeGreaterThan(0)
  })
})

describe("answer shape", () => {
  it("summarises what was checked in one row", () => {
    expect(
      traceSummary({
        outcomes: [
          { checked: ["1 lock", "prices"] },
          { checked: ["prices"] },
        ] as never,
        snapshot: { blockNumber: 13_103_045n },
      }),
    ).toBe("Checked 1 lock and prices, block 13,103,045")
  })

  it("lets support answers use three sentences", () => {
    const text = "One. Two. Three."
    expect(checkModelAnswer(text, emptySourcedSet()).ok).toBe(false)
    expect(checkModelAnswer(text, emptySourcedSet(), SUPPORT_LIMITS).ok).toBe(
      true,
    )
  })
})
