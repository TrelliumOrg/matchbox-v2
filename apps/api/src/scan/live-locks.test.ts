import { CONTRACTS } from "@matchbox/chain"
import type { ScanLockItem } from "@matchbox/contracts/scan"
import { describe, expect, it } from "vitest"
import type { OwnerLocks } from "../read-models/live-locks"
import {
  liveLockOf,
  liveSlot,
  ownerLocksCodec,
  reconcileOwnerLocks,
} from "./live-locks"

const vebtc = CONTRACTS.mainnet.veBTC.toLowerCase()
const vemezo = CONTRACTS.mainnet.veMEZO.toLowerCase()
const owner = `0x${"cc".repeat(20)}`
const formerOwner = `0x${"dd".repeat(20)}`
const now = 1_794_000_000
const wad = 10n ** 18n

function stored(
  fields: Partial<ScanLockItem> & Pick<ScanLockItem, "escrow" | "token_id">,
): ScanLockItem {
  return {
    owner,
    amount: wad.toString(),
    unlock_at: now + 86_400,
    created_at: now - 86_400 * 30,
    last_extended_at: null,
    withdrawn_at: null,
    is_permanent: false,
    is_withdrawn: false,
    is_merged: false,
    merged_into_token_id: null,
    merged_at: null,
    boost: null,
    activity_count: 2,
    updated_at: now - 900,
    ...fields,
  }
}

function onChain(
  locks: { escrow: "vebtc" | "vemezo"; tokenId: string }[],
  capped: ("vebtc" | "vemezo")[] = [],
): OwnerLocks {
  return {
    block: 13_200_000,
    capped,
    locks: locks.map((lock) => ({
      ...lock,
      amount: 2n * wad,
      end: 0,
      isPermanent: true,
    })),
  }
}

describe("an owner's locks with the chain's laid over the stored page", () => {
  it("keeps a lock past an escrow's cut, which may only be unlisted", () => {
    const rows = reconcileOwnerLocks({
      stored: [stored({ escrow: vemezo, token_id: "9" })],
      elsewhere: [],
      owner,
      chain: onChain([], ["vemezo"]),
    })
    expect(rows.map((lock) => lock.token_id)).toEqual(["9"])
  })

  it("lists every lock the chain has, past the stored page too, in its order", () => {
    const rows = reconcileOwnerLocks({
      stored: [
        stored({ escrow: vebtc, token_id: "20" }),
        stored({ escrow: vebtc, token_id: "40" }),
        stored({ escrow: vebtc, token_id: "45", is_withdrawn: true }),
      ],
      elsewhere: [],
      owner,
      chain: onChain([
        { escrow: "vebtc", tokenId: "20" },
        { escrow: "vebtc", tokenId: "40" },
        { escrow: "vebtc", tokenId: "300" },
        { escrow: "vebtc", tokenId: "50" },
      ]),
    })
    // Text order: "300" before "40", "50" after "45".
    expect(rows.map((lock) => lock.token_id)).toEqual([
      "20",
      "300",
      "40",
      "45",
      "50",
    ])
    // A lock made from the chain claims nothing only the store knows.
    expect(rows[1]).toMatchObject({
      created_at: null,
      activity_count: null,
      updated_at: null,
    })
  })

  it("keeps the store's creation for a lock transferred in", () => {
    const rows = reconcileOwnerLocks({
      stored: [],
      // The store still has it under its former owner.
      elsewhere: [
        stored({ escrow: vebtc, token_id: "77", owner: formerOwner }),
      ],
      owner,
      chain: onChain([{ escrow: "vebtc", tokenId: "77" }]),
    })
    expect(rows).toEqual([
      expect.objectContaining({
        token_id: "77",
        owner,
        amount: (2n * wad).toString(),
        created_at: now - 86_400 * 30,
        activity_count: 2,
      }),
    ])
  })

  it("drops a stored lock the owner no longer holds", () => {
    const rows = reconcileOwnerLocks({
      stored: [stored({ escrow: vebtc, token_id: "20" })],
      elsewhere: [],
      owner,
      chain: onChain([]),
    })
    expect(rows).toEqual([])
  })
})

describe("an owner's chain read kept at the edge", () => {
  const value = onChain([{ escrow: "vemezo", tokenId: "9" }], ["vebtc"])

  it("reads back what it stored", () => {
    expect(ownerLocksCodec.decode(ownerLocksCodec.encode(value))).toEqual(value)
  })

  it("refuses an entry whose cut escrows are not escrows", () => {
    const raw = ownerLocksCodec.encode(value) as Record<string, unknown>
    expect(ownerLocksCodec.decode({ ...raw, capped: ["vebtc", 7] })).toBeNull()
    expect(ownerLocksCodec.decode({ ...raw, capped: "vebtc" })).toBeNull()
    expect(ownerLocksCodec.decode({ ...raw, capped: undefined })).toBeNull()
  })
})

describe("a lock's votes for its page", () => {
  it("says when the lock last voted on each vote's own voter", () => {
    const live = liveLockOf({
      block: 13_200_000,
      owner,
      lock: {
        escrow: "vebtc",
        tokenId: "6179",
        amount: wad,
        end: 0,
        isPermanent: true,
        votingPower: wad,
        votes: [
          { gauge: `0x${"aa".repeat(20)}`, voter: "validators", weight: wad },
          { gauge: `0x${"bb".repeat(20)}`, voter: "pools", weight: wad },
        ],
        lastVotedAt: now,
        lastVoted: [
          { voter: "validators", at: now },
          { voter: "pools", at: now - 86_400 * 9 },
        ],
        earned: [],
      },
    })
    expect(live?.votes.map((vote) => vote.voted_at)).toEqual([
      now,
      now - 86_400 * 9,
    ])
    expect(live?.last_voted_at).toBe(now)
  })
})

describe("the minute slot", () => {
  it("changes once a minute", () => {
    expect(liveSlot(60_000)).toBe("m1")
    expect(liveSlot(119_999)).toBe("m1")
    expect(liveSlot(120_000)).toBe("m2")
  })
})
