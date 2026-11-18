import { describe, expect, it } from "vitest"
import addressFixture from "./fixtures/address.json"
import addressCounters from "./fixtures/address-counters.json"
import addressLogs from "./fixtures/address-logs.json"
import addressTokenTransfers from "./fixtures/address-token-transfers.json"
import addressTokens from "./fixtures/address-tokens.json"
import addressTransactions from "./fixtures/address-transactions.json"
import block from "./fixtures/block.json"
import blockTransactions from "./fixtures/block-transactions.json"
import blocks from "./fixtures/blocks.json"
import mainPageBlocks from "./fixtures/main-page-blocks.json"
import mainPageTransactions from "./fixtures/main-page-transactions.json"
import search from "./fixtures/search.json"
import searchQuick from "./fixtures/search-quick.json"
import smartContract from "./fixtures/smart-contract.json"
import stats from "./fixtures/stats.json"
import marketChart from "./fixtures/stats-charts-market.json"
import transactionsChart from "./fixtures/stats-charts-transactions.json"
import token from "./fixtures/token.json"
import tokenCounters from "./fixtures/token-counters.json"
import tokenHolders from "./fixtures/token-holders.json"
import tokenTransfers from "./fixtures/token-transfers.json"
import tokens from "./fixtures/tokens.json"
import transaction from "./fixtures/transaction.json"
import internalTransactions from "./fixtures/transaction-internal-transactions.json"
import internalPending from "./fixtures/transaction-internal-transactions-pending.json"
import transactionLogs from "./fixtures/transaction-logs.json"
import rawTrace from "./fixtures/transaction-raw-trace.json"
import transactionTokenTransfers from "./fixtures/transaction-token-transfers.json"
import transactions from "./fixtures/transactions.json"
import { checkQuery, type HeadContext, matchRoute, proxyRoutes } from "./routes"

const tx = "0x45e0962d6c0fa8ae9d30ba18cf7351ac0fcf3c0487fd231107510ebb0db66988"
const contract = "0x2ba614a598cffa5a19d683cdca97bac3a49313d1"
const musd = "0xdd468a1ddc392dcdbef6db6e34e89aa338f9f186"
/** The fixture transaction's block. */
const txBlock = 13_118_064

/** Far past every fixture block: everything recorded is final. */
const later: HeadContext = { height: 13_200_000, finalityDepth: 30 }
/** Right at the fixture block: nothing is final yet. */
const atBlock: HeadContext = { height: txBlock + 5, finalityDepth: 30 }
const noHead: HeadContext = { height: null, finalityDepth: 30 }

/** Every allowlisted path with a recorded upstream body. */
const recorded: Record<string, unknown> = {
  blocks,
  [`blocks/${txBlock}`]: block,
  [`blocks/${txBlock}/transactions`]: blockTransactions,
  transactions,
  [`transactions/${tx}`]: transaction,
  [`transactions/${tx}/logs`]: transactionLogs,
  [`transactions/${tx}/token-transfers`]: transactionTokenTransfers,
  [`transactions/${tx}/internal-transactions`]: internalTransactions,
  [`transactions/${tx}/raw-trace`]: rawTrace,
  [`addresses/${contract}`]: addressFixture,
  [`addresses/${contract}/counters`]: addressCounters,
  [`addresses/${contract}/transactions`]: addressTransactions,
  [`addresses/${contract}/token-transfers`]: addressTokenTransfers,
  [`addresses/${contract}/tokens`]: addressTokens,
  [`addresses/${contract}/logs`]: addressLogs,
  tokens,
  [`tokens/${musd}`]: token,
  [`tokens/${musd}/counters`]: tokenCounters,
  [`tokens/${musd}/holders`]: tokenHolders,
  [`tokens/${musd}/transfers`]: tokenTransfers,
  search,
  "search/quick": searchQuick,
  stats,
  "stats/charts/transactions": transactionsChart,
  "stats/charts/market": marketChart,
  "main-page/blocks": mainPageBlocks,
  "main-page/transactions": mainPageTransactions,
  [`smart-contracts/${contract}`]: smartContract,
}

function decode(path: string, raw: unknown, head: HeadContext = later) {
  const matched = matchRoute(path)
  if (matched === null) throw new Error(`No route for ${path}`)
  const decoded = matched.route.decode(raw, head)
  if (!decoded.ok) {
    throw new Error(`${path}: ${JSON.stringify(decoded.error.issues)}`)
  }
  return decoded
}

/** Every key anywhere in a JSON value. */
function keysOf(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) keysOf(item, into)
  } else if (typeof value === "object" && value !== null) {
    for (const [key, inner] of Object.entries(value)) {
      into.add(key)
      keysOf(inner, into)
    }
  }
  return into
}

describe("allowlist", () => {
  it("has a recorded upstream body for every route", () => {
    const covered = new Set(
      Object.keys(recorded).map((path) => matchRoute(path)?.route.template),
    )
    expect([...covered].sort()).toEqual(
      proxyRoutes.map((route) => route.template).sort(),
    )
  })

  it("rejects paths outside the allowlist", () => {
    for (const path of [
      "",
      "config",
      "blocks/",
      "blocks/abc",
      "blocks/-1",
      "blocks/01",
      `transactions/${tx}/state-changes`,
      `transactions/${tx.slice(0, 20)}`,
      `addresses/${contract}/coin-balance-history`,
      `addresses/${contract}/internal-transactions`,
      "smart-contracts",
      "stats/charts/gas",
      "main-page/indexing-status",
      "../api/v1",
      `tokens/${musd}/instances`,
      "withdrawals",
    ]) {
      expect(matchRoute(path), path).toBeNull()
    }
  })

  it("accepts a block by height or hash", () => {
    expect(matchRoute("blocks/0")?.route.template).toBe("blocks/{block}")
    expect(matchRoute(`blocks/${"0x".padEnd(66, "a")}`)?.route.template).toBe(
      "blocks/{block}",
    )
  })

  it("checks query parameters by name, shape and count", () => {
    const blocksRoute = matchRoute("blocks")?.route
    const searchRoute = matchRoute("search")?.route
    const holders = matchRoute(`tokens/${musd}/holders`)?.route
    if (!blocksRoute || !searchRoute || !holders) throw new Error("missing")
    const query = (text: string) => new URLSearchParams(text)
    expect(
      checkQuery(blocksRoute, query("items_count=50&block_number=13118528")),
    ).toEqual({
      ok: true,
      canonical: "block_number=13118528&items_count=50",
      cursored: true,
      cursorBlock: 13_118_528,
    })
    expect(checkQuery(blocksRoute, query("limit=10"))).toMatchObject({
      reason: "unknown",
    })
    expect(checkQuery(blocksRoute, query("block_number=abc"))).toMatchObject({
      reason: "malformed",
    })
    expect(
      checkQuery(blocksRoute, query("block_number=1&block_number=2")),
    ).toMatchObject({ reason: "repeated" })
    expect(checkQuery(searchRoute, query(""))).toMatchObject({
      reason: "missing",
    })
    expect(checkQuery(searchRoute, query("q=MUSD"))).toEqual({
      ok: true,
      canonical: "q=MUSD",
      cursored: false,
    })
    expect(checkQuery(searchRoute, query("q=%00"))).toMatchObject({
      reason: "malformed",
    })
    // Holders: the first page only.
    expect(checkQuery(holders, query("items_count=50"))).toMatchObject({
      reason: "unknown",
    })
    expect(checkQuery(blocksRoute, query("apikey=x"))).toMatchObject({
      reason: "unknown",
    })
  })

  it("requires a complete cursor and allows items_count only with one", () => {
    const addressTxs = matchRoute(`addresses/${contract}/transactions`)?.route
    const txs = matchRoute("transactions")?.route
    if (!addressTxs || !txs) throw new Error("missing")
    const query = (text: string) => new URLSearchParams(text)
    // The cursor Blockscout returned for the recorded address page.
    const cursor = new URLSearchParams(
      Object.entries(addressTransactions.next_page_params ?? {}).map(
        ([name, item]) => [name, String(item)],
      ),
    )
    expect(checkQuery(addressTxs, cursor).ok).toBe(true)
    cursor.delete("fee")
    expect(checkQuery(addressTxs, cursor)).toMatchObject({ reason: "partial" })
    expect(checkQuery(txs, query("block_number=13116321"))).toMatchObject({
      reason: "partial",
    })
    expect(checkQuery(txs, query("items_count=50"))).toMatchObject({
      reason: "partial",
    })
    expect(
      checkQuery(txs, query("block_number=13116321&index=0&items_count=50")),
    ).toMatchObject({ ok: true })
    // Junk in a cursor field is rejected before any upstream read.
    expect(
      checkQuery(txs, query("block_number=13116321&index=zz")),
    ).toMatchObject({ reason: "malformed" })
  })

  it("lower-cases hashes and addresses so case cannot fork keys", () => {
    const transfers = matchRoute(`addresses/${contract}/token-transfers`)?.route
    const logs = matchRoute(`addresses/${contract}/logs`)?.route
    if (!transfers || !logs) throw new Error("missing")
    const upper = `0x${"AB".repeat(20)}`
    expect(
      checkQuery(transfers, new URLSearchParams(`token=${upper}`)),
    ).toEqual({
      ok: true,
      canonical: `token=${upper.toLowerCase()}`,
      cursored: false,
    })
    const topic = `0x${"CD".repeat(32)}`
    expect(checkQuery(logs, new URLSearchParams(`topic=${topic}`))).toEqual({
      ok: true,
      canonical: `topic=${topic.toLowerCase()}`,
      cursored: false,
    })
  })
})

describe("schemas", () => {
  it("validate every recorded body", () => {
    for (const [path, raw] of Object.entries(recorded)) {
      expect(() => decode(path, raw), path).not.toThrow()
    }
  })

  it("trim to the explorer's fields", () => {
    const list = decode("transactions", transactions).body
    const listKeys = keysOf(list)
    for (const dropped of [
      "raw_input",
      "decoded_input",
      "confirmations",
      "exchange_rate",
      "ens_domain_name",
      "private_tags",
      "watchlist_names",
    ]) {
      expect(listKeys.has(dropped), dropped).toBe(false)
    }
    const detail = keysOf(decode(`transactions/${tx}`, transaction).body)
    expect(detail.has("raw_input")).toBe(true)
    expect(detail.has("decoded_input")).toBe(true)
    // Moving figures never sit inside an immutable transaction.
    expect(detail.has("confirmations")).toBe(false)
    expect(detail.has("exchange_rate")).toBe(false)
    expect(detail.has("holders_count")).toBe(false)
    expect(detail.has("total_supply")).toBe(false)
    const contractKeys = keysOf(
      decode(`smart-contracts/${contract}`, smartContract).body,
    )
    expect(contractKeys.has("source_code")).toBe(false)
    expect(contractKeys.has("deployed_bytecode")).toBe(false)
    expect(contractKeys.has("abi")).toBe(true)
  })

  it("keeps amounts as the exact strings Blockscout sent", () => {
    const decoded = decode(`tokens/${musd}`, token).body
    expect(decoded).toMatchObject({
      total_supply: "19009212613409522617586413",
      decimals: "18",
      holders_count: "29242",
    })
    const detail = decode(`transactions/${tx}`, transaction).body
    expect(detail).toMatchObject({
      fee: { type: "actual", value: "275749987500" },
      value: "0",
    })
    const statsBody = decode("stats", stats).body
    expect(statsBody).toMatchObject({ coin_price: "74973" })
  })

  it("keeps Blockscout's field names for the fields it keeps", () => {
    const detail = decode(`transactions/${tx}`, transaction).body
    expect(detail).toMatchObject({
      hash: tx,
      block_number: txBlock,
      status: "ok",
      from: { hash: "0x4582A89e307387293c7F93C11a095a8DD3d3F901" },
    })
  })

  it("flattens the raw trace into a summary", () => {
    const trace = decode(`transactions/${tx}/raw-trace`, rawTrace).body
    expect(trace).toMatchObject({
      truncated: false,
      frames: [
        {
          depth: 0,
          type: "call",
          from: "0x4582a89e307387293c7f93c11a095a8dd3d3f901",
          to: "0xd97576d5fed11c7c31095d4fd0af612dc736679b",
          value: "0",
          gas_used: "188547",
          error: null,
        },
        { depth: 1, type: "call" },
        { depth: 2, type: "delegatecall" },
      ],
    })
    expect(keysOf(trace).has("input")).toBe(false)
  })

  it("fails on a shape change", () => {
    const matched = matchRoute(`blocks/${txBlock}`)
    if (matched === null) throw new Error("missing")
    const broken = matched.route.decode({ ...block, height: "13118064" }, later)
    expect(broken.ok).toBe(false)
  })
})

describe("cache classes", () => {
  function classOf(path: string, head: HeadContext, raw = recorded[path]) {
    return decode(path, raw, head).cacheClass
  }

  const settledTransaction = {
    ...transaction,
    has_error_in_internal_transactions: false,
  }

  it("makes final, settled chain data immutable", () => {
    for (const path of [
      `blocks/${txBlock}`,
      `blocks/${txBlock}/transactions`,
      `transactions/${tx}/logs`,
      `transactions/${tx}/token-transfers`,
      `transactions/${tx}/raw-trace`,
    ]) {
      expect(classOf(path, later), path).toBe("immutable")
    }
    expect(classOf(`transactions/${tx}`, later, settledTransaction)).toBe(
      "immutable",
    )
  })

  it("gives final data whose enrichment may change a day, not a year", () => {
    // As recorded: Blockscout has not set has_error_in_internal_transactions.
    expect(classOf(`transactions/${tx}`, later)).toBe("final")
    // A contract that may be verified later.
    const unverifiedTarget = {
      ...settledTransaction,
      to: { ...transaction.to, is_verified: false },
    }
    expect(classOf(`transactions/${tx}`, later, unverifiedTarget)).toBe("final")
    // Input not decoded yet for a contract call.
    const undecoded = { ...settledTransaction, decoded_input: null }
    expect(classOf(`transactions/${tx}`, later, undecoded)).toBe("final")
    // Undecoded logs, and token metadata Blockscout has not filled.
    const undecodedLogs = {
      ...transactionLogs,
      items: transactionLogs.items.map((log) => ({ ...log, decoded: null })),
    }
    expect(classOf(`transactions/${tx}/logs`, later, undecodedLogs)).toBe(
      "final",
    )
    const unnamedToken = {
      ...transactionTokenTransfers,
      items: transactionTokenTransfers.items.map((item) => ({
        ...item,
        token: { ...item.token, symbol: null },
      })),
    }
    expect(
      classOf(`transactions/${tx}/token-transfers`, later, unnamedToken),
    ).toBe("final")
    // An unverified contract in an internal call, as recorded.
    expect(classOf(`transactions/${tx}/internal-transactions`, later)).toBe(
      "final",
    )
  })

  it("keeps chain data per block until the finality depth passes", () => {
    for (const path of [
      `blocks/${txBlock}`,
      `blocks/${txBlock}/transactions`,
      `transactions/${tx}/logs`,
      `transactions/${tx}/token-transfers`,
    ]) {
      expect(classOf(path, atBlock), path).toBe("per-block")
      expect(classOf(path, noHead), path).toBe("per-block")
    }
    expect(classOf(`transactions/${tx}`, atBlock, settledTransaction)).toBe(
      "per-block",
    )
  })

  it("measures finality against Blockscout's own indexed head too", () => {
    // Our RPC says final; Blockscout has indexed only 3 blocks past it.
    const lagging = {
      ...blockTransactions,
      items: blockTransactions.items.map((item) => ({
        ...item,
        confirmations: 3,
      })),
    }
    expect(classOf(`blocks/${txBlock}/transactions`, later, lagging)).toBe(
      "per-block",
    )
    expect(
      classOf(`transactions/${tx}`, later, {
        ...settledTransaction,
        confirmations: 3,
      }),
    ).toBe("per-block")
  })

  it("never freezes an empty block page, by height or by hash", () => {
    const empty = { items: [], next_page_params: null }
    expect(classOf(`blocks/${txBlock}/transactions`, later, empty)).toBe(
      "per-block",
    )
    const byHash = `blocks/0x${"d3".repeat(32)}/transactions`
    expect(classOf(byHash, later, empty)).toBe("per-block")
  })

  it("never freezes a pending transaction or an unindexed range", () => {
    expect(
      classOf(`transactions/${tx}`, later, {
        ...settledTransaction,
        block_number: null,
        status: null,
      }),
    ).toBe("per-block")
    expect(
      classOf(`transactions/${tx}`, later, {
        ...settledTransaction,
        is_pending_update: true,
      }),
    ).toBe("per-block")
    expect(
      classOf(
        `transactions/${tx}/internal-transactions`,
        later,
        internalPending,
      ),
    ).toBe("per-block")
    expect(
      classOf(`blocks/${txBlock}`, later, {
        ...block,
        is_pending_update: true,
      }),
    ).toBe("per-block")
  })

  it("keeps the home page lists per block", () => {
    for (const path of [
      "blocks",
      "transactions",
      "main-page/blocks",
      "main-page/transactions",
    ]) {
      expect(classOf(path, later), path).toBe("per-block")
    }
  })

  it("serves address views stale-while-revalidate", () => {
    for (const path of [
      `addresses/${contract}`,
      `addresses/${contract}/counters`,
      `addresses/${contract}/transactions`,
      `addresses/${contract}/token-transfers`,
      `addresses/${contract}/tokens`,
      `addresses/${contract}/logs`,
      `tokens/${musd}/transfers`,
    ]) {
      expect(classOf(path, later), path).toBe("swr")
    }
  })

  it("caches search for 45 seconds and aggregates as slow", () => {
    expect(classOf("search", later)).toBe("search")
    expect(classOf("search/quick", later)).toBe("search")
    for (const path of [
      "tokens",
      `tokens/${musd}`,
      `tokens/${musd}/counters`,
      `tokens/${musd}/holders`,
      "stats",
      "stats/charts/transactions",
      "stats/charts/market",
      `smart-contracts/${contract}`,
    ]) {
      expect(classOf(path, later), path).toBe("slow")
    }
  })
})

describe("raw trace", () => {
  it("fails a malformed value instead of reading it as zero", () => {
    const matched = matchRoute(`transactions/${tx}/raw-trace`)
    if (matched === null) throw new Error("missing")
    for (const value of ["12", "0xzz", "", "0x"]) {
      const broken = matched.route.decode({ ...rawTrace, value }, later)
      expect(broken.ok, value).toBe(false)
    }
    const withoutValue = { ...rawTrace, value: undefined }
    expect(matched.route.decode(withoutValue, later)).toMatchObject({
      ok: true,
      body: { frames: [{ value: "0" }, {}, {}] },
    })
  })
})
