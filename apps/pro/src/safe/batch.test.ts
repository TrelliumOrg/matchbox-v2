import {
  CONTRACTS,
  ERC20_ABI,
  MULTI_SEND_CALL_ONLY_ABI,
  SAFE_CONTRACTS,
  VOTING_ESCROW_WRITE_ABI,
} from "@matchbox/chain"
import {
  type Address,
  decodeFunctionData,
  encodeEventTopics,
  getAddress,
  type Hex,
  hexToBigInt,
  hexToNumber,
  pad,
  sliceHex,
  type TransactionReceipt,
  toHex,
  zeroAddress,
} from "viem"
import { describe, expect, it } from "vitest"
import {
  addPlan,
  claimPlan,
  newLockPlan,
  type PlanStep,
  sendPlan,
  voteGroups,
  votePlan,
} from "../tx/plans"
import {
  encodeMultiSend,
  exportSplitCopy,
  proposalSplitCopy,
  safeCallFor,
  splitForSafe,
} from "./batch"

const mainnet = CONTRACTS.mainnet
const safe = getAddress("0x5afe000000000000000000000000000000005afe")
const mezo = getAddress("0x7b7c000000000000000000000000000000000001")
const bribe = getAddress("0x3333333333333333333333333333333333333333")
const kiln = "0x4da4c05483324ea9cfc951510a5e77cc79541159"

type Packed = { operation: number; to: Address; value: bigint; data: Hex }

/** Reads MultiSend's packed transactions back, independently of the encoder. */
function unpack(calldata: Hex): Packed[] {
  const { functionName, args } = decodeFunctionData({
    abi: MULTI_SEND_CALL_ONLY_ABI,
    data: calldata,
  })
  expect(functionName).toBe("multiSend")
  const bytes = args[0]
  const out: Packed[] = []
  let at = 0
  const length = (bytes.length - 2) / 2
  while (at < length) {
    const operation = hexToNumber(sliceHex(bytes, at, at + 1))
    const to = getAddress(sliceHex(bytes, at + 1, at + 21))
    const value = hexToBigInt(sliceHex(bytes, at + 21, at + 53))
    const size = Number(hexToBigInt(sliceHex(bytes, at + 53, at + 85)))
    const data = size === 0 ? "0x" : sliceHex(bytes, at + 85, at + 85 + size)
    out.push({ operation, to, value, data })
    at += 85 + size
  }
  return out
}

function wallet(steps: readonly PlanStep[], receipts = new Map()) {
  return steps.map((step) => {
    const call = step.prepare(receipts)
    return {
      operation: 0,
      to: call.to,
      value: call.value ?? 0n,
      data: call.data,
    }
  })
}

const claimAndRelock = [
  ...claimPlan([
    {
      voter: "boost",
      kind: "bribes",
      tokenId: 2930n,
      escrow: "vemezo",
      rewards: [{ contract: bribe, tokens: [mezo] }],
    },
  ]),
  ...addPlan({
    kind: "vemezo",
    tokenId: 2930n,
    token: mezo,
    symbol: "MEZO",
    amount: 958n * 10n ** 18n,
    amountLabel: "958.00",
    allowance: 0n,
  }).map((step) => ({ ...step, id: `relock-${step.id}` })),
]

describe("MultiSend batch", () => {
  it("packs claim, approve and relock as one DELEGATECALL batch", () => {
    const { now, gap } = splitForSafe(claimAndRelock)
    expect(gap).toBeNull()
    const call = safeCallFor(now.map((each) => each.call))
    expect(call.to).toBe(SAFE_CONTRACTS.mainnet.multiSendCallOnly)
    expect(call.operation).toBe(1)
    expect(call.value).toBe(0n)
    expect(unpack(call.data)).toEqual(wallet(claimAndRelock))
    const approve = decodeFunctionData({
      abi: ERC20_ABI,
      data: unpack(call.data)[1]?.data ?? "0x",
    })
    expect(approve.args).toEqual([mainnet.veMEZO, 958n * 10n ** 18n])
  })

  it("batches a vote across two locks", () => {
    const groups = voteGroups(
      [
        { gauge: kiln, voter: "boost", bps: 7000 },
        { gauge: kiln, voter: "third-party", bps: 3000 },
      ],
      new Map(),
    )
    const steps = [2930n, 3011n].flatMap((tokenId) =>
      votePlan(tokenId, groups).map((step) => ({
        ...step,
        id: `lock-${tokenId}:${step.id}`,
      })),
    )
    const { now } = splitForSafe(steps)
    expect(now).toHaveLength(4)
    expect(unpack(safeCallFor(now.map((each) => each.call)).data)).toEqual(
      wallet(steps),
    )
  })

  it("keeps a native BTC value on its inner call", () => {
    const steps = [
      ...sendPlan({ token: "BTC", to: safe, amount: 5n }),
      ...sendPlan({
        token: { address: mezo, symbol: "MEZO", decimals: 18 },
        to: safe,
        amount: 7n,
      }),
    ]
    const packed = unpack(
      encodeMultiSend(steps.map((s) => s.prepare(new Map()))),
    )
    expect(packed[0]).toEqual({ operation: 0, to: safe, value: 5n, data: "0x" })
    expect(packed[1]?.value).toBe(0n)
  })

  it("sends a single call directly, without MultiSend", () => {
    const steps = sendPlan({ token: "BTC", to: safe, amount: 5n })
    expect(safeCallFor(steps.map((s) => s.prepare(new Map())))).toEqual({
      to: safe,
      value: 5n,
      data: "0x",
      operation: 0,
    })
  })
})

describe("splitting", () => {
  const lock = newLockPlan({
    kind: "vemezo",
    token: mezo,
    symbol: "MEZO",
    amount: 10n,
    amountLabel: "10.00",
    allowance: 0n,
    duration: 604_800n,
    autoMax: true,
    owner: safe,
  })

  it("splits only where a step needs the minted lock id", () => {
    const batches = splitForSafe(lock)
    expect(batches.now.map((each) => each.step.id)).toEqual([
      "approve",
      "create",
    ])
    expect(batches.later.map((each) => each.index)).toEqual([2])
    expect(proposalSplitCopy(batches)).toBe(
      "2 Safe transactions, step 3 needs the new lock id",
    )
    expect(exportSplitCopy(batches)).toBe(
      "Step 3 needs the new lock id: export it after step 2 lands",
    )
  })

  it("computes the rest once the first proposal executed", () => {
    const receipt = {
      logs: [
        {
          address: mainnet.veMEZO,
          topics: encodeEventTopics({
            abi: VOTING_ESCROW_WRITE_ABI,
            eventName: "Transfer",
            args: { from: zeroAddress, to: safe, tokenId: 6033n },
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
    const receipts = new Map([
      ["approve", receipt],
      ["create", receipt],
    ])
    const next = splitForSafe(lock, receipts, 2)
    expect(next.gap).toBeNull()
    expect(next.now).toHaveLength(1)
    const call = safeCallFor(next.now.map((each) => each.call))
    expect(call.operation).toBe(0)
    expect(
      decodeFunctionData({ abi: VOTING_ESCROW_WRITE_ABI, data: call.data }),
    ).toMatchObject({ functionName: "lockPermanent", args: [6033n] })
  })
})
