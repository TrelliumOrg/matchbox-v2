import { applyD1Migrations } from "cloudflare:test"
import { env } from "cloudflare:workers"
import { readReadModel } from "@matchbox/api/read-store"
import { CONTRACTS } from "@matchbox/chain"
import { epochIndexFor, epochStartOf } from "@matchbox/domain"
import { createLogger } from "@matchbox/logger"
import { beforeEach, describe, expect, it } from "vitest"
import recorded from "../../test/fixtures/warehouse.json"
import { resetStorage } from "../../test/reset"
import {
  emptyChainReader,
  fixtureSweepWallets,
} from "../../test/warehouse-fixture"
import { readCursor, writeCursor } from "../cursors"
import { earnedKey, type WalletChainReader } from "./chain"
import { createWarehouseReader, type WarehouseReader } from "./reader"
import { recordedQueryRunner, recordingSchema } from "./recorded"
import { runWarehouseSnapshot } from "./snapshot"

// Replays test/fixtures/warehouse.json: real projection rows recorded from
// the Neon dev branch by scripts/record-warehouse-fixture.ts.

const recording = recordingSchema.parse(recorded)
const logger = createLogger({ level: "error" })

function deps(warehouse: WarehouseReader, trigger: "chained" | "cron") {
  return {
    db: env.READ_DB,
    kv: env.PRICES,
    warehouse,
    chain: emptyChainReader,
    trigger,
    sweepWallets: fixtureSweepWallets,
    nowSeconds: recording.nowSeconds,
    logger,
  }
}

beforeEach(async () => {
  await applyD1Migrations(env.READ_DB, env.TEST_MIGRATIONS)
  await resetStorage()
})

describe("warehouse snapshot (recorded fixture)", () => {
  it("writes wallet and protocol documents that parse", async () => {
    const reader = createWarehouseReader(recordedQueryRunner(recording))
    const result = await runWarehouseSnapshot(deps(reader, "chained"))
    const epochs = epochIndexFor(epochStartOf(recording.nowSeconds)) + 1
    const gaugeHistories = await env.READ_DB.prepare(
      "SELECT count(*) AS n FROM read_models WHERE kind = 'gauge-history'",
    ).first<{ n: number }>()
    // Three per wallet, protocol, its activity, its history, one per epoch
    // since Epoch 0, one history per gauge with votes or incentives, and the
    // funding summary.
    const documents = 4 * 3 + 3 + epochs + (gaugeHistories?.n ?? 0) + 1
    expect(gaugeHistories?.n).toBeGreaterThan(700)
    expect(result).toMatchObject({ status: "ok", wallets: 4, documents })
    if (result.status !== "ok") throw new Error("expected a run")
    expect(result.changed).toBe(documents)

    const wallets = await env.READ_DB.prepare(
      `SELECT doc_key FROM read_models WHERE kind = 'wallet-overview'
       ORDER BY doc_key`,
    ).all<{ doc_key: string }>()
    expect(wallets.results).toHaveLength(4)
    for (const { doc_key: wallet } of wallets.results) {
      const overview = await readReadModel(
        env.READ_DB,
        "mezo",
        "wallet-overview",
        wallet,
      )
      expect(overview?.meta).toMatchObject({
        source: "warehouse",
        block: result.block,
      })
      // The sweep covers every wallet with activity, with or without locks.
      expect(overview?.data.address).toBe(wallet)
      const activity = await readReadModel(
        env.READ_DB,
        "mezo",
        "wallet-activity",
        wallet,
      )
      expect(activity?.data.address).toBe(wallet)
    }
    const protocol = await readReadModel(
      env.READ_DB,
      "mezo",
      "protocol",
      "current",
    )
    expect(protocol?.data.incentivesByEpoch).toHaveLength(epochs)
    expect(protocol?.data.incentivesByEpoch[0]?.epoch.number).toBe(0)
    const history = await readReadModel(
      env.READ_DB,
      "mezo",
      "protocol-history",
      "current",
    )
    expect(history?.data.epochs).toHaveLength(epochs)
    const current = await readReadModel(
      env.READ_DB,
      "mezo",
      "protocol-epoch",
      String(epochs - 1),
    )
    expect(current?.data.stats).toEqual(protocol?.data.stats)
    const first = await readReadModel(
      env.READ_DB,
      "mezo",
      "protocol-epoch",
      "0",
    )
    expect(first?.data.stats).toBeNull()
    expect(protocol?.data.feed.rows.length).toBeGreaterThan(0)
    const activity = await readReadModel(
      env.READ_DB,
      "mezo",
      "protocol-activity",
      "current",
    )
    expect(activity?.data.rows.slice(0, 20)).toEqual(protocol?.data.feed.rows)
    expect(protocol?.data.stats.vemezoLockers).toBeGreaterThan(0)
    const funding = await readReadModel(
      env.READ_DB,
      "mezo",
      "gauge-funding",
      "current",
    )
    expect(Object.keys(funding?.data.gauges ?? {}).length).toBeGreaterThan(0)

    expect(await readCursor(env.READ_DB, "warehouse-block", "mezo")).toBe(
      String(result.block),
    )
    const run = await env.READ_DB.prepare(
      "SELECT trigger, status, rows_written FROM snapshot_runs",
    ).first()
    expect(run).toEqual({
      trigger: "chained",
      status: "ok",
      rows_written: documents,
    })
    expect(await readCursor(env.READ_DB, "warehouse-sweep-size", "mezo")).toBe(
      String(fixtureSweepWallets),
    )
  })

  it("stamps documents with the chain block it read, and rewrites nothing unchanged", async () => {
    const reader = createWarehouseReader(recordedQueryRunner(recording))
    const pinned: WarehouseReader = {
      ...reader,
      // Every run rebuilds the same wallets.
      async changedWallets() {
        return []
      },
      async sweepWallets() {
        return reader.sweepWallets("0x", fixtureSweepWallets)
      },
    }
    // The chain's head when the run reads it; the warehouse's last
    // activity event is an earlier block.
    const chain: WalletChainReader = {
      ...emptyChainReader,
      async head() {
        return 13_182_500
      },
    }
    const first = await runWarehouseSnapshot({
      ...deps(pinned, "chained"),
      chain,
    })
    if (first.status !== "ok") throw new Error("expected a run")
    expect(first.block).toBeLessThan(13_182_500)
    const [wallet] = await reader.sweepWallets("0x", fixtureSweepWallets)
    if (wallet === undefined) throw new Error("fixture has no wallets")
    const overview = await readReadModel(
      env.READ_DB,
      "mezo",
      "wallet-overview",
      wallet,
    )
    // "As of block N" means read at N, not last activity at N.
    expect(overview?.meta.block).toBe(13_182_500)
    expect(overview?.data.claimableAsOf).toEqual({
      block: 13_182_500,
      source: "stored",
      partial: false,
    })
    const protocol = await readReadModel(
      env.READ_DB,
      "mezo",
      "protocol",
      "current",
    )
    expect(protocol?.meta.block).toBe(13_182_500)
    // The cursor for changed wallets stays on the warehouse's own block.
    expect(await readCursor(env.READ_DB, "warehouse-block", "mezo")).toBe(
      String(first.block),
    )

    // The same data again: hundreds of gauge histories and every past
    // protocol epoch are as stored, and none of them is written.
    const second = await runWarehouseSnapshot({
      ...deps(pinned, "chained"),
      chain,
    })
    if (second.status !== "ok") throw new Error("expected a run")
    expect(second.documents).toBe(first.documents)
    expect(second.changed).toBe(0)
  })

  it("never writes the zero address", async () => {
    const reader = createWarehouseReader(recordedQueryRunner(recording))
    const zero = `0x${"0".repeat(40)}`
    const leaky: WarehouseReader = {
      ...reader,
      async changedWallets() {
        return [zero]
      },
    }
    // A block cursor makes the run ask for changed wallets.
    await writeCursor(env.READ_DB, "warehouse-block", "mezo", "1", 1)
    await runWarehouseSnapshot(deps(leaky, "chained"))
    expect(
      await readReadModel(env.READ_DB, "mezo", "wallet-overview", zero),
    ).toBeNull()
  })

  it("builds wallets the API served live and clears their requests", async () => {
    const reader = createWarehouseReader(recordedQueryRunner(recording))
    const swept = await reader.sweepWallets("0x", fixtureSweepWallets)
    const wallet = swept[0]
    if (wallet === undefined) throw new Error("fixture has no wallets")
    await env.READ_DB.prepare(
      "INSERT INTO wallet_requests (network, wallet, requested_at) VALUES ('mezo', ?1, 1)",
    )
      .bind(wallet)
      .run()
    const result = await runWarehouseSnapshot(deps(reader, "chained"))
    expect(result).toMatchObject({ status: "ok", wallets: 4 })
    const left = await env.READ_DB.prepare(
      "SELECT count(*) AS n FROM wallet_requests",
    ).first<{ n: number }>()
    expect(left?.n).toBe(0)
  })

  it("rebuilds a wallet whose claimable could not be read, carrying the last figure", async () => {
    const recordedReader = createWarehouseReader(recordedQueryRunner(recording))
    const swept = await recordedReader.sweepWallets("0x", fixtureSweepWallets)
    const [wallet, other] = swept
    if (wallet === undefined || other === undefined) {
      throw new Error("fixture has no wallets")
    }
    // Lock #848's shape: a veBTC lock voting a pool, 1,124.59 MUSD of fees
    // on the pool gauge's fee contract.
    const pool = "0xb4d498029af77680cd1ef828b967f010d06c51cc"
    const gauge = "0x677817bf3e44b90e8f95222f75e2950b7904a401"
    const fees = "0x33b8b1162f0b86d68cad418d96246ee2c5164a01"
    const musd = "0xdd468a1ddc392dcdbef6db6e34e89aa338f9f186"
    const reader: WarehouseReader = {
      ...recordedReader,
      // Every run rebuilds the same four wallets.
      async changedWallets() {
        return []
      },
      async sweepWallets() {
        return swept
      },
      async locksOf() {
        return [
          {
            contract_address: CONTRACTS.mainnet.veBTC.toLowerCase(),
            token_id: "848",
            owner: wallet,
            amount: "10000000000000000000",
            unlock_at: null,
            is_permanent: true,
            created_at: null,
          },
        ]
      },
      async activeVotes() {
        return [
          {
            voter_contract: CONTRACTS.mainnet.poolsVoter.toLowerCase(),
            token_id: "848",
            gauge: pool,
            current_weight: "50000000000000000000",
            last_updated_at: String(recording.nowSeconds - 86_400),
          },
        ]
      },
    }
    const chain: WalletChainReader = {
      ...emptyChainReader,
      async poolGauges() {
        return { gauges: new Map([[pool, gauge]]), failed: [] }
      },
      async rewardContracts() {
        return { contracts: [{ gauge, rewardContract: fees }], failed: [] }
      },
      async rewardTokens() {
        return { tokens: new Map([[fees, [musd]]]), failed: [], truncated: [] }
      },
      async earned(requests) {
        return {
          earned: new Map(
            requests.map((request) => [
              earnedKey(request),
              1_124_591_570_389_013_644_316n,
            ]),
          ),
          failed: [],
        }
      },
    }
    const claimableOf = async (address: string) =>
      (await readReadModel(env.READ_DB, "mezo", "wallet-overview", address))
        ?.data.claimable.tokens

    await runWarehouseSnapshot({ ...deps(reader, "chained"), chain })
    const musdClaim = [
      expect.objectContaining({ amount: "1124.591570389013644316" }),
    ]
    expect(await claimableOf(wallet)).toEqual(musdClaim)

    // The request carrying gaugeToFees is lost, twice. What did come back
    // says the lock has nothing to claim.
    const lossy: WalletChainReader = {
      ...chain,
      async rewardContracts() {
        return { contracts: [], failed: [gauge] }
      },
    }
    const second = await runWarehouseSnapshot({
      ...deps(reader, "chained"),
      chain: lossy,
      nowSeconds: recording.nowSeconds + 900,
    })
    expect(second).toMatchObject({ status: "ok" })
    // The wallet is rebuilt all the same (this run's document), and the
    // lock's claimable is the figure the last document had, not zero.
    expect(await claimableOf(wallet)).toEqual(musdClaim)
    const stored = await readReadModel(
      env.READ_DB,
      "mezo",
      "wallet-overview",
      wallet,
    )
    expect(stored?.meta.updatedAt).toBe(recording.nowSeconds + 900)
    // It says which block that figure was read at: the first run's.
    const firstBlock = stored?.data.claimableAsOf?.block
    expect(stored?.data.claimableAsOf).toEqual({
      block: firstBlock,
      source: "stored",
      partial: false,
    })
    expect(firstBlock).toBeLessThanOrEqual(stored?.meta.block ?? 0)
    const rewards = await readReadModel(
      env.READ_DB,
      "mezo",
      "wallet-rewards",
      wallet,
    )
    expect(rewards?.data.byLock.map((entry) => entry.lock.tokenId)).toEqual([
      "848",
    ])
    expect(rewards?.data.readyToClaim.tokens).toEqual(musdClaim)
    // Nothing was held back, so nothing is asked for again.
    const again = await env.READ_DB.prepare(
      "SELECT count(*) AS n FROM wallet_requests",
    ).first<{ n: number }>()
    expect(again?.n).toBe(0)

    // A run that reads it again records this run's block.
    await runWarehouseSnapshot({
      ...deps(reader, "chained"),
      chain,
      nowSeconds: recording.nowSeconds + 1_800,
    })
    expect(await claimableOf(wallet)).toEqual(musdClaim)
    const fresh = await readReadModel(
      env.READ_DB,
      "mezo",
      "wallet-overview",
      wallet,
    )
    expect(fresh?.data.claimableAsOf?.block).toBe(fresh?.meta.block)
  })

  it("leaves out a wallet with an unread lock and no earlier documents, and asks again", async () => {
    const recordedReader = createWarehouseReader(recordedQueryRunner(recording))
    const swept = await recordedReader.sweepWallets("0x", fixtureSweepWallets)
    const [wallet] = swept
    if (wallet === undefined) throw new Error("fixture has no wallets")
    const pool = "0xb4d498029af77680cd1ef828b967f010d06c51cc"
    const reader: WarehouseReader = {
      ...recordedReader,
      async changedWallets() {
        return []
      },
      async sweepWallets() {
        return swept
      },
      async locksOf() {
        return [
          {
            contract_address: CONTRACTS.mainnet.veBTC.toLowerCase(),
            token_id: "848",
            owner: wallet,
            amount: "10000000000000000000",
            unlock_at: null,
            is_permanent: true,
            created_at: null,
          },
        ]
      },
      async activeVotes() {
        return [
          {
            voter_contract: CONTRACTS.mainnet.poolsVoter.toLowerCase(),
            token_id: "848",
            gauge: pool,
            current_weight: "50000000000000000000",
            last_updated_at: String(recording.nowSeconds - 86_400),
          },
        ]
      },
    }
    // The pool's gauge cannot be read: the lock is unread from the start.
    const lossy: WalletChainReader = {
      ...emptyChainReader,
      async poolGauges() {
        return { gauges: new Map(), failed: [pool] }
      },
    }
    await runWarehouseSnapshot({ ...deps(reader, "chained"), chain: lossy })
    // Nothing to carry and nothing read: no document, rather than an
    // empty claimable. The API serves such a wallet live.
    expect(
      await readReadModel(env.READ_DB, "mezo", "wallet-overview", wallet),
    ).toBeNull()
    const again = await env.READ_DB.prepare(
      "SELECT wallet FROM wallet_requests",
    ).all<{ wallet: string }>()
    expect(again.results).toEqual([{ wallet }])
  })

  it("skips the cron fallback after a chained run", async () => {
    const reader = createWarehouseReader(recordedQueryRunner(recording))
    await runWarehouseSnapshot(deps(reader, "chained"))
    const fallback = await runWarehouseSnapshot(deps(reader, "cron"))
    expect(fallback).toEqual({
      status: "skipped",
      reason: "A chained run finished recently",
    })
  })

  it("records a failed run and rethrows", async () => {
    const broken: WarehouseReader = {
      ...createWarehouseReader(recordedQueryRunner(recording)),
      async locksOf() {
        throw new Error("connection reset")
      },
    }
    await expect(runWarehouseSnapshot(deps(broken, "chained"))).rejects.toThrow(
      "connection reset",
    )
    const run = await env.READ_DB.prepare(
      "SELECT status, detail FROM snapshot_runs",
    ).first()
    expect(run).toEqual({ status: "failed", detail: "connection reset" })
  })
})
