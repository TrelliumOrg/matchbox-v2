import { CONTRACTS, VOTING_ESCROW_EVENTS_ABI } from "@matchbox/chain"
import {
  type AbiEvent,
  encodeAbiParameters,
  encodeEventTopics,
  type Hex,
} from "viem"
import { describe, expect, it } from "vitest"
import { staticSourcesFor } from "../../src/decode/dispatch"
import {
  type ChainLock,
  type CopiedActivity,
  copiedActivity,
  decodeReceipt,
  type KnownLock,
  type KnownReward,
  liveActivity,
  lockKeysOf,
  type ReceiptInput,
} from "../../src/decode/receipt"
import recorded from "../fixtures/receipts.json"

// Fifteen mainnet transactions of the kinds Pro and Mezo users send (votes
// on all four voters, a poke, abstains, bribe and fee claims, incentives,
// lock create, add, extend, merge, auto max, withdraw, a rebase claim),
// recorded on 19 Nov 2026 with the activity rows the copy wrote for them
// (matchbox-scan `activity`), and the reward contracts and pool gauges
// those receipts name, from `incentive_deposits`. Decoding the receipt
// alone must give the copy's rows.

type Row = (typeof recorded.rows)[number]

const known = recorded.known as KnownReward[]
const gauges = new Map(recorded.gauges.map((row) => [row.pool, row.gauge]))

/**
 * Each lock as it was stored before the transaction, from what the copy
 * recorded of it (the rows' before), as the API passes the stored rows.
 */
function locksBefore(rows: readonly Row[]): KnownLock[] {
  const locks = new Map<string, KnownLock>()
  const put = (
    row: Row,
    tokenId: string,
    amount: unknown,
    duration: unknown,
    permanent: unknown,
  ) => {
    const key = `${row.lock_escrow}-${tokenId}`
    if (locks.has(key) || row.lock_escrow === null) return
    if (typeof amount !== "string") return
    locks.set(key, {
      escrow: row.lock_escrow,
      tokenId,
      owner: row.actor,
      amount,
      unlockAt:
        permanent === true
          ? 0
          : row.timestamp + Number(typeof duration === "string" ? duration : 0),
      isPermanent: permanent === true,
      isWithdrawn: false,
      isMerged: false,
      createdAt: null,
      activityCount: 1,
    })
  }
  for (const row of rows) {
    if (row.token_id === null || row.source !== "VOTING_ESCROW") continue
    const extra = row.extra as Record<string, unknown>
    const from = extra.merge_source_token_id
    put(
      row,
      typeof from === "string" ? from : row.token_id,
      extra.prev_amount,
      extra.prev_duration,
      extra.prev_is_permanent,
    )
    const into = extra.merge_dest_token_id
    if (typeof into === "string") {
      put(
        row,
        into,
        extra.merge_dest_prev_amount,
        extra.merge_dest_prev_duration,
        extra.merge_dest_prev_is_permanent,
      )
    }
  }
  // A vote names the lock; the stored row says who owns it.
  for (const row of rows) {
    if (row.token_id !== null && row.action_type.startsWith("BOOST_")) {
      put(row, row.token_id, "0", "0", false)
    }
  }
  return [...locks.values()]
}

describe("decodeReceipt", () => {
  for (const receipt of recorded.receipts) {
    it(`reads ${receipt.hash.slice(0, 10)} as the copy did`, () => {
      const expected = recorded.rows.filter(
        (row) => row.tx_hash === receipt.hash,
      )
      const input = {
        ...receipt,
        blockNumber: BigInt(receipt.blockNumber),
        timestamp: BigInt(receipt.timestamp),
      }
      const rows = decodeReceipt(input, known, locksBefore(expected)).map(
        (row) => copiedActivity(row, (pool) => gauges.get(pool) ?? null),
      )
      expect(rows).toEqual(expected)
      for (const lock of locksBefore(expected)) {
        expect(lockKeysOf(input)).toContainEqual({
          escrow: lock.escrow,
          tokenId: lock.tokenId,
        })
      }
    })
  }

  it("skips logs from reward contracts it was not told about", () => {
    // Legacy reward contracts are static sources: always decoded.
    const statics = new Set(
      staticSourcesFor("mezo").map((source) => source.address),
    )
    const rewards = new Set(
      known
        .map((reward) => reward.address)
        .filter((address) => !statics.has(address as `0x${string}`)),
    )
    const claims = recorded.rows.filter(
      (row) =>
        row.action_type.endsWith("_CLAIMED") &&
        rewards.has(row.contract_address),
    )
    expect(claims.length).toBeGreaterThan(0)
    for (const claim of claims) {
      const receipt = recorded.receipts.find(
        (each) => each.hash === claim.tx_hash,
      )
      if (receipt === undefined) throw new Error("receipt not recorded")
      const ids = decodeReceipt({
        ...receipt,
        blockNumber: BigInt(receipt.blockNumber),
        timestamp: BigInt(receipt.timestamp),
      }).map((row) => row.id)
      expect(ids).not.toContain(claim.id)
    }
  })

  it("reads nothing from a receipt without logs", () => {
    expect(
      decodeReceipt({
        hash: `0x${"1".repeat(64)}`,
        from: `0x${"2".repeat(40)}`,
        to: null,
        input: "0x",
        blockNumber: 13_000_000n,
        timestamp: 1_790_000_000n,
        position: 0,
        logs: [],
      }),
    ).toEqual([])
  })
})

// -- read live -----------------------------------------------------------------

type Receipt = (typeof recorded.receipts)[number]

function inputOf(receipt: Receipt): ReceiptInput {
  return {
    ...receipt,
    blockNumber: BigInt(receipt.blockNumber),
    timestamp: BigInt(receipt.timestamp),
  }
}

const expectedOf = (receipt: Receipt): Row[] =>
  recorded.rows.filter((row) => row.tx_hash === receipt.hash)

/** The stored locks before the transaction, as the chain had them. */
function chainBefore(rows: readonly Row[]): ChainLock[] {
  return locksBefore(rows).map((lock) => ({
    escrow: lock.escrow,
    tokenId: lock.tokenId,
    owner: lock.owner,
    amount: lock.amount,
    end: lock.unlockAt ?? 0,
    isPermanent: lock.isPermanent,
  }))
}

/** Every touched lock off by a little: a stored row the copy has not caught up. */
function stale(locks: readonly ChainLock[]): ChainLock[] {
  return locks.map((lock) => ({
    ...lock,
    amount: (BigInt(lock.amount) + 1_000n).toString(),
    end: lock.isPermanent ? 0 : lock.end + 604_800,
  }))
}

const live = (
  input: ReceiptInput,
  locks: Parameters<typeof liveActivity>[1]["locks"],
) =>
  liveActivity(input, {
    known,
    gaugeOfPool: (pool) => gauges.get(pool) ?? null,
    locks,
  })

/** What a live row keeps equals the copy's row, field by field. */
function expectWithin(
  rows: readonly CopiedActivity[],
  expected: readonly Row[],
) {
  expect(rows.map((row) => row.id)).toEqual(expected.map((row) => row.id))
  rows.forEach((row, index) => {
    const copied = expected[index]
    if (copied === undefined) throw new Error("row missing")
    const { extra, ...fields } = row
    const { extra: copiedExtra, ...copiedFields } = copied
    for (const [key, value] of Object.entries(fields)) {
      if (value !== null) {
        expect([key, value]).toEqual([key, Reflect.get(copiedFields, key)])
      }
    }
    for (const [key, value] of Object.entries(extra)) {
      expect([key, value]).toEqual([key, Reflect.get(copiedExtra, key)])
    }
  })
}

/** The extras that come from a lock's state before the transaction. */
const priorExtras = [
  "prev_amount",
  "prev_duration",
  "prev_is_permanent",
  "merge_dest_prev_amount",
  "merge_dest_prev_duration",
  "merge_dest_prev_is_permanent",
]

/** The lock event types the recorded transactions hold. */
const lockTypes = [
  "LOCK_AMOUNT_INCREASED",
  "LOCK_EXTENDED",
  "LOCK_MERGED",
  "LOCK_PERMANENT",
  "LOCK_WITHDRAWN",
]

describe("liveActivity", () => {
  for (const receipt of recorded.receipts) {
    const expected = expectedOf(receipt)
    const input = inputOf(receipt)

    it(`reads ${receipt.hash.slice(0, 10)} as the copy did, from the chain`, () => {
      const before = chainBefore(expected)
      expect(live(input, { before, changed: [] })).toEqual(expected)
      // An earlier transaction in its block changed another lock.
      const other = { escrow: CONTRACTS.mainnet.veMEZO, tokenId: "999999" }
      expect(live(input, { before, changed: [other] })).toEqual(expected)
    })

    it(`keeps of ${receipt.hash.slice(0, 10)} only what holds with no lock read`, () => {
      expectWithin(live(input, null), expected)
    })

    it(`keeps of ${receipt.hash.slice(0, 10)} only what holds with no stored lock`, () => {
      const before = chainBefore(expected).map((lock) => ({
        ...lock,
        owner: null,
        amount: "0",
        end: 0,
        isPermanent: false,
      }))
      expect(live(input, { before, changed: [] })).toEqual(live(input, null))
      expectWithin(live(input, { before, changed: [] }), expected)
    })

    it(`keeps of ${receipt.hash.slice(0, 10)} only what holds when the lock read was stale`, () => {
      // An earlier transaction in its block moved the locks on: the state
      // at the block before is not this transaction's.
      const before = stale(chainBefore(expected))
      const rows = live(input, { before, changed: lockKeysOf(input) })
      expect(rows).toEqual(live(input, null))
      expectWithin(rows, expected)
    })
  }

  it("leaves out each lock event's before, never a guess", () => {
    const seen = new Set<string>()
    for (const receipt of recorded.receipts) {
      for (const row of live(inputOf(receipt), null)) {
        if (!lockTypes.includes(row.action_type)) continue
        seen.add(row.action_type)
        for (const key of priorExtras) expect(row.extra).not.toHaveProperty(key)
      }
    }
    expect([...seen].sort()).toEqual(lockTypes)
  })

  it("keeps what the events carry: an increase's amount, a merge's total, a create's whole row", () => {
    const rows = recorded.receipts.flatMap((receipt) =>
      live(inputOf(receipt), null),
    )
    const of = (type: string) => rows.find((row) => row.action_type === type)
    expect(of("LOCK_AMOUNT_INCREASED")?.amount).not.toBeNull()
    expect(of("LOCK_AMOUNT_INCREASED")?.extra).not.toHaveProperty("post_amount")
    expect(of("LOCK_MERGED")?.extra).toHaveProperty("post_amount")
    expect(of("LOCK_PERMANENT")?.extra).toMatchObject({
      post_is_permanent: true,
    })
    const created = recorded.rows.find(
      (row) => row.action_type === "LOCK_CREATED",
    )
    expect(rows.find((row) => row.id === created?.id)).toEqual(created)
  })

  it("names no actor for a poke whose lock's owner is not known, never the sender", () => {
    const poke = recorded.receipts.find((receipt) =>
      receipt.input.startsWith("0x32145f90"),
    )
    if (poke === undefined) throw new Error("no poke recorded")
    const rows = live(inputOf(poke), null)
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) expect(row.actor).toBeNull()
    const owned = live(inputOf(poke), {
      before: chainBefore(expectedOf(poke)),
      changed: [],
    })
    expect(owned.map((row) => row.actor)).toEqual(
      expectedOf(poke).map((row) => row.actor),
    )
    expect(owned[0]?.actor).not.toBe(poke.from)
  })

  // No recorded transaction unlocks a permanent lock or changes a boost:
  // made-up logs, checked against the handlers over the true prior state.
  it("keeps of an unlock and a boost change only what holds with no lock read", () => {
    const escrow = CONTRACTS.mainnet.veMEZO.toLowerCase()
    const owner = `0x${"77".repeat(20)}`
    const base = recorded.receipts[0]
    if (base === undefined) throw new Error("fixtures")
    const log = (
      name: string,
      args: Record<string, unknown>,
      index: number,
    ) => {
      const event = VOTING_ESCROW_EVENTS_ABI.find(
        (item) => item.type === "event" && item.name === name,
      ) as AbiEvent
      const data = event.inputs.filter((each) => each.indexed !== true)
      return {
        index,
        address: escrow,
        topics: encodeEventTopics({
          abi: [event],
          eventName: name,
          args,
        } as never) as Hex[],
        data: encodeAbiParameters(
          data,
          data.map((each) => args[each.name ?? ""]),
        ),
      }
    }
    const input: ReceiptInput = {
      ...inputOf(base),
      logs: [
        log(
          "UnlockPermanent",
          {
            _owner: owner,
            _tokenId: 4_242n,
            amount: 5_000n,
            _ts: BigInt(base.timestamp),
          },
          0,
        ),
        log("UpdateBoost", { _tokenId: 4_242n, _boost: 7n }, 1),
      ],
    }
    const prior: KnownLock = {
      escrow,
      tokenId: "4242",
      owner,
      amount: "5000",
      unlockAt: 0,
      isPermanent: true,
      isWithdrawn: false,
      isMerged: false,
      createdAt: null,
      activityCount: 3,
    }
    const truth = decodeReceipt(input, known, [prior]).map((row) =>
      copiedActivity(row),
    )
    expect(truth.map((row) => row.action_type)).toEqual([
      "LOCK_PERMANENT_UNLOCKED",
      "LOCK_BOOST_UPDATED",
    ])
    const rows = live(input, null)
    expectWithin(rows, truth as unknown as Row[])
    expect(rows[0]?.extra).not.toHaveProperty("prev_amount")
    expect(rows[0]?.extra).not.toHaveProperty("post_amount")
    // The unlock names the owner, so the boost change after it does too.
    expect(rows[1]?.actor).toBe(owner)
    const before: ChainLock = {
      escrow,
      tokenId: "4242",
      owner,
      amount: "5000",
      end: 0,
      isPermanent: true,
    }
    expect(live(input, { before: [before], changed: [] })).toEqual(truth)
  })
})
