import { CONTRACTS, VOTING_ESCROW_EVENTS_ABI } from "@matchbox/chain"
import type { Gauge } from "@matchbox/contracts/market"
import { createLogger } from "@matchbox/logger"
import {
  createMemoryRateLimitClient,
  type RateLimitClient,
} from "@matchbox/server"
import { encodeEventTopics, type PublicClient } from "viem"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ClaimableUnread } from "../read-models/live-claimable"
import type { LiveLockRead } from "../read-models/live-locks"
import { ScanContext } from "./context"
import {
  type LiveAsk,
  ScanLive,
  scanCallerLiveAllowance,
  scanChainBudget,
  scanTxBudget,
} from "./live-locks"
import {
  createLiveTxReader,
  createLockStatesReader,
  decodedActivity,
  knownGauges,
  type LiveTxRead,
  liveTransaction,
  liveTxCodec,
  lockReadMarginMs,
  methodOf,
  receiptInput,
  settled,
  settledDepth,
} from "./live-tx"
import recorded from "./live-tx.fixtures.json"

const hash = `0x${"ab".repeat(32)}`
const sender = `0x${"11".repeat(20)}`
const target = `0x${"22".repeat(20)}`
const logger = createLogger({ sink: () => undefined })
// vote(uint256,address[],uint256[]) with nothing after the selector.
const voteInput = "0x7ac09bf7"

type Answers = Record<string, unknown | (() => Promise<unknown>)>

/** A client whose RPC answers each method from `answers`, counting calls. */
function fakeClient(answers: Answers) {
  const calls: string[] = []
  const client = {
    request: async ({ method }: { method: string }) => {
      calls.push(method)
      const answer = answers[method]
      return typeof answer === "function"
        ? (answer as () => Promise<unknown>)()
        : answer
    },
  } as unknown as PublicClient
  return { client, calls }
}

/** A recorded receipt as the RPC serves it, at a position in its block. */
function rpcOf(
  receipt: (typeof recorded.receipts)[number],
  position: number,
): Answers {
  const at = `0x${receipt.blockNumber.toString(16)}`
  const index = `0x${position.toString(16)}`
  return {
    eth_getTransactionByHash: {
      hash: receipt.hash,
      from: receipt.from,
      to: receipt.to,
      value: "0x0",
      nonce: "0x1",
      gas: "0x5208",
      gasPrice: "0x1",
      input: receipt.input,
      blockNumber: at,
      transactionIndex: index,
    },
    eth_getTransactionReceipt: {
      status: "0x1",
      blockNumber: at,
      transactionIndex: index,
      gasUsed: "0x5208",
      effectiveGasPrice: "0x1",
      contractAddress: null,
      logs: receipt.logs.map((log) => ({
        logIndex: `0x${log.index.toString(16)}`,
        address: log.address,
        topics: log.topics,
        data: log.data,
      })),
    },
    eth_getBlockByNumber: {
      hash: `0x${"bc".repeat(32)}`,
      timestamp: `0x${receipt.timestamp.toString(16)}`,
    },
    eth_blockNumber: `0x${(receipt.blockNumber + 5).toString(16)}`,
  }
}

const rpcTx = (blockNumber: string | null) => ({
  hash: hash.toUpperCase().replace("0X", "0x"),
  from: sender.toUpperCase().replace("0X", "0x"),
  to: target,
  value: "0x0",
  nonce: "0x7",
  gas: "0x5208",
  gasPrice: "0x3b9aca00",
  input: voteInput,
  blockNumber,
  transactionIndex: blockNumber === null ? null : "0x2",
})

const rpcReceipt = (status: string) => ({
  status,
  blockNumber: "0xcb7350",
  transactionIndex: "0x2",
  gasUsed: "0x5208",
  effectiveGasPrice: "0x3b9aca00",
  contractAddress: null,
  logs: [
    {
      logIndex: "0x0",
      address: target,
      topics: [`0x${"cd".repeat(32)}`],
      data: "0x",
    },
  ],
})

const soon = () => Date.now() + 1_000

const block = { hash: `0x${"bc".repeat(32)}`, timestamp: "0x6a000000" }

describe("reading a transaction from Mezo RPC", () => {
  it("reads a mined transaction, its receipt and its block's time", async () => {
    const { client, calls } = fakeClient({
      eth_getTransactionByHash: rpcTx("0xcb7350"),
      eth_getTransactionReceipt: rpcReceipt("0x1"),
      eth_getBlockByNumber: block,
      eth_blockNumber: "0xcb7352",
    })
    const read = await createLiveTxReader(client)(hash, soon())
    expect(read).toEqual({
      state: "mined",
      transaction: {
        from: sender,
        to: target,
        value: "0",
        nonce: 7,
        gas_limit: "21000",
        gas_price: "1000000000",
        input: voteInput,
        input_truncated: false,
        method: "vote",
      },
      receipt: {
        status: "success",
        block_number: 13_333_328,
        position: 2,
        gas_used: "21000",
        effective_gas_price: "1000000000",
        created: null,
        logs: [
          {
            index: 0,
            address: target,
            topics: [`0x${"cd".repeat(32)}`],
            data: "0x",
          },
        ],
        logs_truncated: false,
      },
      timestamp: 0x6a000000,
      head: 0xcb7352,
      // Its one log names no lock: nothing to read.
      locks: { before: [], changed: [] },
    })
    // The receipt, the block and the head in one step, after the
    // transaction.
    expect(calls).toEqual([
      "eth_getTransactionByHash",
      "eth_getTransactionReceipt",
      "eth_getBlockByNumber",
      "eth_blockNumber",
    ])
  })

  it("reads a mined transaction whose head is not served, as kept a block", async () => {
    const { client } = fakeClient({
      eth_getTransactionByHash: rpcTx("0xcb7350"),
      eth_getTransactionReceipt: rpcReceipt("0x1"),
      eth_getBlockByNumber: block,
      eth_blockNumber: () => Promise.reject(new Error("no head")),
    })
    const read = await createLiveTxReader(client)(hash, soon())
    expect(read.state).toBe("mined")
    expect(read.head).toBeNull()
    expect(settled(read)).toBe(false)
  })

  it("reads a reverted transaction as failed", async () => {
    const { client } = fakeClient({
      eth_getTransactionByHash: rpcTx("0xcb7350"),
      eth_getTransactionReceipt: rpcReceipt("0x0"),
      eth_getBlockByNumber: block,
    })
    const read = await createLiveTxReader(client)(hash, soon())
    expect(read.receipt?.status).toBe("failed")
  })

  it("stops at a pending transaction: one request", async () => {
    const { client, calls } = fakeClient({
      eth_getTransactionByHash: rpcTx(null),
    })
    const read = await createLiveTxReader(client)(hash, soon())
    expect(read.state).toBe("pending")
    expect(read.transaction?.method).toBe("vote")
    expect(read.receipt).toBeNull()
    expect(calls).toEqual(["eth_getTransactionByHash"])
  })

  it("reads a mined transaction whose receipt is not served yet as pending", async () => {
    const { client } = fakeClient({
      eth_getTransactionByHash: rpcTx("0xcb7350"),
      eth_getTransactionReceipt: null,
      eth_getBlockByNumber: block,
    })
    expect((await createLiveTxReader(client)(hash, soon())).state).toBe(
      "pending",
    )
  })

  it("answers unknown for a hash the RPC has never seen: one request", async () => {
    const { client, calls } = fakeClient({ eth_getTransactionByHash: null })
    expect(await createLiveTxReader(client)(hash, soon())).toEqual({
      state: "unknown",
      transaction: null,
      receipt: null,
      timestamp: null,
      head: null,
      locks: null,
    })
    expect(calls).toHaveLength(1)
  })

  it("gives up on an RPC that does not answer by the deadline", async () => {
    const { client } = fakeClient({
      eth_getTransactionByHash: () => new Promise(() => undefined),
    })
    await expect(
      createLiveTxReader(client)(hash, Date.now() + 30),
    ).rejects.toBeInstanceOf(ClaimableUnread)
  })

  it("refuses a malformed answer, or one for another transaction", async () => {
    const malformed = fakeClient({ eth_getTransactionByHash: { from: 1 } })
    await expect(
      createLiveTxReader(malformed.client)(hash, soon()),
    ).rejects.toThrow()
    const other = fakeClient({
      eth_getTransactionByHash: {
        ...rpcTx(null),
        hash: `0x${"ef".repeat(32)}`,
      },
    })
    await expect(
      createLiveTxReader(other.client)(hash, soon()),
    ).rejects.toBeInstanceOf(ClaimableUnread)
  })

  it("cuts a long input and says so", async () => {
    const long = `0x${"00".repeat(40_000)}`
    const { client } = fakeClient({
      eth_getTransactionByHash: { ...rpcTx(null), input: long },
    })
    const read = await createLiveTxReader(client)(hash, soon())
    expect(read.transaction?.input).toHaveLength(65_536)
    expect(read.transaction?.input_truncated).toBe(true)
  })

  it("reads the locks a poke touches at the block before", async () => {
    const [poke] = recorded.receipts
    if (poke === undefined) throw new Error("fixtures")
    const asked: { keys: unknown; block: bigint }[] = []
    const owner = `0x${"44".repeat(20)}`
    const { client, calls } = fakeClient(rpcOf(poke, 0))
    const read = await createLiveTxReader(client, async (keys, at) => {
      asked.push({ keys, block: at })
      return keys.map((key) => ({
        ...key,
        owner,
        amount: "5",
        end: 0,
        isPermanent: true,
      }))
    })(poke.hash, soon())
    // The store's escrows only (not testnet's veMEZO, which the owner
    // lookup also names), at the block before.
    expect(asked).toEqual([
      {
        keys: [
          { escrow: CONTRACTS.mainnet.veMEZO.toLowerCase(), tokenId: "2600" },
          { escrow: CONTRACTS.mainnet.veBTC.toLowerCase(), tokenId: "2600" },
        ],
        block: BigInt(poke.blockNumber) - 1n,
      },
    ])
    expect(read.locks?.changed).toEqual([])
    // First in its block: no earlier transaction to look at.
    expect(calls).not.toContain("eth_getLogs")
    const input = receiptInput(poke.hash, read)
    if (input === null) throw new Error("not mined")
    const rows = decodedActivity(input, knownGauges([]), read.locks)
    expect(rows.map((row) => row.actor)).toEqual(rows.map(() => owner))
  })

  it("treats every touched lock as unread when an earlier transaction in the block emitted an escrow log", async () => {
    const [poke] = recorded.receipts
    if (poke === undefined) throw new Error("fixtures")
    const vemezo = CONTRACTS.mainnet.veMEZO
    const transfer = (tokenId: bigint, index: string) => ({
      transactionIndex: index,
      logIndex: "0x0",
      address: vemezo,
      topics: encodeEventTopics({
        abi: VOTING_ESCROW_EVENTS_ABI,
        eventName: "Transfer",
        args: {
          from: `0x${"01".repeat(20)}`,
          to: `0x${"02".repeat(20)}`,
          tokenId,
        },
      }),
      data: "0x",
    })
    const answers = rpcOf(poke, 2)
    const filters: unknown[] = []
    answers.eth_getLogs = async () => {
      filters.push(true)
      // Another lock earlier in the block (it may be a managed lock's
      // deposit, which names no lock the decoders read); 7 after.
      return [transfer(9n, "0x1"), transfer(7n, "0x3")]
    }
    const { client } = fakeClient(answers)
    const read = await createLiveTxReader(client, async (keys) =>
      keys.map((key) => ({
        ...key,
        owner: `0x${"44".repeat(20)}`,
        amount: "5",
        end: 0,
        isPermanent: true,
      })),
    )(poke.hash, soon())
    expect(filters).toHaveLength(1)
    expect(read.locks?.changed).toEqual([
      { escrow: vemezo.toLowerCase(), tokenId: "2600" },
      { escrow: CONTRACTS.mainnet.veBTC.toLowerCase(), tokenId: "2600" },
    ])
    const input = receiptInput(poke.hash, read)
    if (input === null) throw new Error("not mined")
    const rows = decodedActivity(input, knownGauges([]), read.locks)
    expect(rows.map((row) => row.actor)).toEqual(rows.map(() => null))
  })

  it("leaves only later escrow logs in the block as no change", async () => {
    const [poke] = recorded.receipts
    if (poke === undefined) throw new Error("fixtures")
    const answers = rpcOf(poke, 2)
    answers.eth_getLogs = async () => [
      {
        transactionIndex: "0x3",
        logIndex: "0x0",
        address: CONTRACTS.mainnet.veMEZO,
        topics: [`0x${"ab".repeat(32)}`],
        data: "0x",
      },
    ]
    const { client } = fakeClient(answers)
    const read = await createLiveTxReader(client, async () => [])(
      poke.hash,
      soon(),
    )
    expect(read.locks?.changed).toEqual([])
  })

  it("stops the lock read before the read's own deadline", async () => {
    const [poke] = recorded.receipts
    if (poke === undefined) throw new Error("fixtures")
    const { client } = fakeClient(rpcOf(poke, 0))
    const deadline = soon()
    let given = Number.POSITIVE_INFINITY
    await createLiveTxReader(client, async (_keys, _block, until) => {
      given = until
      return []
    })(poke.hash, deadline)
    expect(given).toBe(deadline - lockReadMarginMs)
  })

  it("reads a mined transaction whose locks could not be read, without them", async () => {
    const [poke] = recorded.receipts
    if (poke === undefined) throw new Error("fixtures")
    const { client } = fakeClient(rpcOf(poke, 0))
    const read = await createLiveTxReader(client, () =>
      Promise.reject(new ClaimableUnread("pruned")),
    )(poke.hash, soon())
    expect(read.state).toBe("mined")
    expect(read.locks).toBeNull()
  })

  it("reads a lock's owner and figures at a block, and no owner as none", async () => {
    const asked: unknown[] = []
    const client = {
      multicall: async (options: {
        blockNumber: bigint
        contracts: unknown[]
      }) => {
        asked.push(options.blockNumber, options.contracts.length)
        return [
          { status: "success", result: `0x${"AB".repeat(20)}` },
          {
            status: "success",
            result: { amount: 9n, end: 1_900_000_000n, isPermanent: false },
          },
          { status: "failure", error: new Error("ERC721: invalid token") },
          { status: "failure", error: new Error("unread") },
        ]
      },
    } as unknown as PublicClient
    const states = await createLockStatesReader(client)(
      [
        { escrow: target, tokenId: "1" },
        { escrow: target, tokenId: "2" },
      ],
      41n,
      soon(),
    )
    expect(asked).toEqual([41n, 4])
    expect(states).toEqual([
      {
        escrow: target,
        tokenId: "1",
        owner: `0x${"ab".repeat(20)}`,
        amount: "9",
        end: 1_900_000_000,
        isPermanent: false,
      },
      {
        escrow: target,
        tokenId: "2",
        owner: null,
        amount: "0",
        end: 0,
        isPermanent: false,
      },
    ])
  })

  it("names the methods Pro sends, and nothing else", () => {
    expect(methodOf(voteInput)).toBe("vote")
    expect(methodOf("0x12345678")).toBeNull()
    expect(methodOf("0x")).toBeNull()
  })
})

// -- decoding ---------------------------------------------------------------

function liveRead(receipt: (typeof recorded.receipts)[number]): LiveTxRead {
  return {
    state: "mined",
    transaction: {
      from: receipt.from,
      to: receipt.to,
      value: "0",
      nonce: 1,
      gas_limit: "1000000",
      gas_price: null,
      input: receipt.input,
      input_truncated: false,
      method: null,
    },
    receipt: {
      status: "success",
      block_number: receipt.blockNumber,
      position: receipt.position,
      gas_used: "1",
      effective_gas_price: null,
      created: null,
      logs: receipt.logs,
      logs_truncated: false,
    },
    timestamp: receipt.timestamp,
    head: receipt.blockNumber + 2,
    locks: null,
  }
}

const gauges = recorded.known.map(
  (reward): Gauge => ({
    voter: "boost",
    network: "mezo",
    gaugeAddress: reward.gauge,
    isAlive: true,
    weight: null,
    bribeContract: reward.address,
    vebtcTokenId: null,
    beneficiary: null,
    boostMultiplier: null,
  }),
)

describe("decoding a live receipt", () => {
  const [vote, claim] = recorded.receipts
  if (vote === undefined || claim === undefined) throw new Error("fixtures")

  it("reads a vote as the copy wrote it", () => {
    const input = receiptInput(vote.hash, liveRead(vote))
    if (input === null) throw new Error("not mined")
    const copied = recorded.rows.filter((row) => row.tx_hash === vote.hash)
    // A poke: the copy names the lock's owner, which the chain read gives.
    const owner = copied[0]?.actor ?? null
    const before = [
      {
        escrow: CONTRACTS.mainnet.veMEZO.toLowerCase(),
        tokenId: "2600",
        owner,
        amount: "1",
        end: 0,
        isPermanent: true,
      },
    ]
    expect(
      decodedActivity(input, knownGauges([]), { before, changed: [] }),
    ).toEqual(copied)
    // Without it, no actor: never the maintainer who sent the poke.
    const bare = decodedActivity(input, knownGauges([]), null)
    expect(bare.map((row) => row.actor)).toEqual(copied.map(() => null))
    expect(bare.map(({ actor: _a, ...row }) => row)).toEqual(
      copied.map(({ actor: _a, ...row }) => row),
    )
  })

  it("reads a claim through a reward contract only with the snapshot's gauges", () => {
    const input = receiptInput(claim.hash, liveRead(claim))
    if (input === null) throw new Error("not mined")
    const copied = recorded.rows.filter((row) => row.tx_hash === claim.hash)
    const known = decodedActivity(input, knownGauges(gauges), null)
    expect(known).toEqual(copied)
    const unknown = decodedActivity(input, knownGauges([]), null)
    expect(unknown.length).toBeLessThan(copied.length)
  })

  it("maps each gauge's reward contracts and pool", () => {
    const pools: Gauge = {
      voter: "pools",
      network: "mezo",
      gaugeAddress: `0x${"aa".repeat(20)}`,
      isAlive: true,
      weight: null,
      bribeContract: `0x${"bb".repeat(20)}`,
      poolAddress: `0x${"cc".repeat(20)}`,
      poolSymbol: null,
      feesContract: `0x${"dd".repeat(20)}`,
    }
    const known = knownGauges([pools])
    expect(known.rewards).toEqual([
      {
        address: pools.bribeContract,
        kind: "bribe",
        voter: "POOLS_VOTER",
        gauge: pools.gaugeAddress,
        pool: pools.poolAddress,
      },
      {
        address: pools.feesContract,
        kind: "fee",
        voter: "POOLS_VOTER",
        gauge: pools.gaugeAddress,
        pool: pools.poolAddress,
      },
    ])
    expect(known.gaugeOfPool.get(pools.poolAddress)).toBe(pools.gaugeAddress)
  })
})

// -- remembering ------------------------------------------------------------

/** A Cache API stand-in, shared by "isolates" (ScanLive instances). */
function fakeCache(): Cache {
  const entries = new Map<string, { body: string; until: number }>()
  return {
    async match(request: RequestInfo) {
      const url = typeof request === "string" ? request : request.url
      const entry = entries.get(url)
      if (entry === undefined || entry.until < clock.now) return undefined
      return new Response(entry.body)
    },
    async put(request: RequestInfo, response: Response) {
      const url = typeof request === "string" ? request : request.url
      const age = /max-age=(\d+)/.exec(
        response.headers.get("cache-control") ?? "",
      )
      entries.set(url, {
        body: await response.text(),
        until: clock.now + Number(age?.[1] ?? 0) * 1000,
      })
    },
  } as unknown as Cache
}

const clock = { now: 1_794_000_000_000 }

const mined: LiveTxRead = {
  state: "mined",
  transaction: {
    from: sender,
    to: target,
    value: "0",
    nonce: 1,
    gas_limit: "21000",
    gas_price: null,
    input: "0x",
    input_truncated: false,
    method: null,
  },
  receipt: {
    status: "success",
    block_number: 1,
    position: 0,
    gas_used: "21000",
    effective_gas_price: null,
    created: null,
    logs: [],
    logs_truncated: false,
  },
  timestamp: 1_794_000_000,
  head: 3,
  locks: { before: [], changed: [] },
}

const unknown: LiveTxRead = {
  state: "unknown",
  transaction: null,
  receipt: null,
  timestamp: null,
  head: null,
  locks: null,
}

function live(options: {
  answer: (hash: string) => Promise<LiveTxRead>
  cache?: Cache | null
  rateLimits?: RateLimitClient | null
  lock?: (tokenId: string) => Promise<LiveLockRead>
}) {
  const reads: string[] = []
  const scanLive = new ScanLive({
    readers: {
      lock: (_escrow, tokenId) =>
        options.lock === undefined
          ? Promise.reject(new Error("unused"))
          : options.lock(tokenId),
      owner: () => Promise.reject(new Error("unused")),
      latest: () => Promise.reject(new Error("unused")),
      tx: (txHash) => {
        reads.push(txHash)
        return options.answer(txHash)
      },
    },
    cache: options.cache ?? null,
    rateLimits:
      options.rateLimits === undefined
        ? createMemoryRateLimitClient(() => clock.now)
        : options.rateLimits,
    now: () => clock.now,
    logger,
  })
  return { scanLive, reads }
}

/** Background work (edge writes) handed to waitUntil. */
const background: Promise<unknown>[] = []

const ask = (endUser: string | null = "visitor-key-0000000000"): LiveAsk => ({
  caller: { client: "scan", endUser },
  deadline: clock.now + 2_000,
  waitUntil: (task) => {
    background.push(task)
  },
})

describe("a live transaction, remembered", () => {
  it("shares one read between requests that arrive together", async () => {
    const { scanLive, reads } = live({ answer: async () => mined })
    const [first, second] = await Promise.all([
      scanLive.transaction(hash, ask()),
      scanLive.transaction(hash, ask()),
    ])
    expect(first).toEqual(mined)
    expect(second).toEqual(mined)
    expect(reads).toHaveLength(1)
  })

  it("keeps a mined transaction, in the isolate and at the edge", async () => {
    const cache = fakeCache()
    const one = live({ answer: async () => mined, cache })
    await one.scanLive.transaction(hash, ask())
    await Promise.all(background.splice(0))
    clock.now += 3_600_000
    expect(await one.scanLive.transaction(hash, ask())).toEqual(mined)
    const other = live({ answer: async () => mined, cache })
    expect(await other.scanLive.transaction(hash, ask())).toEqual(mined)
    expect(one.reads).toHaveLength(1)
    expect(other.reads).toHaveLength(0)
  })

  it("keeps a mined one whose locks could not be read for a block only", async () => {
    const unread: LiveTxRead = { ...mined, locks: null }
    expect(settled(mined)).toBe(true)
    expect(settled(unread)).toBe(false)
    const one = live({ answer: async () => unread, cache: fakeCache() })
    await one.scanLive.transaction(hash, ask())
    await Promise.all(background.splice(0))
    clock.now += 3_000
    await one.scanLive.transaction(hash, ask())
    expect(one.reads).toHaveLength(2)
  })

  it("keeps one mined in the newest blocks for a block only", async () => {
    const cache = fakeCache()
    const fresh: LiveTxRead = { ...mined, head: 1 + settledDepth - 1 }
    const one = live({ answer: async () => fresh, cache })
    expect(await one.scanLive.transaction(hash, ask())).toEqual(fresh)
    await Promise.all(background.splice(0))
    clock.now += 1_000
    await one.scanLive.transaction(hash, ask())
    expect(one.reads).toHaveLength(1)
    clock.now += 3_000
    await one.scanLive.transaction(hash, ask())
    expect(one.reads).toHaveLength(2)
    // Nor at the edge for longer than that block.
    const other = live({ answer: async () => fresh, cache })
    clock.now += 3_000
    await other.scanLive.transaction(hash, ask())
    expect(other.reads).toHaveLength(1)
  })

  it("asks again for an unknown or pending one after a block", async () => {
    const { scanLive, reads } = live({ answer: async () => unknown })
    await scanLive.transaction(hash, ask())
    clock.now += 1_000
    await scanLive.transaction(hash, ask())
    expect(reads).toHaveLength(1)
    clock.now += 3_000
    await scanLive.transaction(hash, ask())
    expect(reads).toHaveLength(2)
  })

  it("remembers a failed read for a block, so a hung RPC is not asked per view", async () => {
    const { scanLive, reads } = live({
      answer: () => Promise.reject(new ClaimableUnread("throttled")),
    })
    expect(await scanLive.transaction(hash, ask())).toBeNull()
    expect(await scanLive.transaction(hash, ask())).toBeNull()
    expect(reads).toHaveLength(1)
    clock.now += 3_100
    await scanLive.transaction(hash, ask())
    expect(reads).toHaveLength(2)
  })

  it("does not read when the budget cannot be asked, nor remember that", async () => {
    const down: RateLimitClient = {
      consume: () => Promise.reject(new Error("limiter down")),
    }
    const { scanLive, reads } = live({
      answer: async () => mined,
      rateLimits: down,
    })
    expect(await scanLive.transaction(hash, ask())).toBeNull()
    expect(reads).toHaveLength(0)
  })

  it("stops one visitor's random hashes at their allowance", async () => {
    const { scanLive, reads } = live({ answer: async () => unknown })
    const hashes = Array.from(
      { length: scanCallerLiveAllowance.perMinute + 5 },
      (_, index) => `0x${index.toString(16).padStart(64, "0")}`,
    )
    for (const each of hashes) await scanLive.transaction(each, ask())
    expect(reads).toHaveLength(scanCallerLiveAllowance.perMinute)
    // Another visitor still has theirs.
    await scanLive.transaction(
      `0x${"ff".repeat(32)}`,
      ask("other-visitor-key-00000"),
    )
    expect(reads).toHaveLength(scanCallerLiveAllowance.perMinute + 1)
  })

  it("shares one transaction budget across visitors, apart from the lock pages'", async () => {
    const lockReads: string[] = []
    const { scanLive, reads } = live({
      answer: async () => unknown,
      lock: async (tokenId) => {
        lockReads.push(tokenId)
        return { block: 1, owner: null, lock: null }
      },
    })
    const visitor = (index: number) =>
      ask(`visitor-${index.toString().padStart(16, "0")}`)
    // Each visitor well inside their own allowance: the budget stops them.
    for (let index = 0; index <= scanTxBudget.perMinute; index += 1) {
      await scanLive.transaction(
        `0x${index.toString(16).padStart(64, "0")}`,
        visitor(index),
      )
    }
    expect(reads).toHaveLength(scanTxBudget.perMinute)
    // Spent on hashes, the lock pages still read.
    await scanLive.lock("vemezo", "1", visitor(1_000))
    expect(lockReads).toEqual(["1"])
  })

  it("keeps reading transactions when the lock pages have spent theirs", async () => {
    const lockReads: string[] = []
    const { scanLive, reads } = live({
      answer: async () => unknown,
      lock: async (tokenId) => {
        lockReads.push(tokenId)
        return { block: 1, owner: null, lock: null }
      },
    })
    for (let index = 0; index <= scanChainBudget.perMinute; index += 1) {
      await scanLive.lock(
        "vemezo",
        String(index + 1),
        ask(`visitor-${index.toString().padStart(16, "0")}`),
      )
    }
    expect(lockReads).toHaveLength(scanChainBudget.perMinute)
    await scanLive.transaction(hash, ask("another-visitor-000000"))
    expect(reads).toEqual([hash])
  })

  it("does not read a transaction when no limiter is bound", async () => {
    const lockReads: string[] = []
    const { scanLive, reads } = live({
      answer: async () => mined,
      rateLimits: null,
      lock: async (tokenId) => {
        lockReads.push(tokenId)
        return { block: 1, owner: null, lock: null }
      },
    })
    expect(await scanLive.transaction(hash, ask())).toBeNull()
    expect(reads).toEqual([])
    // A lock is a bounded key: read as before.
    await scanLive.lock("vemezo", "1", ask())
    expect(lockReads).toEqual(["1"])
  })

  it("reads back what it keeps at the edge, and refuses anything else", () => {
    expect(liveTxCodec.decode(liveTxCodec.encode(mined))).toEqual(mined)
    expect(liveTxCodec.decode({ state: "mined" })).toBeNull()
  })
})

// -- decoding inputs, inside the deadline -------------------------------------

describe("a live transaction's decoding inputs", () => {
  const [, recordedClaim] = recorded.receipts
  if (recordedClaim === undefined) throw new Error("fixtures")
  const claim = recordedClaim
  const copied = recorded.rows.filter((row) => row.tx_hash === claim.hash)
  const snapshot = async (): Promise<Gauge[]> =>
    recorded.known.map((reward) => ({
      voter: "boost",
      network: "mezo",
      gaugeAddress: reward.gauge,
      isAlive: true,
      weight: null,
      bribeContract: reward.address,
      vebtcTokenId: null,
      beneficiary: null,
      boostMultiplier: null,
    }))

  function context(gauges: () => Promise<readonly Gauge[]>): ScanContext {
    return new ScanContext({
      scanDb: null,
      readDb: null,
      network: "mezo",
      cache: null,
      rateLimits: createMemoryRateLimitClient(() => clock.now),
      readPrices: async () => null,
      proxy: null,
      clock: async () => ({ height: null, lastActive: null }),
      chain: {
        lock: () => Promise.reject(new Error("unused")),
        owner: () => Promise.reject(new Error("unused")),
        latest: () => Promise.reject(new Error("unused")),
        tx: async () => liveRead(claim),
      },
      gauges,
      logger,
      now: () => clock.now,
    })
  }

  afterEach(() => {
    vi.useRealTimers()
  })

  it("decodes with the snapshot's gauges when they come in time", async () => {
    const scan = context(snapshot)
    const live = await liveTransaction(scan, ask(), claim.hash)
    expect(live?.activity).toEqual(copied)
  })

  it("decodes without gauges when the snapshot does not answer by the deadline", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    const scan = context(() => new Promise<never>(() => undefined))
    const pending = liveTransaction(
      scan,
      { ...ask(), deadline: clock.now + 500 },
      claim.hash,
    )
    await vi.advanceTimersByTimeAsync(500)
    const live = await pending
    expect(live?.state).toBe("mined")
    expect(live?.activity.length).toBeLessThan(copied.length)
  })

  it("remembers a failed snapshot read briefly, not asking per document", async () => {
    let reads = 0
    const scan = context(() => {
      reads += 1
      return Promise.reject(new Error("MARKET_DB down"))
    })
    expect((await scan.knownGauges()).rewards).toEqual([])
    expect((await scan.knownGauges()).rewards).toEqual([])
    expect(reads).toBe(1)
    clock.now += 31_000
    await scan.knownGauges()
    expect(reads).toBe(2)
  })

  it("counts a snapshot read that hangs as failed", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    let reads = 0
    const scan = context(() => {
      reads += 1
      return new Promise<never>(() => undefined)
    })
    const first = scan.knownGauges()
    await vi.advanceTimersByTimeAsync(2_000)
    expect((await first).rewards).toEqual([])
    expect((await scan.knownGauges()).rewards).toEqual([])
    expect(reads).toBe(1)
  })
})
