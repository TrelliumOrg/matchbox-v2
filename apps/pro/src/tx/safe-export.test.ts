import { getAddress, keccak256, stringToHex } from "viem"
import { describe, expect, it } from "vitest"
import { z } from "zod"
import {
  addPlan,
  autoMaxOffPlan,
  claimPlan,
  extendPlan,
  incentivesPlan,
  mergePlan,
  newLockPlan,
  type PlanStep,
  sendPlan,
  transferPlan,
  voteGroups,
  votePlan,
  withdrawPlan,
} from "./plans"
import {
  type SafeBatchFile,
  safeBatchChecksum,
  safeExport,
  safeExportFileName,
} from "./safe-export"

const owner = getAddress("0x7c21095156ab25e989c3c084bcb06037c6539e0b")
const safe = getAddress("0x5afe000000000000000000000000000000005afe")
const mezo = getAddress("0x7b7c000000000000000000000000000000000001")
const bribe = getAddress("0x3333333333333333333333333333333333333333")
const pool = getAddress("0x2222222222222222222222222222222222222222")
const kiln = "0x4da4c05483324ea9cfc951510a5e77cc79541159"
const poolGauge = "0x1111111111111111111111111111111111111111"

/** What the wallet path signs: the same prepare(), in plan order. */
function walletCalls(steps: readonly PlanStep[]) {
  return steps.map((step) => {
    const call = step.prepare(new Map())
    return {
      to: getAddress(call.to),
      value: (call.value ?? 0n).toString(),
      data: call.data,
    }
  })
}

function exported(steps: readonly PlanStep[]) {
  return safeExport({ steps, name: "Matchbox Pro test", createdAt: 1 })
}

const flows: Record<string, PlanStep[]> = {
  vote: votePlan(
    2207n,
    voteGroups([{ gauge: kiln, voter: "boost", bps: 10_000 }], new Map()),
  ),
  "vote, two voters and two locks": [2930n, 3011n].flatMap((tokenId) =>
    votePlan(
      tokenId,
      voteGroups(
        [
          { gauge: kiln, voter: "boost", bps: 6000 },
          { gauge: kiln, voter: "third-party", bps: 4000 },
        ],
        new Map(),
      ),
    ).map((step) => ({ ...step, id: `lock-${tokenId}:${step.id}` })),
  ),
  "vote on pools": votePlan(
    4120n,
    voteGroups(
      [{ gauge: poolGauge, voter: "pools", bps: 10_000 }],
      new Map([[poolGauge, pool]]),
    ),
  ),
  claim: claimPlan([
    {
      voter: "pools",
      kind: "fees",
      tokenId: 4120n,
      escrow: "vebtc",
      rewards: [{ contract: pool, tokens: [mezo] }],
    },
    {
      voter: "boost",
      kind: "bribes",
      tokenId: 2207n,
      escrow: "vemezo",
      rewards: [{ contract: bribe, tokens: [mezo] }],
    },
  ]),
  "new lock": newLockPlan({
    kind: "vemezo",
    token: mezo,
    symbol: "MEZO",
    amount: 10n,
    amountLabel: "10.00",
    allowance: 0n,
    duration: 604_800n,
    autoMax: false,
    owner,
  }),
  add: addPlan({
    kind: "vemezo",
    tokenId: 2207n,
    token: mezo,
    symbol: "MEZO",
    amount: 6n,
    amountLabel: "6.00",
    allowance: 0n,
  }),
  extend: extendPlan({ kind: "vebtc", tokenId: 4120n, duration: 1_209_600n }),
  "auto max on": extendPlan({ kind: "vemezo", tokenId: 2207n, duration: null }),
  "auto max off": autoMaxOffPlan({ kind: "vemezo", tokenId: 2207n }),
  merge: mergePlan({
    kind: "vemezo",
    from: 1842n,
    to: 2207n,
    resetVoters: ["boost", "third-party"],
  }),
  withdraw: withdrawPlan({
    kind: "vebtc",
    tokenId: 977n,
    resetVoters: ["pools"],
  }),
  incentives: incentivesPlan({
    voter: "boost",
    gauge: getAddress(kiln),
    bribe,
    token: mezo,
    symbol: "MUSD",
    amount: 250n,
    amountLabel: "250.00",
    allowance: 0n,
  }),
  "pool incentives": incentivesPlan({
    voter: "pools",
    gauge: getAddress(poolGauge),
    bribe,
    token: mezo,
    symbol: "MUSD",
    amount: 250n,
    amountLabel: "250.00",
    allowance: 1000n,
  }),
  "send token": sendPlan({
    token: { address: mezo, symbol: "MEZO", decimals: 18 },
    to: safe,
    amount: 3n,
  }),
  "send BTC": sendPlan({ token: "BTC", to: safe, amount: 10n ** 17n }),
  transfer: transferPlan({
    kind: "vemezo",
    tokenId: 2207n,
    from: owner,
    to: safe,
  }),
}

const hex = z.custom<`0x${string}`>(
  (value) => typeof value === "string" && /^0x[0-9a-fA-F]*$/.test(value),
)

/** The file as Transaction Builder reads it back. */
const batchFileSchema = z.object({
  version: z.literal("1.0"),
  chainId: z.string(),
  createdAt: z.number(),
  meta: z.object({
    name: z.string(),
    description: z.string(),
    txBuilderVersion: z.string().optional(),
    createdFromSafeAddress: z.string().optional(),
    checksum: hex.optional(),
  }),
  transactions: z.array(z.object({ to: hex, value: z.string(), data: hex })),
})

describe("Export for Safe", () => {
  for (const [name, steps] of Object.entries(flows)) {
    it(`exports ${name} with the wallet's exact calldata`, () => {
      const result = exported(steps)
      expect(result.file.transactions).toEqual(walletCalls(steps))
      expect(result.skipped).toEqual([])
      expect(result.note).toBeNull()
    })
  }

  it("writes the Transaction Builder file for chain 31612", () => {
    const steps = flows.add ?? []
    const { file } = safeExport({
      steps,
      name: "Matchbox Pro add",
      safe: safe.toLowerCase(),
      createdAt: 1_794_200_000_000,
    })
    expect(file).toMatchObject({
      version: "1.0",
      chainId: "31612",
      createdAt: 1_794_200_000_000,
      meta: {
        name: "Matchbox Pro add",
        description: "Approve 6.00 MEZO, Add to #2207",
        createdFromSafeAddress: safe,
      },
    })
    expect(file.meta.txBuilderVersion).toBeUndefined()
  })

  it("leaves out a step that needs the new lock id, and says when", () => {
    const steps = newLockPlan({
      kind: "vemezo",
      token: mezo,
      symbol: "MEZO",
      amount: 10n,
      amountLabel: "10.00",
      allowance: 0n,
      duration: 604_800n,
      autoMax: true,
      owner,
    })
    const result = exported(steps)
    expect(result.file.transactions).toEqual(walletCalls(steps.slice(0, 2)))
    expect(result.skipped).toEqual([{ step: 3, label: "Turn on auto max" }])
    expect(result.note).toBe(
      "Step 3 needs the new lock id: export it after step 2 lands",
    )
  })

  it("carries the checksum Transaction Builder validates", () => {
    const { file } = exported(flows.merge ?? [])
    // Round trip through JSON, as the builder reads the dropped file.
    const read: SafeBatchFile = batchFileSchema.parse(
      JSON.parse(JSON.stringify(file)),
    )
    const checksum = read.meta.checksum
    expect(checksum).toMatch(/^0x[0-9a-f]{64}$/)
    expect(safeBatchChecksum(read)).toBe(checksum)
    // The builder ignores the name, and nothing else.
    expect(
      safeBatchChecksum({ ...read, meta: { ...read.meta, name: "Renamed" } }),
    ).toBe(checksum)
    expect(
      safeBatchChecksum({ ...read, createdAt: read.createdAt + 1 }),
    ).not.toBe(checksum)
  })

  it("serializes exactly as tx-builder's checksum.ts does", () => {
    const file: SafeBatchFile = {
      version: "1.0",
      chainId: "31612",
      createdAt: 1,
      meta: { name: "x", description: "y" },
      transactions: [{ to: safe, value: "0", data: "0x" }],
    }
    const serialized =
      `{["chainId","createdAt","meta","transactions","version"]"31612",1,` +
      `{["description","name"]"y",null,},` +
      `[{["data","to","value"]"0x","${safe}","0",}],"1.0",}`
    expect(safeBatchChecksum(file)).toBe(keccak256(stringToHex(serialized)))
  })

  it("names the file by flow and day", () => {
    expect(safeExportFileName("vote", new Date("2026-11-09T03:00:00Z"))).toBe(
      "vote-2026-11-09.json",
    )
  })
})
