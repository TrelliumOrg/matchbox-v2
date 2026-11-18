import type { Address } from "viem"
import { describe, expect, it } from "vitest"
import {
  type ClaimInfo,
  type Destination,
  type FlowInput,
  summarizeFlows,
  traceRewardFlows,
} from "./flows"
import type { ChainTransfer } from "./providers/chainActivity"

const E18 = 10n ** 18n
const DAY = 86_400
const T0 = 1_790_000_000

const SAFE: Address = "0x00000000000000000000000000000000000000a1"
const ENCLAVE: Address = "0x00000000000000000000000000000000000000a2"
const REWARD: Address = "0x00000000000000000000000000000000000000b1"
const OTHER_SAFE: Address = "0x00000000000000000000000000000000000000c1"
const POOL: Address = "0x00000000000000000000000000000000000000d1"
const VEBTC: Address = "0x3d4b1b884a7a1e59fe8589a3296ec8f8cbb6f279"
const MUSD: Address = "0x00000000000000000000000000000000000000e1"
const BTC: Address = "0x00000000000000000000000000000000000000e2"

let sequence = 0

function transfer(input: {
  from: Address
  to: Address
  token: Address
  amount: bigint
  day: number
  tx?: string
  toContract?: boolean
}): ChainTransfer {
  sequence += 1
  return {
    tx: input.tx ?? `0x${sequence.toString(16).padStart(64, "0")}`,
    block: 1_000 + Math.round(input.day * 100) + sequence,
    logIndex: sequence,
    at: T0 + Math.round(input.day * DAY),
    from: input.from,
    to: input.to,
    token: input.token,
    symbol: input.token === MUSD ? "MUSD" : "BTC",
    decimals: 18,
    amount: input.amount,
    fromName: null,
    toName: null,
    fromContract: false,
    toContract: input.toContract ?? false,
  }
}

function run(transfers: ChainTransfer[], overrides: Partial<FlowInput> = {}) {
  const claimOf = (each: ChainTransfer): ClaimInfo | null =>
    each.from === REWARD ? { kind: "fees", source: "Fees", lock: null } : null
  const destinationOf = (each: ChainTransfer): Destination => {
    if (each.to === VEBTC) {
      return {
        kind: "locked",
        asset: "veBTC",
        tokenId: "6033",
        owner: SAFE,
        own: true,
      }
    }
    if (each.to === OTHER_SAFE) {
      return {
        kind: "sent",
        to: each.to,
        label: "Safe, same signers",
        relation: "related",
      }
    }
    return { kind: "sent", to: each.to, label: null, relation: "wallet" }
  }
  return traceRewardFlows({
    members: new Set([SAFE, ENCLAVE]),
    transfers,
    claimOf,
    destinationOf,
    swapLeg: (each) => each.toContract,
    windowSeconds: 14 * DAY,
    since: T0 - DAY,
    until: T0 + 60 * DAY,
    ...overrides,
  })
}

describe("traceRewardFlows", () => {
  it("follows a claim through the entity's own addresses to its destination", () => {
    const result = run([
      transfer({
        from: REWARD,
        to: ENCLAVE,
        token: MUSD,
        amount: 100n * E18,
        day: 0,
      }),
      transfer({
        from: ENCLAVE,
        to: SAFE,
        token: MUSD,
        amount: 100n * E18,
        day: 1,
      }),
      transfer({
        from: SAFE,
        to: OTHER_SAFE,
        token: MUSD,
        amount: 60n * E18,
        day: 2,
      }),
    ])
    expect(result.claims).toHaveLength(1)
    const [token] = summarizeFlows(result)
    expect(token?.claimed).toBe(100n * E18)
    expect(
      token?.buckets.map((bucket) => [bucket.label, bucket.amount]),
    ).toEqual([
      [`sent to ${OTHER_SAFE} (Safe, same signers)`, 60n * E18],
      ["kept past 14 days, later moves not attributed", 40n * E18],
    ])
    const sent = result.outcomes.find(
      (each) => each.destination.kind === "sent",
    )
    expect(sent?.hops).toEqual([SAFE])
  })

  it("spends claims first in, first out, and never more than was claimed", () => {
    const result = run([
      transfer({
        from: REWARD,
        to: SAFE,
        token: MUSD,
        amount: 10n * E18,
        day: 0,
      }),
      transfer({
        from: REWARD,
        to: SAFE,
        token: MUSD,
        amount: 20n * E18,
        day: 1,
      }),
      // 100 out: 30 claimed, the rest is other balance and is not counted.
      transfer({
        from: SAFE,
        to: OTHER_SAFE,
        token: MUSD,
        amount: 100n * E18,
        day: 2,
      }),
    ])
    const total = result.outcomes.reduce((sum, each) => sum + each.amount, 0n)
    expect(total).toBe(30n * E18)
    expect(result.outcomes.map((each) => each.claim)).toEqual([0, 1])
  })

  it("says a lot sent after its window was not moved, never still held", () => {
    const result = run([
      transfer({
        from: REWARD,
        to: SAFE,
        token: MUSD,
        amount: 10n * E18,
        day: 0,
      }),
      transfer({
        from: SAFE,
        to: OTHER_SAFE,
        token: MUSD,
        amount: 10n * E18,
        day: 20,
      }),
    ])
    expect(result.outcomes).toEqual([
      expect.objectContaining({
        amount: 10n * E18,
        destination: {
          kind: "unmoved",
          at: SAFE,
          token: MUSD,
          days: 14,
          open: false,
        },
      }),
    ])
  })

  it("continues a swap as the token received, counted in the claimed token", () => {
    const swap =
      "0xabc0000000000000000000000000000000000000000000000000000000000001"
    const result = run([
      transfer({
        from: REWARD,
        to: SAFE,
        token: MUSD,
        amount: 100n * E18,
        day: 0,
      }),
      transfer({
        from: SAFE,
        to: POOL,
        token: MUSD,
        amount: 100n * E18,
        day: 1,
        tx: swap,
        toContract: true,
      }),
      transfer({
        from: POOL,
        to: SAFE,
        token: BTC,
        amount: E18 / 1000n,
        day: 1,
        tx: swap,
      }),
      transfer({
        from: SAFE,
        to: VEBTC,
        token: BTC,
        amount: E18 / 1000n,
        day: 2,
      }),
    ])
    const [token] = summarizeFlows(result)
    expect(token?.buckets).toEqual([
      expect.objectContaining({
        label: "swapped to BTC, locked into veBTC #6033",
        kind: "locked",
        amount: 100n * E18,
      }),
    ])
  })

  it("never calls a transfer to a wallet a swap, even beside an inflow", () => {
    const tx =
      "0xabc0000000000000000000000000000000000000000000000000000000000002"
    const result = run([
      transfer({
        from: REWARD,
        to: SAFE,
        token: MUSD,
        amount: 5n * E18,
        day: 0,
      }),
      transfer({
        from: SAFE,
        to: OTHER_SAFE,
        token: MUSD,
        amount: 5n * E18,
        day: 1,
        tx,
      }),
      transfer({ from: POOL, to: SAFE, token: BTC, amount: E18, day: 1, tx }),
    ])
    expect(result.outcomes[0]?.via).toEqual([])
    expect(result.outcomes[0]?.destination.kind).toBe("sent")
  })

  it("leaves out claims before the period and transfers that are not claims", () => {
    const result = run(
      [
        transfer({
          from: REWARD,
          to: SAFE,
          token: MUSD,
          amount: 5n * E18,
          day: -3,
        }),
        transfer({
          from: POOL,
          to: SAFE,
          token: MUSD,
          amount: 5n * E18,
          day: 1,
        }),
      ],
      { since: T0 },
    )
    expect(result.claims).toEqual([])
    expect(summarizeFlows(result)).toEqual([])
  })

  it("keeps a lot whose window is still open as not moved yet without a balance", () => {
    const result = run(
      [
        transfer({
          from: REWARD,
          to: SAFE,
          token: MUSD,
          amount: 5n * E18,
          day: 0,
        }),
      ],
      { until: T0 + 3 * DAY },
    )
    expect(result.outcomes[0]?.destination).toEqual({
      kind: "unmoved",
      at: SAFE,
      token: MUSD,
      days: 14,
      open: true,
    })
  })

  it("never calls more still held than the address's balance now", () => {
    // 10 claimed and nothing seen leaving, but only 4 is there now (sent
    // by a route token transfers do not show, such as native BTC).
    const result = run(
      [
        transfer({
          from: REWARD,
          to: SAFE,
          token: BTC,
          amount: 6n * E18,
          day: 0,
        }),
        transfer({
          from: REWARD,
          to: SAFE,
          token: BTC,
          amount: 4n * E18,
          day: 1,
        }),
      ],
      {
        until: T0 + 3 * DAY,
        balances: new Map([[`${SAFE}:${BTC}`, 4n * E18]]),
      },
    )
    const [token] = summarizeFlows(result)
    expect(
      token?.buckets.map((bucket) => [bucket.label, bucket.amount]),
    ).toEqual([
      ["no longer held, route not in token transfers", 6n * E18],
      ["still held", 4n * E18],
    ])
  })

  it("starts the window again when a lot reaches another own address", () => {
    const result = run([
      transfer({
        from: REWARD,
        to: ENCLAVE,
        token: MUSD,
        amount: 7n * E18,
        day: 0,
      }),
      transfer({
        from: ENCLAVE,
        to: SAFE,
        token: MUSD,
        amount: 7n * E18,
        day: 10,
      }),
      // 20 days after the claim, 10 after it reached the Safe.
      transfer({
        from: SAFE,
        to: OTHER_SAFE,
        token: MUSD,
        amount: 7n * E18,
        day: 20,
      }),
    ])
    expect(result.outcomes).toEqual([
      expect.objectContaining({
        amount: 7n * E18,
        destination: expect.objectContaining({ kind: "sent", to: OTHER_SAFE }),
        hops: [SAFE],
      }),
    ])
  })

  it("counts compounded rebases and chain fees as claimed and settled in their lock", () => {
    const MEZO: Address = "0x7b7c000000000000000000000000000000000001"
    const compounded = [
      { tokenId: "1172", amount: 300n * E18, day: 1 },
      { tokenId: "1179", amount: 100n * E18, day: 2 },
      { tokenId: "1172", amount: 50n * E18, day: 90 },
    ].map((each, index) => ({
      tx: `0xc${index.toString().padStart(63, "0")}`,
      at: T0 + each.day * DAY,
      member: SAFE,
      asset: "veMEZO" as const,
      tokenId: each.tokenId,
      token: MEZO,
      symbol: "MEZO",
      decimals: 18,
      amount: each.amount,
      kind: "rebase" as const,
      from: REWARD,
    }))
    const result = run([], { compounded })
    // The one on day 90 is after the period.
    expect(result.claims.map((claim) => [claim.kind, claim.lock])).toEqual([
      ["rebase", "veMEZO #1172"],
      ["rebase", "veMEZO #1179"],
    ])
    const [token] = summarizeFlows(result)
    expect(token).toEqual(
      expect.objectContaining({
        claimed: 400n * E18,
        compounded: 400n * E18,
        claims: 2,
      }),
    )
    expect(token?.buckets).toEqual([
      expect.objectContaining({
        label: "compounded into 2 veMEZO locks",
        kind: "compounded",
        amount: 400n * E18,
        locks: ["1172", "1179"],
      }),
    ])
  })

  it("names a deposit into someone else's lock as funding it", () => {
    const FUNDED: Address = "0x5959ad00d315a81c57b06516e794b82261440965"
    const result = run(
      [
        transfer({
          from: REWARD,
          to: SAFE,
          token: MUSD,
          amount: 30n * E18,
          day: 0,
        }),
        transfer({
          from: SAFE,
          to: VEBTC,
          token: MUSD,
          amount: 100n * E18,
          day: 1,
        }),
      ],
      {
        destinationOf: () => ({
          kind: "locked",
          asset: "veMEZO",
          tokenId: "2930",
          owner: FUNDED,
          own: false,
        }),
      },
    )
    const [token] = summarizeFlows(result)
    // The reward slice is 30 of a 100 deposit: the batch says so.
    expect(token?.buckets).toEqual([
      expect.objectContaining({
        label: `funded veMEZO #2930 for ${FUNDED}`,
        amount: 30n * E18,
        batchTotal: 100n * E18,
      }),
    ])
  })

  it("counts a member's liquid claims only from where its history was read", () => {
    const result = run(
      [
        transfer({
          from: REWARD,
          to: SAFE,
          token: MUSD,
          amount: 5n * E18,
          day: 1,
        }),
        transfer({
          from: REWARD,
          to: ENCLAVE,
          token: MUSD,
          amount: 7n * E18,
          day: 1,
        }),
        transfer({
          from: REWARD,
          to: SAFE,
          token: MUSD,
          amount: 9n * E18,
          day: 5,
        }),
      ],
      { memberSince: new Map([[SAFE, T0 + 3 * DAY]]) },
    )
    expect(result.claims.map((claim) => claim.amount)).toEqual([
      7n * E18,
      9n * E18,
    ])
  })
})
