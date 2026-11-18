import { CONTRACTS } from "@matchbox/chain"
import { describe, expect, it } from "vitest"
import {
  type ActivityInput,
  describeActivity,
  describedActions,
  escrowOf,
  lockName,
  type SentenceText,
  sentenceText,
} from "./activity"

const vebtc = CONTRACTS.mainnet.veBTC.toLowerCase()
const vemezo = CONTRACTS.mainnet.veMEZO.toLowerCase()
const gauge = `0x${"9a".repeat(20)}`
const pool = `0x${"90".repeat(20)}`
const btc = "0x7b7c000000000000000000000000000000000000"

function row(
  action: string,
  fields: Partial<ActivityInput> = {},
): ActivityInput {
  return {
    action_type: action,
    timestamp: 1_794_000_000,
    epoch_start: 1_793_836_800,
    actor: null,
    recipient: null,
    lock_escrow: vebtc,
    token_id: "604",
    amount: null,
    token: null,
    gauge: null,
    pool: null,
    weight: null,
    extra: {},
    ...fields,
  }
}

const names: SentenceText = {
  amount: (amount, token) => `${amount} ${token === btc ? "BTC" : "?"}`,
  votes: (weight, escrow) =>
    `${weight} ${escrow === "vemezo" ? "veMEZO" : "veBTC"}`,
  gauge: () => "Kiln Labs",
  pool: () => "BTC/MUSD",
  address: (address) => address,
  date: (at) => `day ${at}`,
  epoch: () => "Epoch 47",
}

const say = (input: ActivityInput | null, method: string | null = null) =>
  sentenceText(describeActivity(input, method), names)

describe("activity sentences", () => {
  it("names the escrow's locked token when a lock row names none", () => {
    // The indexer records no token on an escrow's rows.
    expect(say(row("LOCK_AMOUNT_INCREASED", { amount: "2" }))).toBe(
      "Added 2 BTC to veBTC #604",
    )
    const mezo = CONTRACTS.mainnet.mezoToken.toLowerCase()
    const sentence = describeActivity(
      row("LOCK_CREATED", { amount: "5", lock_escrow: vemezo }),
    )
    expect(sentence.segments).toContainEqual({
      kind: "amount",
      amount: "5",
      token: mezo,
    })
    // Anything else keeps an unknown token unknown.
    expect(
      describeActivity(row("INCENTIVE_ADDED", { amount: "9", gauge })).segments,
    ).toContainEqual({ kind: "amount", amount: "9", token: null })
  })

  it("says what a lock action did", () => {
    expect(say(row("LOCK_CREATED", { amount: "5", token: btc }))).toBe(
      "Locked 5 BTC in veBTC #604",
    )
    expect(say(row("LOCK_AMOUNT_INCREASED", { amount: "2", token: btc }))).toBe(
      "Added 2 BTC to veBTC #604",
    )
    expect(say(row("LOCK_WITHDRAWN", { amount: "7", token: btc }))).toBe(
      "Withdrew 7 BTC from veBTC #604",
    )
    expect(say(row("LOCK_PERMANENT"))).toBe("Set veBTC #604 to auto max")
    expect(say(row("LOCK_PERMANENT_UNLOCKED"))).toBe(
      "Turned off auto max on veBTC #604",
    )
  })

  it("gives an extension's new unlock date when it is known", () => {
    expect(
      say(row("LOCK_EXTENDED", { extra: { post_duration: "86400" } })),
    ).toBe("Extended veBTC #604 until day 1794086400")
    expect(say(row("LOCK_EXTENDED"))).toBe("Extended veBTC #604")
  })

  it("names both locks of a merge", () => {
    expect(
      say(
        row("LOCK_MERGED", {
          lock_escrow: vemezo,
          extra: { merge_source_token_id: "12", merge_dest_token_id: "34" },
        }),
      ),
    ).toBe("Merged veMEZO #12 into veMEZO #34")
  })

  it("says who a vote went to, in the lock's unit", () => {
    expect(
      say(row("BOOST_VOTE", { lock_escrow: vemezo, weight: "10", gauge })),
    ).toBe("Voted 10 veMEZO for Kiln Labs with veMEZO #604")
    expect(say(row("BOOST_ABSTAIN"))).toBe("Reset votes on veBTC #604")
    expect(say(row("BOOST_POKE"))).toBe("Refreshed votes on veBTC #604")
  })

  it("ends no sentence on a preposition when the row names no lock", () => {
    // As the live indexer writes pokes: no lock, no gauge, no actor.
    const bare = { token_id: null }
    expect(say(row("BOOST_POKE", bare))).toBe("Refreshed votes")
    // The BoostVoter names the veBTC lock it poked in extra.
    expect(
      say(
        row("BOOST_POKE", {
          ...bare,
          lock_escrow: null,
          extra: { boostable_token_id: "6114" },
        }),
      ),
    ).toBe("Refreshed votes on veBTC #6114")
    expect(say(row("BOOST_ABSTAIN", bare))).toBe("Reset votes")
    expect(say(row("LOCK_PERMANENT_UNLOCKED", bare))).toBe(
      "Turned off auto max",
    )
    expect(
      say(row("LOCK_AMOUNT_INCREASED", { ...bare, amount: "2", token: btc })),
    ).toBe("Added 2 BTC")
    expect(
      say(row("LOCK_WITHDRAWN", { ...bare, amount: "2", token: btc })),
    ).toBe("Withdrew 2 BTC")
  })

  it("separates incentives from fees", () => {
    expect(say(row("VOTE_BRIBE_CLAIMED", { amount: "3", token: btc }))).toBe(
      "Claimed 3 BTC in incentives for veBTC #604",
    )
    expect(say(row("VOTE_FEE_CLAIMED", { amount: "3", token: btc }))).toBe(
      "Claimed 3 BTC in fees for veBTC #604",
    )
    expect(
      say(
        row("INCENTIVE_ADDED", {
          amount: "9",
          token: btc,
          gauge,
          token_id: null,
        }),
      ),
    ).toBe("Added 9 BTC in incentives to Kiln Labs")
  })

  it("covers gauges, pools, swaps and epochs", () => {
    expect(say(row("GAUGE_KILLED", { gauge }))).toBe("Stopped gauge Kiln Labs")
    expect(say(row("GAUGE_REVIVED", { gauge }))).toBe("Revived gauge Kiln Labs")
    expect(say(row("POOL_CREATED", { pool }))).toBe("Created pool BTC/MUSD")
    expect(say(row("SWAP", { amount: "1", token: btc, pool }))).toBe(
      "Swapped 1 BTC in BTC/MUSD",
    )
    expect(say(row("EPOCH_PROCESSED"))).toBe("Started Epoch 47")
  })

  it("words liquidity, gauge rewards, rebases and savings", () => {
    const mezo = CONTRACTS.mainnet.mezoToken.toLowerCase()
    const tokenName = (amount: string, token: string | null) =>
      `${amount} ${token === mezo ? "MEZO" : token === btc ? "BTC" : "MUSD"}`
    const sayIn = (input: ActivityInput) =>
      sentenceText(describeActivity(input), { ...names, amount: tokenName })
    expect(say(row("LP_ADDED", { amount: "5", pool }))).toBe(
      "Added liquidity to BTC/MUSD",
    )
    expect(say(row("LP_REMOVED", { pool }))).toBe(
      "Removed liquidity from BTC/MUSD",
    )
    expect(say(row("LP_STAKED", { gauge }))).toBe(
      "Staked liquidity in Kiln Labs",
    )
    expect(say(row("LP_UNSTAKED", { gauge }))).toBe(
      "Unstaked liquidity from Kiln Labs",
    )
    // A gauge paying its staker, in MEZO emissions.
    expect(
      sayIn(
        row("REWARD_DISTRIBUTED", {
          amount: "26",
          gauge,
          extra: { reward_type: "Gauge" },
        }),
      ),
    ).toBe("Claimed 26 MEZO from Kiln Labs")
    // A voter sending a gauge its emissions.
    expect(sayIn(row("REWARD_DISTRIBUTED", { amount: "9", gauge }))).toBe(
      "Distributed 9 MEZO in emissions to Kiln Labs",
    )
    expect(
      sayIn(row("REBASE_CLAIMED", { amount: "9", lock_escrow: vemezo })),
    ).toBe("Claimed 9 MEZO in rebase for veMEZO #604")
    expect(sayIn(row("MERKLE_CLAIMED", { amount: "137" }))).toBe(
      "Claimed 137 MEZO in rewards",
    )
    expect(sayIn(row("SAVINGS_DEPOSIT", { amount: "1258" }))).toBe(
      "Deposited 1258 MUSD in savings",
    )
    expect(sayIn(row("SAVINGS_WITHDRAW", { amount: "12" }))).toBe(
      "Withdrew 12 MUSD from savings",
    )
    expect(sayIn(row("SAVINGS_YIELD_CLAIMED", { amount: "3" }))).toBe(
      "Claimed 3 MUSD in savings yield",
    )
    // Without an amount these fall back to the method.
    expect(say(row("SAVINGS_DEPOSIT"), "deposit")).toBe("Called deposit")
  })

  it("words lock transfers to the new owner", () => {
    // The indexer keeps the new owner as the actor.
    const owner = `0x${"aa".repeat(20)}`
    expect(
      say(row("LOCK_TRANSFERRED", { actor: owner, recipient: gauge })),
    ).toBe(`Transferred veBTC #604 to ${owner}`)
    // On the new owner's own list: received, from the old owner.
    expect(
      sentenceText(
        describeActivity(
          row("LOCK_TRANSFERRED", { actor: owner, recipient: gauge }),
          null,
          owner,
        ),
        names,
      ),
    ).toBe(`Received veBTC #604 from ${gauge}`)
    expect(say(row("LOCK_BOOST_UPDATED"))).toBe("Updated boost on veBTC #604")
    expect(say(row("GAUGE_CREATED", { gauge }))).toBe("Created gauge Kiln Labs")
  })

  it("falls back to the decoded method, then to a contract call", () => {
    expect(say(row("SOMETHING_NEW"), "execute")).toBe("Called execute")
    expect(say(null, "openPosition")).toBe("Called openPosition")
    expect(say(null, "  ")).toBe("Contract call")
    expect(say(null)).toBe("Contract call")
    expect(describeActivity(null, "execute").key).toBe("method")
  })

  it("falls back when a row lacks what its sentence needs", () => {
    expect(say(row("LOCK_CREATED"), "createLock")).toBe("Called createLock")
    expect(say(row("LOCK_MERGED"), "merge")).toBe("Called merge")
    expect(say(row("GAUGE_KILLED"), "killGauge")).toBe("Called killGauge")
  })

  it("never puts dashes or semicolons in a sentence", () => {
    for (const action of describedActions) {
      const sentence = describeActivity(
        row(action, {
          amount: "1",
          token: btc,
          gauge,
          pool,
          weight: "1",
          extra: { merge_source_token_id: "1", merge_dest_token_id: "2" },
        }),
      )
      expect(sentence.key).toBe(action)
      expect(sentenceText(sentence, names)).not.toMatch(/[;–—]/)
    }
  })

  it("knows the escrows", () => {
    expect(escrowOf(CONTRACTS.mainnet.veBTC)).toBe("vebtc")
    expect(escrowOf(vemezo)).toBe("vemezo")
    expect(escrowOf(gauge)).toBeNull()
    expect(lockName(null, "5")).toBe("lock #5")
  })
})
