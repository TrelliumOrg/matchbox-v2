import {
  encodeAbiParameters,
  encodePacked,
  keccak256,
  parseAbiParameters,
  toHex,
} from "viem"
import { describe, expect, it } from "vitest"
import {
  BTC_TOKEN,
  createChainActivity,
  cursorQuery,
  idTopic,
  multiSendCalls,
  normalizeNftMoves,
  parseDistributorClaim,
  parseLockEvent,
  parseSafeNative,
} from "./chainActivity"

// Escrow events, distributor claims, lock NFT moves and native BTC read
// from a Safe's own events.

const SAFE = "0xf36593cd2e5eb2cc8ccbe5ad3b5bb2353cf98bc4"
const ENCLAVE = "0x147379a0174780570d07d70a14fb244ee5f2d786"
const VEMEZO = "0xb90fdad3dfd180458d62cc6acedc983d78e20122"
const REBASE = "0x075108f275ed81c9cfc01065e6e50ceea81d6363"
const OPS_SAFE = "0xc62b9391cc427dd8dc919365c80282a601623ffc"
const FUNDED = "0x5959ad00d315a81c57b06516e794b82261440965"
const MULTISEND = "0x40a2accbd92bca938b02010e17a5b8929b49130d"
const MUSDC = "0x04671c72aab5ac02a03c1098314b1bb6b560c197"
const E18 = 10n ** 18n

function ref(hash: string) {
  return {
    hash,
    name: null,
    is_contract: true,
    is_verified: false,
    implementations: [],
  }
}

function word(value: bigint | string): string {
  const hex = typeof value === "bigint" ? value.toString(16) : value.slice(2)
  return `0x${hex.toLowerCase().padStart(64, "0")}`
}

function log(input: {
  address: string
  topics: string[]
  data: string
  tx?: string
  block?: number
  index?: number
  at?: string | null
}) {
  return {
    transaction_hash: input.tx ?? `0x${"ab".repeat(32)}`,
    block_number: input.block ?? 13_000_000,
    block_timestamp:
      input.at === null ? null : (input.at ?? "2026-11-03T10:00:00.000000Z"),
    block_hash: null,
    index: input.index ?? 1,
    address: ref(input.address),
    topics: input.topics,
    data: input.data,
    decoded: null,
  }
}

const TOPIC = {
  deposit: keccak256(
    toHex("Deposit(address,uint256,uint8,uint256,uint256,uint256)"),
  ),
  transfer: keccak256(toHex("Transfer(address,address,uint256)")),
  claimed: keccak256(toHex("Claimed(uint256,uint256,uint256,uint256)")),
  safeTx: keccak256(
    toHex(
      "SafeMultiSigTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes,bytes)",
    ),
  ),
  failure: keccak256(toHex("ExecutionFailure(bytes32,uint256)")),
  executed: keccak256(toHex("ExecutionSuccess(bytes32,uint256)")),
  module: keccak256(toHex("ExecutionFromModuleSuccess(address)")),
}

function safeTxData(input: {
  to: string
  value: bigint
  data: string
  operation: number
}): string {
  return encodeAbiParameters(
    parseAbiParameters(
      "address, uint256, bytes, uint8, uint256, uint256, uint256, address, address, bytes, bytes",
    ),
    [
      input.to as `0x${string}`,
      input.value,
      input.data as `0x${string}`,
      input.operation,
      0n,
      0n,
      0n,
      "0x0000000000000000000000000000000000000000",
      "0x0000000000000000000000000000000000000000",
      "0x",
      "0x",
    ],
  )
}

/** multiSend(bytes) of packed (operation, to, value, length, data) calls. */
function multiSend(
  calls: Array<{ operation: number; to: string; value: bigint; data: string }>,
): string {
  const packed = calls
    .map((call) =>
      encodePacked(
        ["uint8", "address", "uint256", "uint256", "bytes"],
        [
          call.operation,
          call.to as `0x${string}`,
          call.value,
          BigInt((call.data.length - 2) / 2),
          call.data as `0x${string}`,
        ],
      ).slice(2),
    )
    .join("")
  const encoded = encodeAbiParameters([{ type: "bytes" }], [`0x${packed}`])
  return `0x8d80ff0a${encoded.slice(2)}`
}

function chainWith(pages: (path: string) => unknown) {
  const paths: string[] = []
  const chain = createChainActivity({
    blockscout: async (path, schema) => {
      paths.push(path)
      const parsed = schema.safeParse(pages(path))
      return parsed.success
        ? { status: "ok", data: parsed.data }
        : { status: "unavailable" }
    },
    scan: async () => ({ status: "unavailable" }),
    rpc: null,
  })
  return { chain, paths }
}

describe("escrow and distributor logs", () => {
  it("reads a lock deposit and a mint from escrow events", () => {
    const deposit = parseLockEvent(
      log({
        address: VEMEZO,
        topics: [TOPIC.deposit, word(SAFE), word(2930n), word(1n)],
        data: `${word(500_000n * E18)}${word(1n).slice(2)}${word(2n).slice(2)}`,
      }),
    )
    expect(deposit).toMatchObject({
      kind: "deposit",
      provider: SAFE,
      tokenId: "2930",
      value: 500_000n * E18,
      at: Date.parse("2026-11-03T10:00:00Z") / 1000,
    })
    const mint = parseLockEvent(
      log({
        address: VEMEZO,
        topics: [TOPIC.transfer, word(0n), word(FUNDED), word(2930n)],
        data: "0x",
        at: null,
      }),
    )
    expect(mint).toMatchObject({
      kind: "transfer",
      from: "0x0000000000000000000000000000000000000000",
      to: FUNDED,
      tokenId: "2930",
      at: null,
    })
    // An ERC-20 Transfer (three topics) is not a lock event.
    expect(
      parseLockEvent(
        log({
          address: VEMEZO,
          topics: [TOPIC.transfer, word(SAFE), word(FUNDED)],
          data: word(1n),
        }),
      ),
    ).toBeNull()
  })

  it("reads a distributor claim for a lock", () => {
    expect(
      parseDistributorClaim(
        log({
          address: REBASE,
          topics: [
            TOPIC.claimed,
            word(1172n),
            word(1793836800n),
            word(1794441600n),
          ],
          data: word(193_068n * E18),
        }),
      ),
    ).toMatchObject({ tokenId: "1172", amount: 193_068n * E18 })
  })

  it("asks the distributor for one lock's claims by topic, oldest first", async () => {
    const { chain, paths } = chainWith(() => ({
      items: [
        log({
          address: REBASE,
          topics: [TOPIC.claimed, word(1172n), word(2n), word(3n)],
          data: word(5n),
          block: 20,
        }),
        log({
          address: REBASE,
          topics: [TOPIC.claimed, word(1172n), word(1n), word(2n)],
          data: word(4n),
          block: 10,
        }),
        // Another lock that happens to share a topic value.
        log({
          address: REBASE,
          topics: [TOPIC.claimed, word(9n), word(1172n), word(2n)],
          data: word(7n),
          block: 15,
        }),
      ],
      next_page_params: null,
    }))
    const read = await chain.distributorClaims("veMEZO", "1172", 2)
    expect(paths).toEqual([
      `api/v2/addresses/${REBASE}/logs?topic=${idTopic("1172")}`,
    ])
    expect(read?.complete).toBe(true)
    expect(read?.claims.map((claim) => claim.amount)).toEqual([4n, 5n])
  })

  it("reads the escrow events of one transaction", async () => {
    const { chain } = chainWith(() => ({
      items: [
        log({
          address: VEMEZO,
          topics: [TOPIC.transfer, word(0n), word(FUNDED), word(2930n)],
          data: "0x",
        }),
        log({
          address: MUSDC,
          topics: [TOPIC.transfer, word(SAFE), word(FUNDED)],
          data: word(1n),
        }),
      ],
      next_page_params: null,
    }))
    const events = await chain.txLockEvents(`0x${"ab".repeat(32)}`)
    expect(events).toEqual([
      {
        asset: "veMEZO",
        event: expect.objectContaining({ kind: "transfer", to: FUNDED }),
      },
    ])
  })

  it("escapes Blockscout's cursor values in the proxy query", () => {
    expect(cursorQuery({ block_number: "12&topic=x", index: "1 2" })).toBe(
      "block_number=12%26topic%3Dx&index=1%202",
    )
    expect(cursorQuery({ block_number: 5, index: 0 })).toBe(
      "block_number=5&index=0",
    )
    expect(cursorQuery(null)).toBeNull()
  })
})

describe("native BTC from Safe events", () => {
  it("reads direct and multiSend native sends of executed transactions", () => {
    const direct = log({
      address: SAFE,
      topics: [TOPIC.safeTx],
      tx: `0x${"c1".repeat(32)}`,
      data: safeTxData({
        to: OPS_SAFE,
        value: 4n * 10n ** 16n,
        data: "0x",
        operation: 0,
      }),
    })
    const batched = log({
      address: SAFE,
      topics: [TOPIC.safeTx],
      tx: `0x${"cd".repeat(32)}`,
      index: 7,
      data: safeTxData({
        to: MULTISEND,
        value: 0n,
        operation: 1,
        data: multiSend([
          // An ERC-20 transfer (no native value), then 0.009 BTC.
          { operation: 0, to: MUSDC, value: 0n, data: "0xa9059cbb00" },
          { operation: 0, to: OPS_SAFE, value: 9n * 10n ** 15n, data: "0x" },
        ]),
      }),
    })
    const failed = log({
      address: SAFE,
      topics: [TOPIC.safeTx],
      tx: `0x${"ef".repeat(32)}`,
      data: safeTxData({ to: OPS_SAFE, value: 1n, data: "0x", operation: 0 }),
    })
    const out = parseSafeNative(
      SAFE,
      [direct, batched, failed],
      new Set([`0x${"ef".repeat(32)}`]),
    )
    expect(
      out.map((each) => [each.from, each.to, each.amount, each.symbol]),
    ).toEqual([
      [SAFE, OPS_SAFE, 4n * 10n ** 16n, "BTC"],
      [SAFE, OPS_SAFE, 9n * 10n ** 15n, "BTC"],
    ])
    expect(out[0]?.token).toBe(BTC_TOKEN)
    // Unique log indexes past the transaction's real ones.
    expect(new Set(out.map((each) => `${each.tx}:${each.logIndex}`)).size).toBe(
      2,
    )
  })

  it("decodes only the value calls of a multiSend", () => {
    expect(multiSendCalls("0x12345678")).toEqual([])
    expect(
      multiSendCalls(
        multiSend([
          { operation: 1, to: OPS_SAFE, value: 5n, data: "0x" },
          { operation: 0, to: FUNDED, value: 6n, data: "0xdeadbeef" },
        ]),
      ),
    ).toEqual([{ to: FUNDED, value: 6n }])
  })

  it("reads executed transactions and failures by topic, and says when undated", async () => {
    const { chain, paths } = chainWith((path) => ({
      items:
        path.includes(TOPIC.failure) || path.includes(TOPIC.module)
          ? []
          : [
              log({
                address: SAFE,
                topics: [TOPIC.safeTx],
                at: null,
                data: safeTxData({
                  to: OPS_SAFE,
                  value: 1n,
                  data: "0x",
                  operation: 0,
                }),
              }),
            ],
      next_page_params: null,
    }))
    const read = await chain.safeNative(SAFE, 0, 4)
    expect([...paths].sort()).toEqual(
      [
        `api/v2/addresses/${SAFE}/logs?topic=${TOPIC.failure}`,
        `api/v2/addresses/${SAFE}/logs?topic=${TOPIC.module}`,
        `api/v2/addresses/${SAFE}/logs?topic=${TOPIC.safeTx}`,
      ].sort(),
    )
    expect(read?.transfers).toEqual([])
    expect(read?.complete).toBe(false)
  })

  it("says when a Safe's native sends cannot be decoded: module calls or no L2 events", async () => {
    const safeTx = log({
      address: SAFE,
      topics: [TOPIC.safeTx],
      data: safeTxData({ to: OPS_SAFE, value: 1n, data: "0x", operation: 0 }),
    })
    const moduleCall = log({
      address: SAFE,
      topics: [TOPIC.module, `0x${"0".repeat(24)}${"ab".repeat(20)}`],
      data: "0x",
    })
    const executed = log({
      address: SAFE,
      topics: [TOPIC.executed],
      data: "0x",
    })
    const page = (items: unknown[]) => ({ items, next_page_params: null })
    // A module ran a call in the period: native sends partly unread.
    const withModule = chainWith((path) =>
      page(
        path.includes(TOPIC.module)
          ? [moduleCall]
          : path.includes(TOPIC.safeTx)
            ? [safeTx]
            : [],
      ),
    )
    const moduleRead = await withModule.chain.safeNative(SAFE, 0, 4)
    expect(moduleRead?.complete).toBe(false)
    expect(moduleRead?.undecoded).toBe("module")
    expect(moduleRead?.transfers).toHaveLength(1)
    // Older module calls do not matter.
    const later = Date.parse("2026-11-04T00:00:00Z") / 1000
    expect((await withModule.chain.safeNative(SAFE, later, 4))?.undecoded).toBe(
      undefined,
    )
    // Executed transactions but no SafeMultiSigTransaction: an L1 Safe.
    const plain = chainWith((path) =>
      page(path.includes(TOPIC.executed) ? [executed] : []),
    )
    const plainRead = await plain.chain.safeNative(SAFE, 0, 4)
    expect(plainRead?.complete).toBe(false)
    expect(plainRead?.undecoded).toBe("notL2")
    // An L2 Safe without module calls stays complete.
    const clean = chainWith((path) =>
      page(path.includes(TOPIC.safeTx) ? [safeTx] : []),
    )
    const cleanRead = await clean.chain.safeNative(SAFE, 0, 4)
    expect(cleanRead?.complete).toBe(true)
    expect(cleanRead?.undecoded).toBe(undefined)
  })
})

describe("lock NFT moves", () => {
  it("keeps veBTC and veMEZO NFT transfers with their token ids", () => {
    const transfer = (input: {
      block: number
      token: string
      tokenId: string | null
      type: string
    }) => ({
      transaction_hash: `0x${input.block.toString(16).padStart(64, "0")}`,
      block_number: input.block,
      log_index: 1,
      timestamp: "2026-10-30T10:00:00.000000Z",
      type: "token_transfer",
      method: null,
      from: ref(ENCLAVE),
      to: ref(SAFE),
      token: {
        address_hash: input.token,
        name: null,
        symbol: null,
        decimals: null,
        type: input.type,
        icon_url: null,
      },
      total: { value: null, decimals: null, token_id: input.tokenId },
    })
    const moves = normalizeNftMoves({
      items: [
        transfer({
          block: 50,
          token: VEMEZO,
          tokenId: "1182",
          type: "ERC-721",
        }),
        // Another collection is not a lock.
        transfer({ block: 49, token: MUSDC, tokenId: "7", type: "ERC-721" }),
      ],
      next_page_params: null,
    })
    expect(moves).toEqual([
      expect.objectContaining({
        asset: "veMEZO",
        tokenId: "1182",
        from: ENCLAVE,
        to: SAFE,
        block: 50,
      }),
    ])
  })
})

// --- re-review of PR #84: long transactions, gauges

const VEBTC = "0x3d4b1b884a7a1e59fe8589a3296ec8f8cbb6f279"
const WHALE = "0x4da9e77114ee66d64ca9457da1fca94d4b06fb99"
const VAULT_GAUGE = "0x677817bf3e44b90e8f95222f75e2950b7904a401"
const BRIBES = "0xff3b49ccbf3bbecc7942f2ae4af2e5950ec7c422"
const SMUSD = "0xb4d498029af77680cd1ef828b967f010d06c51cc"
const MEZO = "0x7b7c000000000000000000000000000000000001"
const RELOCK_TX = `0x${"5a".repeat(32)}`

/** 55 unrelated logs, then the veBTC deposit for #6114 at index 55. */
function longTransaction() {
  const noise = Array.from({ length: 55 }, (_, index) =>
    log({
      address: MUSDC,
      topics: [TOPIC.transfer, word(WHALE), word(SAFE)],
      data: word(1n),
      tx: RELOCK_TX,
      index,
    }),
  )
  const deposit = log({
    address: VEBTC,
    topics: [TOPIC.deposit, word(WHALE), word(6114n), word(1n)],
    data: `${word(500n * E18)}${word(1n).slice(2)}${word(2n).slice(2)}`,
    tx: RELOCK_TX,
    index: 55,
  })
  return [...noise, deposit]
}

/** A Mezo client double: receipts and multicall results only. */
function fakeRpc(input: {
  receipt?: () => unknown
  multicall?: (
    contracts: Array<{ address: string; functionName: string }>,
  ) => Array<string | null>
}) {
  return {
    getTransactionReceipt: async () => {
      if (!input.receipt) throw new Error("no receipt")
      return input.receipt()
    },
    multicall: async ({
      contracts,
    }: {
      contracts: Array<{ address: string; functionName: string }>
    }) =>
      (input.multicall?.(contracts) ?? []).map((result) =>
        result === null
          ? { status: "failure", error: new Error("reverted") }
          : { status: "success", result },
      ),
  } as unknown as Parameters<typeof createChainActivity>[0]["rpc"]
}

describe("lock deposits in long transactions", () => {
  it("pages a transaction's logs past the first 50 without an RPC", async () => {
    const logs = longTransaction()
    const { chain, paths } = chainWith((path) =>
      path.includes("block_number=")
        ? { items: logs.slice(50), next_page_params: null }
        : {
            items: logs.slice(0, 50),
            next_page_params: { block_number: 13_000_000, index: 50 },
          },
    )
    const events = await chain.txLockEvents(RELOCK_TX)
    expect(paths).toHaveLength(2)
    expect(events).toEqual([
      {
        asset: "veBTC",
        event: expect.objectContaining({ kind: "deposit", tokenId: "6114" }),
      },
    ])
  })

  it("reads every log from the RPC receipt when there is one", async () => {
    const logs = longTransaction()
    const paths: string[] = []
    const chain = createChainActivity({
      blockscout: async (path) => {
        paths.push(path)
        return { status: "unavailable" }
      },
      scan: async () => ({ status: "unavailable" }),
      rpc: fakeRpc({
        receipt: () => ({
          logs: logs.map((each) => ({
            address: each.address.hash,
            topics: each.topics,
            data: each.data,
            logIndex: each.index,
            blockNumber: BigInt(each.block_number),
          })),
        }),
      }),
    })
    const events = await chain.txLockEvents(RELOCK_TX)
    expect(paths).toEqual([])
    expect(events?.[0]?.event).toMatchObject({
      kind: "deposit",
      tokenId: "6114",
      provider: WHALE,
    })
  })
})

describe("what pays an address", () => {
  it("tells gauges from voting reward contracts, though both answer ve()", async () => {
    const answers: Record<string, Record<string, string | null>> = {
      [VAULT_GAUGE]: { ve: VEBTC, stakingToken: SMUSD, rewardToken: MEZO },
      [BRIBES]: { ve: VEBTC, stakingToken: null, rewardToken: null },
    }
    const chain = createChainActivity({
      blockscout: async () => ({ status: "unavailable" }),
      scan: async () => ({ status: "unavailable" }),
      rpc: fakeRpc({
        multicall: (contracts) =>
          contracts.map(
            (call) =>
              answers[call.address.toLowerCase()]?.[call.functionName] ?? null,
          ),
      }),
    })
    const payers = await chain.rewardPayers([VAULT_GAUGE, BRIBES])
    expect(payers.get(VAULT_GAUGE)).toEqual({
      kind: "gauge",
      stakingToken: SMUSD,
      rewardToken: MEZO,
    })
    expect(payers.get(BRIBES)).toEqual({ kind: "voting", asset: "veBTC" })
  })
})
