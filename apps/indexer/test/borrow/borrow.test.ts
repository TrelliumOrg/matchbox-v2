import { BORROW_CONTRACTS, ENCLAVE_ROLE, MORPHO_MARKETS } from "@matchbox/chain"
import {
  type Address,
  encodeAbiParameters,
  encodeEventTopics,
  type Hex,
  parseAbi,
  toHex,
} from "viem"
import { beforeAll, describe, expect, it } from "vitest"
import {
  BORROW_DECODER_VERSION,
  BorrowDecoder,
  discoverEnclave,
} from "../../src/borrow/decoder"
import {
  type BorrowDeps,
  borrowStaticContracts,
  ingestBorrowRange,
  ingestBorrowToHead,
} from "../../src/borrow/ingest"
import type { BorrowContract, MorphoMarketRow } from "../../src/borrow/rows"
import {
  BorrowCheckpointMovedError,
  BorrowReplayRequiredError,
  isMissingBorrowSchema,
  MemoryBorrowStore,
} from "../../src/borrow/store"
import type { NetworkConfig } from "../../src/ingest/networks"
import { type RawLog, type RawTx, RpcClient } from "../../src/ingest/rpc"
import {
  type BorrowFixture,
  loadBorrowFixture,
  RecordedChain,
} from "./recorded-chain"

const CONFIG: NetworkConfig = {
  network: "mezo",
  chainId: 31612,
  startBlock: 5_000_000n,
  confirmations: 2n,
  windowSize: 10_000n,
  endpoints: [
    { url: "https://recorded.test", maxAddresses: 100, maxBlockRange: 10_000 },
  ],
}

const ENCLAVE_B = BORROW_CONTRACTS.mainnet.enclaveB.toLowerCase() as Address
const BTC_MUSDC = MORPHO_MARKETS.mainnet.btcMusdc
const BTC_MUSD = MORPHO_MARKETS.mainnet.btcMusd
const OPEN_POSITION =
  "0x147379a0174780570d07d70a6a5610d300000000000000000000000000000000"

function deps(
  fixture: BorrowFixture,
  store: MemoryBorrowStore,
  staticContracts: BorrowContract[] = borrowStaticContracts("mezo"),
): BorrowDeps & { chain: RecordedChain } {
  // Head two blocks past the fixture's end, so its last block is safe.
  const chain = new RecordedChain(
    fixture.rawLogs,
    fixture.transactions,
    BigInt(fixture.to) + CONFIG.confirmations,
  )
  return {
    chain,
    config: CONFIG,
    rpc: new RpcClient({
      network: "mezo",
      endpoints: CONFIG.endpoints,
      fetch: chain.fetch,
      sleep: async () => {},
    }),
    store,
    staticContracts,
  }
}

// encodeEventTopics types topics as possibly null or nested; every event
// here has plain topics.
function hexTopics(topics: readonly unknown[]): Hex[] {
  return topics.filter((topic): topic is Hex => typeof topic === "string")
}

function count<T extends string>(values: T[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1
  return counts
}

function marketTuple(market: MorphoMarketRow | undefined): string[] {
  if (!market) return []
  return [
    market.totalSupplyAssets,
    market.totalSupplyShares,
    market.totalBorrowAssets,
    market.totalBorrowShares,
    market.lastUpdate,
    market.fee,
  ].map((value) => value.toString())
}

describe("borrow stream over recorded mainnet history", () => {
  let fixture: BorrowFixture
  let store: MemoryBorrowStore

  beforeAll(async () => {
    fixture = loadBorrowFixture()
    store = new MemoryBorrowStore()
    // Two ticks, as the cron would run them: the second resumes from the
    // first one's checkpoint and reloads its state from the store.
    await ingestBorrowToHead(deps(fixture, store), 2_500_000n)
    await ingestBorrowToHead(deps(fixture, store), 5_000_000n)
  }, 120_000)

  it("reaches the fixture's last block", () => {
    expect(store.checkpoints.get("mezo")).toBe(BigInt(fixture.to))
  })

  it("replays Morpho market totals to Morpho.market(id) on chain", () => {
    for (const id of [BTC_MUSDC, BTC_MUSD]) {
      expect(marketTuple(store.markets.get(`mezo:${id}`)), id).toEqual(
        fixture.expected.markets[id],
      )
    }
  })

  it("sums collateral to Morpho's BTC balance", () => {
    const collateral = [...store.markets.values()].reduce(
      (sum, market) => sum + market.totalCollateral,
      0n,
    )
    expect(collateral).toBe(BigInt(fixture.expected.morphoBtcBalance))
  })

  it("records both markets with their parameters", () => {
    expect(store.markets.get(`mezo:${BTC_MUSDC}`)).toMatchObject({
      loanToken: "0x04671c72aab5ac02a03c1098314b1bb6b560c197",
      collateralToken: "0x7b7c000000000000000000000000000000000000",
      irm: "0x3760ebc636f912a4db9540fda4dec09c25c6c1e7",
      lltv: 860_000_000_000_000_000n,
      loanDecimals: 6,
      collateralDecimals: 18,
      createdBlock: 9_274_335n,
    })
    expect(store.markets.get(`mezo:${BTC_MUSD}`)).toMatchObject({
      loanToken: "0xdd468a1ddc392dcdbef6db6e34e89aa338f9f186",
      loanDecimals: 18,
      createdBlock: 12_755_635n,
    })
  })

  it("classifies every Morpho event the research counted", () => {
    const rows = [...store.morphoEvents.values()]
    // docs/research/mezo-borrow-markets.md, "Morpho markets".
    expect(count(rows.map((row) => row.action))).toEqual({
      MARKET_CREATED: 2,
      SUPPLIED: 157,
      WITHDRAWN: 196,
      COLLATERAL_SUPPLIED: 203,
      COLLATERAL_WITHDRAWN: 244,
      BORROWED: 182,
      REPAID: 306,
      INTEREST_ACCRUED: 1_082,
    })
    for (const row of rows) {
      expect(row.timestamp).toBeGreaterThan(0n)
      expect(row.txFrom).toMatch(/^0x[0-9a-f]{40}$/)
    }
  })

  it("ends every Enclave position where getPosition does", () => {
    const state = store.loadState("mezo")
    return state.then(({ positions }) => {
      expect(positions.size).toBe(
        Object.keys(fixture.expected.positions).length,
      )
      for (const [id, expected] of Object.entries(fixture.expected.positions)) {
        const position = positions.get(id as Hex)
        expect(position, id).toBeDefined()
        expect(position?.principal.toString()).toBe(expected.principal)
        expect(position?.enclave).toBe(expected.enclave)
        expect(position?.borrower).toBe(expected.borrower)
        // 1 active, 2 closedByRepayment.
        expect(position?.open).toBe(expected.status === 1)
        expect(position?.pledged.map(String)).toEqual(expected.pledgedVeBtc)
      }
      const open = [...positions.values()].filter((position) => position.open)
      expect(open.reduce((sum, position) => sum + position.principal, 0n)).toBe(
        BigInt(fixture.expected.totalPrincipal),
      )
    })
  })

  it("puts a veBTC token id on every Enclave row", () => {
    const rows = [...store.enclaveEvents.values()]
    for (const row of rows) expect(row.veBtcTokenId).toBeGreaterThan(0n)
    expect(count(rows.map((row) => row.action))).toEqual({
      POSITION_OPENED: 4,
      DEBT_INCREASED: 2,
      DEBT_REPAID: 4,
      POSITION_CLOSED: 3,
      COLLATERAL_PLEDGED: 1,
      COLLATERAL_RELEASED: 1,
      VEBTC_LOCKED: 4,
      VEBTC_INCREASED: 3,
      VEBTC_WITHDRAWN: 2,
    })
  })

  it("tracks the open 4M MUSD position on veBTC #6033", () => {
    const rows = [...store.enclaveEvents.values()].filter(
      (row) => row.positionId === OPEN_POSITION,
    )
    const opened = rows.find((row) => row.action === "POSITION_OPENED")
    expect(opened).toMatchObject({
      blockNumber: 10_441_838n,
      veBtcTokenId: 6033n,
      enclave: ENCLAVE_B,
      borrower: ENCLAVE_B,
      amount: 4_000_000n * 10n ** 18n,
      principal: 4_000_000n * 10n ** 18n,
      interestRate: 100,
      originatorFeeRate: 0,
      warningCr: 1_500_000_000_000_000_000n,
      minimumCr: 1_100_000_000_000_000_000n,
      pledgedVeBtc: [6033n],
    })
  })

  // Enclave A: #5730 backs two positions, then #6114 replaces it in one
  // transaction on 15 Sep (pledge #6114, withdraw #5730, top up #6114,
  // release #5730), and the repayments match the research to the wei.
  it("follows veBTC #5730 through two positions and out", () => {
    const rows = [...store.enclaveEvents.values()]
      .filter((row) => row.veBtcTokenId === 5730n)
      .sort(
        (left, right) =>
          Number(left.blockNumber - right.blockNumber) ||
          left.logIndex - right.logIndex,
      )
    expect(rows.map((row) => [row.blockNumber, row.action])).toEqual([
      [8_223_071n, "VEBTC_LOCKED"],
      [8_247_411n, "VEBTC_INCREASED"],
      [8_565_161n, "POSITION_OPENED"],
      [8_927_044n, "VEBTC_INCREASED"],
      [8_927_109n, "DEBT_INCREASED"],
      [9_917_135n, "DEBT_REPAID"],
      [9_917_213n, "DEBT_INCREASED"],
      [10_034_468n, "DEBT_REPAID"],
      [10_034_468n, "POSITION_CLOSED"],
      [10_060_088n, "POSITION_OPENED"],
      [11_870_606n, "VEBTC_WITHDRAWN"],
      [11_870_606n, "COLLATERAL_RELEASED"],
    ])
    expect(rows[7]).toMatchObject({
      amount: 10_503_104_806_106_416_293_068_445n,
      principal: 0n,
    })
    const swap = [...store.enclaveEvents.values()].filter(
      (row) => row.blockNumber === 11_870_606n,
    )
    expect(
      swap
        .sort((left, right) => left.logIndex - right.logIndex)
        .map((row) => [row.action, row.veBtcTokenId, row.pledgedVeBtc]),
    ).toEqual([
      ["COLLATERAL_PLEDGED", 6114n, [5730n, 6114n]],
      ["VEBTC_WITHDRAWN", 5730n, [5730n, 6114n]],
      ["VEBTC_INCREASED", 6114n, [5730n, 6114n]],
      ["COLLATERAL_RELEASED", 5730n, [6114n]],
    ])
  })
})

describe("borrow stream discovery", () => {
  it("finds an Enclave from RoleGranted and fetches its earlier history", async () => {
    const fixture = loadBorrowFixture()
    const full = new MemoryBorrowStore()
    await ingestBorrowToHead(deps(fixture, full), 5_000_000n)

    // Enclave B unknown up front: governance granted it ENCLAVE_ROLE at
    // block 10,438,258, after it had locked veBTC #6026 and #6033.
    const store = new MemoryBorrowStore()
    const statics = borrowStaticContracts("mezo").filter(
      (contract) => contract.address !== ENCLAVE_B,
    )
    const run = deps(fixture, store, statics)
    const summary = await ingestBorrowRange(run, {
      from: 8_199_414n,
      to: BigInt(fixture.to),
      concurrency: 4,
    })
    expect(summary.contracts).toBe(1)
    expect(store.contracts.get(`mezo:${ENCLAVE_B}`)).toMatchObject({
      kind: "enclave",
      template: "Enclave",
      createdBlock: 8_199_414n,
    })
    const strip = (rows: Map<string, unknown>) => [...rows.keys()].sort()
    expect(strip(store.enclaveEvents)).toEqual(strip(full.enclaveEvents))
    expect([...store.enclaveEvents.values()]).toEqual(
      expect.arrayContaining([...full.enclaveEvents.values()]),
    )
    expect(strip(store.morphoEvents)).toEqual(strip(full.morphoEvents))
  }, 120_000)

  it("ignores roles other than ENCLAVE_ROLE", () => {
    const abi = parseAbi([
      "event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender)",
    ])
    const log = (role: Hex): RawLog => ({
      network: "mezo",
      blockNumber: 1n,
      blockHash: toHex(1, { size: 32 }),
      blockTimestamp: 1n,
      txHash: toHex(2, { size: 32 }),
      txIndex: 0,
      logIndex: 0,
      address: "0x2c5e9afbb670c4a61ac2dcad62c258ee2391389a",
      topics: hexTopics(
        encodeEventTopics({
          abi,
          eventName: "RoleGranted",
          args: {
            role,
            account: "0x00000000000000000000000000000000000000aa",
            sender: "0x00000000000000000000000000000000000000bb",
          },
        }),
      ),
      data: "0x",
    })
    expect(
      discoverEnclave(log(ENCLAVE_ROLE), "enclaveDebtManager"),
    ).toMatchObject({
      address: "0x00000000000000000000000000000000000000aa",
      kind: "enclave",
    })
    expect(
      discoverEnclave(log(toHex(7, { size: 32 })), "enclaveDebtManager"),
    ).toBe(null)
    expect(discoverEnclave(log(ENCLAVE_ROLE), "enclave")).toBe(null)
  })
})

describe("borrow checkpoint and version", () => {
  it("refuses a window when the checkpoint moved", async () => {
    const store = new MemoryBorrowStore()
    store.checkpoints.set("mezo", 9_000_000n)
    await expect(
      store.commitWindow({
        network: "mezo",
        fromBlock: 8_999_001n,
        toBlock: 9_000_000n,
        expectedCheckpoint: 8_999_000n,
        contracts: [],
        morphoEvents: [],
        enclaveEvents: [],
        markets: [],
      }),
    ).rejects.toBeInstanceOf(BorrowCheckpointMovedError)
  })

  it("only continues from its checkpoint", async () => {
    const fixture = loadBorrowFixture()
    const store = new MemoryBorrowStore()
    await expect(
      ingestBorrowRange(deps(fixture, store), {
        from: 9_000_000n,
        to: 9_100_000n,
      }),
    ).rejects.toThrow("must continue from block 8199414")
  })

  it("halts on tables built by another decoder version", async () => {
    const fixture = loadBorrowFixture()
    const store = new MemoryBorrowStore()
    store.versions.set("mezo", BORROW_DECODER_VERSION + 1)
    await expect(
      ingestBorrowToHead(deps(fixture, store), 10_000n),
    ).rejects.toBeInstanceOf(BorrowReplayRequiredError)
    await store.reset("mezo")
    await ingestBorrowToHead(deps(fixture, store), 10_000n)
    expect(store.versions.get("mezo")).toBe(BORROW_DECODER_VERSION)
  })

  it("is idle at head", async () => {
    const fixture = loadBorrowFixture()
    const store = new MemoryBorrowStore()
    store.checkpoints.set("mezo", BigInt(fixture.to))
    store.versions.set("mezo", BORROW_DECODER_VERSION)
    expect(await ingestBorrowToHead(deps(fixture, store), 10_000n)).toBe(null)
  })

  it("recognises a database without the borrow tables", () => {
    expect(isMissingBorrowSchema({ code: "42P01" })).toBe(true)
    expect(isMissingBorrowSchema(new Error("boom"))).toBe(false)
  })
})

// Morpho has never liquidated or charged a fee on Mezo, and no Enclave has
// merged veBTC, so these run on logs built from the verified ABIs.
describe("borrow decoder on events mainnet has not emitted yet", () => {
  const MORPHO = "0x565834ce7e40b8987bc20ebf83e2159467bda311"
  const MARKET: Hex = `0x${"11".repeat(32)}`
  const morphoAbi = parseAbi([
    "event CreateMarket(bytes32 indexed id, (address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams)",
    "event Liquidate(bytes32 indexed id, address indexed caller, address indexed borrower, uint256 repaidAssets, uint256 repaidShares, uint256 seizedAssets, uint256 badDebtAssets, uint256 badDebtShares)",
    "event SetFee(bytes32 indexed id, uint256 newFee)",
    "event Borrow(bytes32 indexed id, address caller, address indexed onBehalf, address indexed receiver, uint256 assets, uint256 shares)",
    "event Supply(bytes32 indexed id, address indexed caller, address indexed onBehalf, uint256 assets, uint256 shares)",
    "event SupplyCollateral(bytes32 indexed id, address indexed caller, address indexed onBehalf, uint256 assets)",
  ])
  const USER = "0x00000000000000000000000000000000000000aa"
  const tx: RawTx = {
    network: "mezo",
    hash: `0x${"22".repeat(32)}`,
    blockNumber: 1n,
    txIndex: 0,
    from: USER,
    to: null,
    input: "0x",
  }
  let logIndex = 0

  function log(
    address: Address,
    topics: readonly unknown[],
    data: Hex,
  ): RawLog {
    return {
      network: "mezo",
      blockNumber: 100n,
      blockHash: `0x${"33".repeat(32)}`,
      blockTimestamp: 1_800_000_000n,
      txHash: tx.hash,
      txIndex: 0,
      logIndex: logIndex++,
      address,
      topics: hexTopics(topics),
      data,
    }
  }

  it("removes repaid debt, seized collateral and bad debt on Liquidate", () => {
    const decoder = new BorrowDecoder("mezo", {
      markets: new Map(),
      positions: new Map(),
    })
    const apply = (topics: readonly unknown[], data: Hex) =>
      decoder.apply(log(MORPHO, topics, data), tx, "morphoBlue")
    apply(
      encodeEventTopics({
        abi: morphoAbi,
        eventName: "CreateMarket",
        args: { id: MARKET },
      }),
      encodeAbiParameters(
        [
          {
            type: "tuple",
            components: [
              { name: "loanToken", type: "address" },
              { name: "collateralToken", type: "address" },
              { name: "oracle", type: "address" },
              { name: "irm", type: "address" },
              { name: "lltv", type: "uint256" },
            ],
          },
        ],
        [
          {
            loanToken: "0x04671c72aab5ac02a03c1098314b1bb6b560c197",
            collateralToken: "0x7b7c000000000000000000000000000000000000",
            oracle: USER,
            irm: USER,
            lltv: 860_000_000_000_000_000n,
          },
        ],
      ),
    )
    apply(
      encodeEventTopics({
        abi: morphoAbi,
        eventName: "Supply",
        args: { id: MARKET, caller: USER, onBehalf: USER },
      }),
      encodeAbiParameters(
        [{ type: "uint256" }, { type: "uint256" }],
        [1_000n, 1_000_000n],
      ),
    )
    apply(
      encodeEventTopics({
        abi: morphoAbi,
        eventName: "SupplyCollateral",
        args: { id: MARKET, caller: USER, onBehalf: USER },
      }),
      encodeAbiParameters([{ type: "uint256" }], [50n]),
    )
    apply(
      encodeEventTopics({
        abi: morphoAbi,
        eventName: "Borrow",
        args: { id: MARKET, onBehalf: USER, receiver: USER },
      }),
      encodeAbiParameters(
        [{ type: "address" }, { type: "uint256" }, { type: "uint256" }],
        [USER, 800n, 800_000n],
      ),
    )
    apply(
      encodeEventTopics({
        abi: morphoAbi,
        eventName: "Liquidate",
        args: { id: MARKET, caller: USER, borrower: USER },
      }),
      encodeAbiParameters(
        Array.from({ length: 5 }, () => ({ type: "uint256" })),
        [700n, 700_000n, 50n, 100n, 100_000n],
      ),
    )
    apply(
      encodeEventTopics({
        abi: morphoAbi,
        eventName: "SetFee",
        args: { id: MARKET },
      }),
      encodeAbiParameters([{ type: "uint256" }], [50_000_000_000_000_000n]),
    )
    const { markets, morphoEvents } = decoder.drain()
    expect(markets[0]).toMatchObject({
      totalSupplyAssets: 900n,
      totalSupplyShares: 1_000_000n,
      totalBorrowAssets: 0n,
      totalBorrowShares: 0n,
      totalCollateral: 0n,
      fee: 50_000_000_000_000_000n,
    })
    expect(
      morphoEvents.find((row) => row.action === "LIQUIDATED"),
    ).toMatchObject({
      onBehalf: USER,
      assets: 700n,
      shares: 700_000n,
      seizedAssets: 50n,
      badDebtAssets: 100n,
      badDebtShares: 100_000n,
    })
  })

  it("keys a merge by the surviving veBTC", () => {
    const abi = parseAbi([
      "event VeBTCMerged(uint256 indexed fromTokenId, uint256 indexed toTokenId)",
    ])
    const decoder = new BorrowDecoder("mezo", {
      markets: new Map(),
      positions: new Map([
        [
          OPEN_POSITION,
          {
            positionId: OPEN_POSITION,
            enclave: ENCLAVE_B,
            borrower: ENCLAVE_B,
            principal: 5n,
            pledged: [6033n],
            open: true,
          },
        ],
      ]),
    })
    decoder.apply(
      log(
        ENCLAVE_B,
        encodeEventTopics({
          abi,
          eventName: "VeBTCMerged",
          args: { fromTokenId: 7000n, toTokenId: 6033n },
        }),
        "0x",
      ),
      tx,
      "enclave",
    )
    expect(decoder.drain().enclaveEvents).toEqual([
      expect.objectContaining({
        action: "VEBTC_MERGED",
        veBtcTokenId: 6033n,
        otherVeBtcTokenId: 7000n,
        positionId: OPEN_POSITION,
        principal: 5n,
        pledgedVeBtc: [6033n],
      }),
    ])
  })

  it("fails loudly on a debt event for an unknown position", () => {
    const abi = parseAbi([
      "event DebtRepaid(bytes32 indexed positionId, uint256 amount, uint256 remainingPrincipal)",
    ])
    const decoder = new BorrowDecoder("mezo", {
      markets: new Map(),
      positions: new Map(),
    })
    expect(() =>
      decoder.apply(
        log(
          "0x2c5e9afbb670c4a61ac2dcad62c258ee2391389a",
          encodeEventTopics({
            abi,
            eventName: "DebtRepaid",
            args: { positionId: OPEN_POSITION },
          }),
          encodeAbiParameters(
            [{ type: "uint256" }, { type: "uint256" }],
            [1n, 0n],
          ),
        ),
        tx,
        "enclaveDebtManager",
      ),
    ).toThrow("was never opened")
  })
})
