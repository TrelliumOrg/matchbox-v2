import {
  CONTRACTS,
  ERC20_ABI,
  VOTER_WRITE_ABI,
  VOTING_ESCROW_WRITE_ABI,
  VOTING_REWARD_WRITE_ABI,
} from "@matchbox/chain"
import {
  type Abi,
  type Address,
  decodeFunctionData,
  encodeEventTopics,
  getAddress,
  pad,
  type TransactionReceipt,
  toHex,
  zeroAddress,
} from "viem"
import { describe, expect, it } from "vitest"
import {
  addPlan,
  autoMaxOffPlan,
  claimPlan,
  extendPlan,
  incentivesPlan,
  mergePlan,
  mintedTokenId,
  needsApproval,
  newLockPlan,
  type PlanStep,
  resetSteps,
  sendPlan,
  transferPlan,
  unlockDate,
  voteGroups,
  votePlan,
  votersFor,
  withdrawPlan,
} from "./plans"

/** The item at `index`, failing the test when it is missing. */
function nth<T>(items: readonly T[], index: number): T {
  const item = items[index]
  if (item === undefined) throw new Error(`No item ${index}`)
  return item
}

const mainnet = CONTRACTS.mainnet
const owner = getAddress("0x7c21095156ab25e989c3c084bcb06037c6539e0b")
const mezo = getAddress("0x7b7c000000000000000000000000000000000001")
const btc = getAddress("0x7b7c000000000000000000000000000000000000")
const kiln = "0x4da4c05483324ea9cfc951510a5e77cc79541159"
const vebtc604 = "0x449b06b9b6c9b649b610105d1a5e337e1d6d3d1e"
const poolGauge = "0x1111111111111111111111111111111111111111"
const pool = getAddress("0x2222222222222222222222222222222222222222")
const bribe = getAddress("0x3333333333333333333333333333333333333333")

function decode(step: PlanStep, abi: Abi, receipts = new Map()) {
  const call = step.prepare(receipts)
  return { to: call.to, ...decodeFunctionData({ abi, data: call.data }) }
}

describe("voting", () => {
  it("routes veMEZO through BoostVoter and ThirdPartyVoter, veBTC through validators and pools", () => {
    expect(votersFor("vemezo")).toEqual(["boost", "third-party"])
    expect(votersFor("vebtc")).toEqual(["validators", "pools"])
  })

  it("signs one vote per voter with relative weights", () => {
    const groups = voteGroups(
      [
        { gauge: kiln, voter: "boost", bps: 7000 },
        { gauge: vebtc604, voter: "boost", bps: 2000 },
        { gauge: poolGauge, voter: "third-party", bps: 1000 },
        { gauge: poolGauge, voter: "boost", bps: 0 },
      ],
      new Map(),
    )
    const steps = votePlan(2207n, groups)
    expect(steps.map((step) => step.label)).toEqual([
      "Vote on veBTC gauges with #2207",
      "Vote on cross-chain gauges with #2207",
    ])
    const boost = decode(nth(steps, 0), VOTER_WRITE_ABI)
    expect(boost.to).toBe(mainnet.boostVoter)
    expect(boost.functionName).toBe("vote")
    expect(boost.args).toEqual([
      2207n,
      [getAddress(kiln), getAddress(vebtc604)],
      [7000n, 2000n],
    ])
    expect(decode(nth(steps, 1), VOTER_WRITE_ABI).to).toBe(
      mainnet.thirdPartyVoter,
    )
  })

  it("votes on the pool behind a pool gauge", () => {
    const groups = voteGroups(
      [{ gauge: poolGauge, voter: "pools", bps: 10_000 }],
      new Map([[poolGauge, pool]]),
    )
    const steps = votePlan(4120n, groups)
    expect(steps[0]?.label).toBe("Vote with #4120")
    const call = decode(nth(steps, 0), VOTER_WRITE_ABI)
    expect(call.to).toBe(mainnet.poolsVoter)
    expect(call.args).toEqual([4120n, [pool], [10_000n]])
    expect(() =>
      voteGroups([{ gauge: poolGauge, voter: "pools", bps: 1 }], new Map()),
    ).toThrow(/No pool/)
  })
})

describe("claims", () => {
  it("claims bribes and pool fees per lock and voter", () => {
    const steps = claimPlan([
      {
        voter: "pools",
        kind: "bribes",
        tokenId: 4120n,
        escrow: "vebtc",
        rewards: [{ contract: bribe, tokens: [mezo] }],
      },
      {
        voter: "pools",
        kind: "fees",
        tokenId: 4120n,
        escrow: "vebtc",
        rewards: [{ contract: pool, tokens: [btc, mezo] }],
      },
      {
        voter: "boost",
        kind: "bribes",
        tokenId: 2207n,
        escrow: "vemezo",
        rewards: [],
      },
    ])
    expect(steps.map((step) => step.label)).toEqual([
      "Claim veBTC #4120, pools",
      "Claim veBTC #4120, pool fees",
    ])
    const fees = decode(nth(steps, 1), VOTER_WRITE_ABI)
    expect(fees.functionName).toBe("claimFees")
    expect(fees.args).toEqual([[pool], [[btc, mezo]], 4120n])
  })
})

describe("locks", () => {
  it("approves the exact amount only when the allowance is short", () => {
    expect(needsApproval(5n, 6n)).toBe(true)
    expect(needsApproval(6n, 6n)).toBe(false)
    const steps = addPlan({
      kind: "vemezo",
      tokenId: 2207n,
      token: mezo,
      symbol: "MEZO",
      amount: 6000n * 10n ** 18n,
      amountLabel: "6,000.00",
      allowance: 0n,
    })
    expect(steps.map((step) => [step.label, step.detail])).toEqual([
      ["Approve 6,000.00 MEZO", "Exactly this amount, nothing more"],
      ["Add to #2207", "Keeps its unlock date"],
    ])
    const approve = decode(nth(steps, 0), ERC20_ABI)
    expect(approve.to).toBe(mezo)
    expect(approve.args).toEqual([mainnet.veMEZO, 6000n * 10n ** 18n])
    expect(decode(nth(steps, 1), VOTING_ESCROW_WRITE_ABI).functionName).toBe(
      "increaseAmount",
    )
  })

  it("creates a lock, then turns on auto max for the minted id", () => {
    const steps = newLockPlan({
      kind: "vebtc",
      token: btc,
      symbol: "BTC",
      amount: 10n ** 17n,
      amountLabel: "0.1000",
      allowance: 10n ** 18n,
      duration: 2_419_200n,
      autoMax: true,
      owner,
    })
    expect(steps.map((step) => step.id)).toEqual(["create", "auto-max"])
    const create = decode(nth(steps, 0), VOTING_ESCROW_WRITE_ABI)
    expect(create.to).toBe(mainnet.veBTC)
    expect(create.args).toEqual([10n ** 17n, 2_419_200n])
    expect(() => nth(steps, 1).prepare(new Map())).toThrow(/not created/)

    const receipt = {
      logs: [
        {
          address: mainnet.veBTC,
          topics: encodeEventTopics({
            abi: VOTING_ESCROW_WRITE_ABI,
            eventName: "Transfer",
            args: { from: zeroAddress, to: owner, tokenId: 9001n },
          }),
          data: "0x",
          blockHash: pad(toHex(1)),
          blockNumber: 1n,
          logIndex: 0,
          transactionHash: pad(toHex(2)),
          transactionIndex: 0,
          removed: false,
        },
      ],
    } as unknown as TransactionReceipt
    expect(mintedTokenId(receipt, mainnet.veBTC, owner)).toBe(9001n)
    const autoMax = decode(
      nth(steps, 1),
      VOTING_ESCROW_WRITE_ABI,
      new Map([["create", receipt]]),
    )
    expect(autoMax.functionName).toBe("lockPermanent")
    expect(autoMax.args).toEqual([9001n])
  })

  it("extends, or turns on auto max instead", () => {
    expect(
      decode(
        nth(
          extendPlan({ kind: "vebtc", tokenId: 4120n, duration: 1_209_600n }),
          0,
        ),
        VOTING_ESCROW_WRITE_ABI,
      ).args,
    ).toEqual([4120n, 1_209_600n])
    expect(
      decode(
        nth(extendPlan({ kind: "vemezo", tokenId: 2207n, duration: null }), 0),
        VOTING_ESCROW_WRITE_ABI,
      ).functionName,
    ).toBe("lockPermanent")
  })

  it("turns off auto max after the reset when merging an auto max lock", () => {
    const merge = mergePlan({
      kind: "vemezo",
      from: 2930n,
      to: 2207n,
      resetVoters: ["boost"],
      autoMaxOff: true,
    })
    expect(merge.map((step) => step.id)).toEqual([
      "reset-boost",
      "auto-max-off",
      "merge",
    ])
    expect(decode(nth(merge, 1), VOTING_ESCROW_WRITE_ABI).functionName).toBe(
      "unlockPermanent",
    )
  })

  it("clears live votes before a merge or a withdraw", () => {
    const merge = mergePlan({
      kind: "vemezo",
      from: 1842n,
      to: 2207n,
      resetVoters: ["boost"],
    })
    expect(merge.map((step) => step.label)).toEqual([
      "Clear #1842 votes",
      "Merge #1842 into #2207",
    ])
    expect(decode(nth(merge, 0), VOTER_WRITE_ABI)).toMatchObject({
      to: mainnet.boostVoter,
      functionName: "reset",
      args: [1842n],
    })
    expect(decode(nth(merge, 1), VOTING_ESCROW_WRITE_ABI).args).toEqual([
      1842n,
      2207n,
    ])
    const withdraw = withdrawPlan({
      kind: "vemezo",
      tokenId: 977n,
      resetVoters: [],
    })
    expect(withdraw.map((step) => step.label)).toEqual(["Withdraw from #977"])
  })
})

describe("incentives", () => {
  const base = {
    gauge: kiln as Address,
    bribe,
    token: mezo,
    symbol: "MUSD",
    amount: 250n * 10n ** 18n,
    amountLabel: "250.00",
    allowance: 0n,
  }

  it("adds bribes through the voter", () => {
    const steps = incentivesPlan({ ...base, voter: "boost" })
    expect(decode(nth(steps, 0), ERC20_ABI).args).toEqual([
      mainnet.boostVoter,
      base.amount,
    ])
    expect(decode(nth(steps, 1), VOTER_WRITE_ABI)).toMatchObject({
      to: mainnet.boostVoter,
      functionName: "addBribes",
      args: [getAddress(kiln), [mezo], [base.amount]],
    })
  })

  it("pays a pool gauge's bribe contract directly", () => {
    const steps = incentivesPlan({ ...base, voter: "pools" })
    expect(decode(nth(steps, 0), ERC20_ABI).args).toEqual([bribe, base.amount])
    expect(decode(nth(steps, 1), VOTING_REWARD_WRITE_ABI)).toMatchObject({
      to: bribe,
      functionName: "notifyRewardAmount",
    })
  })
})

describe("custody", () => {
  it("never asks for an ERC-721 approval", () => {
    const every = [
      ...newLockPlan({
        kind: "vemezo",
        token: mezo,
        symbol: "MEZO",
        amount: 1n,
        amountLabel: "1",
        allowance: 0n,
        duration: 1n,
        autoMax: false,
        owner,
      }),
      ...mergePlan({
        kind: "vemezo",
        from: 1n,
        to: 2n,
        resetVoters: ["boost"],
      }),
      ...withdrawPlan({ kind: "vebtc", tokenId: 3n, resetVoters: ["pools"] }),
    ]
    for (const step of every) {
      const call = step.prepare(new Map())
      const escrow = [mainnet.veBTC, mainnet.veMEZO].includes(call.to)
      if (escrow) {
        expect(
          decodeFunctionData({ abi: VOTING_ESCROW_WRITE_ABI, data: call.data })
            .functionName,
        ).not.toMatch(/approv/i)
      }
    }
  })
})

describe("step subtitles", () => {
  // Thu 2 Mar 2028 00:00 UTC
  const unlock = 1_835_568_000
  const contractNames =
    /Voter|VotingEscrow|Escrow|MultiSend|BoostVoter|PoolsVoter|0x[0-9a-f]{6,}/

  it("dates unlocks the way the review shows them", () => {
    expect(unlockDate(unlock)).toBe("Thu 2 Mar 2028")
  })

  it("says what each step does in plain words", () => {
    const details = (steps: readonly PlanStep[]) =>
      steps.map((step) => step.detail)
    const groups = voteGroups(
      [
        { gauge: kiln, voter: "boost", bps: 7000 },
        { gauge: vebtc604, voter: "boost", bps: 3000 },
        { gauge: poolGauge, voter: "third-party", bps: 1000 },
      ],
      new Map(),
    )
    expect(details(votePlan(2207n, groups, { epoch: 47 }))).toEqual([
      "2 veBTC gauges, Epoch 47",
      "1 cross-chain gauge, Epoch 47",
    ])
    expect(details(votePlan(2207n, groups))).toEqual([
      "2 veBTC gauges",
      "1 cross-chain gauge",
    ])
    const claim = (
      voter: "boost" | "third-party" | "validators" | "pools",
      kind: "bribes" | "fees",
    ) => ({
      voter,
      kind,
      tokenId: 1n,
      escrow: "vemezo" as const,
      rewards: [{ contract: bribe, tokens: [mezo] }],
    })
    expect(
      details(
        claimPlan(
          [
            claim("boost", "bribes"),
            claim("third-party", "bribes"),
            claim("validators", "bribes"),
            claim("pools", "bribes"),
            claim("pools", "fees"),
          ],
          { epoch: 46 },
        ),
      ),
    ).toEqual([
      "Boost rewards from Epoch 46",
      "Cross-chain rewards from Epoch 46",
      "Validator rewards from Epoch 46",
      "Pool incentives from Epoch 46",
      "Pool fees from Epoch 46",
    ])
    const lock = {
      kind: "vemezo" as const,
      token: mezo,
      symbol: "MEZO",
      amount: 10n,
      amountLabel: "10.00",
      allowance: 0n,
      duration: 4n * 604_800n,
      autoMax: true,
      owner,
    }
    expect(details(newLockPlan({ ...lock, unlocksAt: unlock }))).toEqual([
      "Exactly this amount, nothing more",
      "Locked until Thu 2 Mar 2028",
      "Full voting power, no unlock date",
    ])
    expect(details(newLockPlan({ ...lock, autoMax: false }))).toEqual([
      "Exactly this amount, nothing more",
      "Locked for 4 weeks",
    ])
    const add = { ...lock, tokenId: 2930n, allowance: 10n }
    expect(details(addPlan({ ...add, unlocksAt: unlock }))).toEqual([
      "Locked until Thu 2 Mar 2028",
    ])
    expect(details(addPlan({ ...add, unlocksAt: "auto-max" }))).toEqual([
      "Full voting power, no unlock date",
    ])
    expect(
      details(
        extendPlan({
          kind: "vebtc",
          tokenId: 4120n,
          duration: 604_800n,
          unlocksAt: unlock,
        }),
      ),
    ).toEqual(["Unlocks Thu 2 Mar 2028"])
    expect(
      details(
        extendPlan({ kind: "vebtc", tokenId: 4120n, duration: 1_209_600n }),
      ),
    ).toEqual(["Unlocks in 2 weeks"])
    expect(
      details(extendPlan({ kind: "vemezo", tokenId: 2207n, duration: null })),
    ).toEqual(["Full voting power, no unlock date"])
    expect(details(autoMaxOffPlan({ kind: "vemezo", tokenId: 2207n }))).toEqual(
      ["Counts down from the maximum"],
    )
    expect(
      details(
        mergePlan({
          kind: "vemezo",
          from: 1842n,
          to: 2207n,
          resetVoters: ["boost", "third-party"],
        }),
      ),
    ).toEqual([
      "Removes its veBTC gauge votes",
      "Removes its cross-chain gauge votes",
      "Keeps the later unlock date",
    ])
    expect(
      details(
        withdrawPlan({
          kind: "vemezo",
          tokenId: 977n,
          resetVoters: [],
          amountLabel: "18,402.00",
          symbol: "MEZO",
        }),
      ),
    ).toEqual(["18,402.00 MEZO back to your wallet"])
    expect(
      details(
        incentivesPlan({
          voter: "boost",
          gauge: getAddress(kiln),
          bribe,
          token: mezo,
          symbol: "MUSD",
          amount: 1n,
          amountLabel: "1.00",
          allowance: 1n,
          gaugeName: "Kiln Labs",
          epoch: 47,
        }),
      ),
    ).toEqual(["Paid to Kiln Labs voters, Epoch 47"])
    expect(
      details(sendPlan({ token: "BTC", to: owner, amount: 10n ** 17n })),
    ).toEqual(["To 0x7C21…9e0B"])
  })

  it("never names a contract under a step", () => {
    const every = [
      ...votePlan(
        1n,
        voteGroups([{ gauge: kiln, voter: "boost", bps: 1 }], new Map()),
      ),
      ...resetSteps(1n, ["boost", "pools", "validators", "third-party"]),
      ...mergePlan({ kind: "vebtc", from: 1n, to: 2n, resetVoters: [] }),
      ...withdrawPlan({ kind: "vebtc", tokenId: 1n, resetVoters: [] }),
      ...extendPlan({ kind: "vebtc", tokenId: 1n, duration: 604_800n }),
      ...autoMaxOffPlan({ kind: "vebtc", tokenId: 1n }),
      ...incentivesPlan({
        voter: "pools",
        gauge: getAddress(poolGauge),
        bribe,
        token: mezo,
        symbol: "MEZO",
        amount: 2n,
        amountLabel: "2",
        allowance: 0n,
      }),
    ]
    for (const step of every) expect(step.detail).not.toMatch(contractNames)
  })
})

describe("send", () => {
  it("sends an ERC-20 with transfer", () => {
    const steps = sendPlan({
      token: { address: mezo, symbol: "MEZO", decimals: 18 },
      to: owner,
      amount: 6000n * 10n ** 18n,
    })
    expect(steps.map((step) => step.label)).toEqual(["Send 6,000.00 MEZO"])
    expect(decode(nth(steps, 0), ERC20_ABI)).toMatchObject({
      to: mezo,
      functionName: "transfer",
      args: [owner, 6000n * 10n ** 18n],
    })
    expect(nth(steps, 0).prepare(new Map()).value).toBeUndefined()
  })

  it("sends native BTC as a value transfer with no calldata", () => {
    const steps = sendPlan({ token: "BTC", to: owner, amount: 10n ** 17n })
    expect(steps[0]?.label).toBe("Send 0.1000 BTC")
    expect(nth(steps, 0).prepare(new Map())).toMatchObject({
      to: owner,
      data: "0x",
      value: 10n ** 17n,
    })
  })
})

describe("transfer", () => {
  const recipient = getAddress("0x1234567890123456789012345678901234567890")

  it("is one safeTransferFrom with its votes, never an approve", () => {
    const steps = transferPlan({
      kind: "vemezo",
      tokenId: 2207n,
      from: owner,
      to: recipient,
    })
    expect(steps.map((step) => [step.label, step.detail])).toEqual([
      ["Transfer veMEZO #2207", "To 0x1234…7890"],
    ])
    expect(decode(nth(steps, 0), VOTING_ESCROW_WRITE_ABI)).toMatchObject({
      to: mainnet.veMEZO,
      functionName: "safeTransferFrom",
      args: [owner, recipient, 2207n],
    })
    expect(steps[0]?.prepare(new Map()).data.slice(0, 10)).not.toBe(
      "0x095ea7b3",
    )
  })

  it("uses the lock's escrow", () => {
    const steps = transferPlan({
      kind: "vebtc",
      tokenId: 4120n,
      from: owner,
      to: recipient,
    })
    expect(decode(nth(steps, 0), VOTING_ESCROW_WRITE_ABI).to).toBe(
      mainnet.veBTC,
    )
  })
})

describe("auto max off", () => {
  it("calls unlockPermanent on the lock's escrow", () => {
    const steps = autoMaxOffPlan({
      kind: "vemezo",
      tokenId: 2207n,
      unlocksAt: 1_835_568_000,
    })
    expect(steps[0]?.detail).toBe("Unlocks Thu 2 Mar 2028")
    expect(decode(nth(steps, 0), VOTING_ESCROW_WRITE_ABI)).toMatchObject({
      to: mainnet.veMEZO,
      functionName: "unlockPermanent",
      args: [2207n],
    })
  })
})
