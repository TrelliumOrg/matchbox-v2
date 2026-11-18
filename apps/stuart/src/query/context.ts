import type {
  GaugeConsistencyRanking,
  GaugeKind,
  GaugeProfileReadModel,
} from "@matchbox/contracts/read-models"
import type { VoteBranch, WalletMode } from "@matchbox/stuart-ui/contract"
import type { Address } from "viem"
import type { BlockscoutReader } from "./providers/blockscout"
import { type BoostState, loadBoostState } from "./providers/boost"
import { type BridgeSearch, searchBridgeOperations } from "./providers/bridge"
import type { ChainActivitySource } from "./providers/chainActivity"
import type { ClaimableLock } from "./providers/claims"
import {
  type ChainClaims,
  claimCandidates,
  loadChainClaims,
} from "./providers/claimsChain"
import type { WireEarnings, WireGaugeEpochs } from "./providers/history"
import { loadTrove, type TroveSnapshot } from "./providers/loans"
import {
  type LockAsset,
  type LockStates,
  loadEscrowFunding,
  loadLockStates,
  type TokenAllowance,
} from "./providers/locks"
import { type PriceSnapshot, pricesFromReadModel } from "./providers/prices"
import {
  loadChainTotals,
  type ProtocolSnapshot,
  protocolSnapshot,
} from "./providers/protocol"
import {
  claimableFromRewards,
  fundedEpochsFromProfiles,
  gaugeHistoryFromProfile,
  lockVoteStateFromOverview,
  mezoPriceMicro,
  votingDomainFromDirectory,
  walletEarningsFromReadModels,
  walletLocksFromOverview,
} from "./providers/readModelProviders"
import { ReadModelError, type ReadModelSource } from "./providers/readModels"
import type {
  RewardContractResolver,
  RewardContracts,
} from "./providers/rewardContracts"
import type { MezoClient } from "./providers/rpc"
import {
  type CallToSimulate,
  type SimulatedCall,
  simulateSequence,
  simulateSingle,
} from "./providers/simulate"
import type {
  LockVoteState,
  VotingDomain,
  WalletLock,
} from "./providers/voting"
import {
  loadTokenPosition,
  loadZapMarket,
  loadZapQuote,
  type TokenPosition,
  type ZapMarket,
  type ZapQuote,
  type ZapRoute,
} from "./providers/zap"

// Everything a Stuart tool may read. Live implementations read the API
// Worker's read models (gauges, wallets, prices) and, for what those do not
// cover, Mezo RPC and Wormholescan; tests pass fixtures. Tools never touch
// the network directly.
export type StuartProviders = {
  prices: () => Promise<PriceSnapshot>
  votingDomain: (branch: VoteBranch) => Promise<VotingDomain>
  walletLocks: (
    owner: Address,
    asset: "veMEZO" | "veBTC",
  ) => Promise<WalletLock[]>
  lockVoteState: (
    branch: VoteBranch,
    owner: Address,
    tokenIds: readonly bigint[],
    targets: readonly Address[],
  ) => Promise<LockVoteState[]>
  fundedEpochs: (
    domain: VotingDomain,
    window: number,
  ) => Promise<Map<string, number>>
  claimable: (
    domain: VotingDomain,
    owner: Address,
    locks: readonly WalletLock[],
  ) => Promise<ClaimableLock[]>
  trove: (owner: Address) => Promise<TroveSnapshot>
  zapMarket: (route: ZapRoute) => Promise<ZapMarket>
  zapQuote: (route: ZapRoute, amountIn: bigint) => Promise<ZapQuote>
  tokenPosition: (
    token: Address,
    owner: Address,
    spender: Address,
  ) => Promise<TokenPosition>
  simulateSingle: (
    from: Address,
    call: CallToSimulate,
  ) => Promise<SimulatedCall>
  simulateSequence: (
    from: Address,
    calls: readonly CallToSimulate[],
  ) => Promise<SimulatedCall[]>
  bridge: (
    address: Address,
    limit: number,
    direction: "in" | "out" | null,
  ) => Promise<BridgeSearch>
  boostState: (tokenId: bigint | null) => Promise<BoostState>
  // Boost gauges only: per-epoch rows, newest first.
  gaugeHistory: (
    gauge: Address,
    count: number,
    boostTokenId: bigint | null,
  ) => Promise<WireGaugeEpochs>
  // veMEZO voting-incentive earnings: this epoch projected, the last sealed
  // epoch while unclaimed, and claimable.
  walletEarnings: (owner: Address) => Promise<WireEarnings>
  // Protocol totals: escrow supplies on chain plus the API summary.
  protocol: () => Promise<ProtocolSnapshot>
  // Every lock's claimable rewards, exact earned() amounts on chain.
  // `tokenIds` null means every lock of the wallet.
  claims: (
    owner: Address,
    tokenIds: ReadonlySet<string> | null,
  ) => Promise<ChainClaims>
  // Lock facts for lock actions (owner, locked, vesting, managed, votes).
  lockStates: (
    asset: LockAsset,
    tokenIds: readonly bigint[],
  ) => Promise<LockStates>
  // The escrow token's balance and allowance to the escrow (add, relock).
  escrowFunding: (
    asset: LockAsset,
    owner: Address,
  ) => Promise<TokenAllowance & { token: Address }>
  // Funded epochs of the last N per gauge, most consistent first; null
  // when the API has no consistency read model yet.
  consistency: (
    kind: GaugeKind | null,
    limit: number,
  ) => Promise<GaugeConsistencyRanking | null>
  // Blockscout through the API Worker's cached proxy.
  blockscout: BlockscoutReader
  // Transfers, labels, locks and votes for chain activity questions.
  chain: ChainActivitySource
}

export type StuartWallet = {
  address: Address
  mode: WalletMode
  label: string
}

export type StuartContext = {
  providers: StuartProviders
  wallet: StuartWallet
  query: string
  // The option picked on an entity-disambiguation card, re-validated by the
  // tool against its own candidates.
  choice: string | null
  now: () => Date
  secret: string
}

class RequestMemo<T> {
  private readonly entries = new Map<string, Promise<T>>()

  get(key: string, load: () => Promise<T>): Promise<T> {
    const existing = this.entries.get(key)
    if (existing) return existing
    const promise = load()
    this.entries.set(key, promise)
    promise.catch(() => this.entries.delete(key))
    return promise
  }
}

// Gauge profiles are fetched a few at a time (one per funded target).
const PROFILE_CONCURRENCY = 8

async function mapLimited<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next
      next += 1
      const item = items[index]
      if (item !== undefined) results[index] = await run(item)
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  )
  return results
}

export type LiveProviderInput = {
  readModels: ReadModelSource
  rpc: MezoClient
  rewardContracts: RewardContractResolver
  blockscout: BlockscoutReader
  chain: ChainActivitySource
  now: () => Date
  log: (event: Record<string, unknown>) => void
}

/** Live providers with per-request memoization of the expensive reads. */
export function createLiveProviders(input: LiveProviderInput): StuartProviders {
  const { readModels, rpc: client } = input
  const directoryMemo = new RequestMemo<
    Awaited<ReturnType<ReadModelSource["gauges"]>>
  >()
  const domainMemo = new RequestMemo<VotingDomain>()
  const priceMemo = new RequestMemo<PriceSnapshot>()
  const overviewMemo = new RequestMemo<
    Awaited<ReturnType<ReadModelSource["walletOverview"]>>
  >()
  const rewardsMemo = new RequestMemo<
    Awaited<ReturnType<ReadModelSource["walletRewards"]>>
  >()
  const profileMemo = new RequestMemo<GaugeProfileReadModel | null>()
  const troveMemo = new RequestMemo<TroveSnapshot>()

  function directory(branch: VoteBranch) {
    return directoryMemo.get(branch, () => readModels.gauges(branch))
  }
  function currentEpoch() {
    return directoryMemo.get("epoch", () => readModels.epoch())
  }
  function overview(owner: Address) {
    return overviewMemo.get(owner.toLowerCase(), () =>
      readModels.walletOverview(owner),
    )
  }
  function rewards(owner: Address) {
    return rewardsMemo.get(owner.toLowerCase(), () =>
      readModels.walletRewards(owner),
    )
  }
  function profile(gauge: Address) {
    return profileMemo.get(gauge.toLowerCase(), async () => {
      const response = await readModels.gaugeProfile(gauge)
      return response === null ? null : response.data
    })
  }
  function prices() {
    return priceMemo.get("prices", async () =>
      pricesFromReadModel(await readModels.prices(), input.now()),
    )
  }
  async function rewardContractsFor(branch: VoteBranch, gauges: Address[]) {
    try {
      return await input.rewardContracts(branch, gauges)
    } catch (error) {
      input.log({
        message: "stuart.reward_contracts_unavailable",
        branch,
        error: error instanceof Error ? error.message.slice(0, 200) : "unknown",
      })
      return new Map<string, RewardContracts>()
    }
  }
  function votingDomain(branch: VoteBranch) {
    return domainMemo.get(branch, async () => {
      const gauges = await directory(branch)
      const addresses = gauges.data.gauges
        .filter((card) => card.gauge.voter === branch)
        .map((card): Address => `0x${card.gauge.address.slice(2)}`)
      return votingDomainFromDirectory({
        directory: gauges,
        branch,
        rewardContracts: await rewardContractsFor(branch, addresses),
      })
    })
  }

  return {
    prices,
    votingDomain,
    walletLocks: async (owner, asset) =>
      walletLocksFromOverview((await overview(owner))?.data ?? null, asset),
    lockVoteState: async (branch, owner, tokenIds) => {
      const [domain, document] = await Promise.all([
        votingDomain(branch),
        overview(owner),
      ])
      return lockVoteStateFromOverview({
        overview: document?.data ?? null,
        domain,
        tokenIds,
      })
    },
    fundedEpochs: async (domain, window) => {
      const gauges = domain.targets
        .filter((target) => target.incentives.length > 0)
        .map((target) => target.gaugeAddress)
      const documents = await mapLimited(gauges, PROFILE_CONCURRENCY, (gauge) =>
        profile(gauge),
      )
      return fundedEpochsFromProfiles({
        domain,
        window,
        profiles: new Map(
          gauges.map((gauge, index) => [
            gauge.toLowerCase(),
            documents[index] ?? null,
          ]),
        ),
      })
    },
    claimable: async (domain, owner, locks) => {
      const document = await rewards(owner)
      const result = claimableFromRewards({
        rewards: document?.data ?? null,
        domain,
        locks,
      })
      if (result.skipped > 0) {
        input.log({
          message: "stuart.claimable_contract_unknown",
          branch: domain.branch,
          skipped: result.skipped,
        })
      }
      return result.locks
    },
    trove: (owner) =>
      troveMemo.get(owner.toLowerCase(), () => loadTrove(client, owner)),
    zapMarket: (route) => loadZapMarket(client, route),
    zapQuote: (route, amountIn) => loadZapQuote(client, route, amountIn),
    tokenPosition: (token, owner, spender) =>
      loadTokenPosition(client, token, owner, spender),
    simulateSingle: (from, call) => simulateSingle(client, from, call),
    simulateSequence: (from, calls) => simulateSequence(client, from, calls),
    bridge: (address, limit, direction) =>
      searchBridgeOperations({ address, limit, direction }),
    boostState: (tokenId) => loadBoostState(client, tokenId),
    gaugeHistory: async (gauge, count) => {
      const [document, gauges, snapshot] = await Promise.all([
        profile(gauge),
        currentEpoch(),
        prices(),
      ])
      if (document === null) {
        throw new ReadModelError("No profile for this gauge", 404)
      }
      return gaugeHistoryFromProfile({
        profile: document,
        count,
        currentEpochStart: BigInt(gauges.data.epoch.start),
        mezoPriceMicroUsd: mezoPriceMicro(snapshot),
      })
    },
    walletEarnings: async (owner) => {
      const [document, rewardDocument, gauges] = await Promise.all([
        overview(owner),
        rewards(owner),
        currentEpoch(),
      ])
      return walletEarningsFromReadModels({
        overview: document?.data ?? null,
        rewards: rewardDocument?.data ?? null,
        epoch: gauges.data.epoch,
      })
    },
    claims: async (owner, tokenIds) => {
      const [document, rewardDocument] = await Promise.all([
        overview(owner),
        rewards(owner),
      ])
      return loadChainClaims(
        client,
        claimCandidates({
          overview: document?.data ?? null,
          rewards: rewardDocument?.data ?? null,
          tokenIds,
        }),
      )
    },
    lockStates: (asset, tokenIds) => loadLockStates(client, asset, tokenIds),
    escrowFunding: (asset, owner) => loadEscrowFunding(client, asset, owner),
    consistency: async (kind, limit) => {
      const response = await readModels.consistency(kind, limit)
      return response === null ? null : response.data
    },
    protocol: async () => {
      const [summary, chain] = await Promise.all([
        readModels.summary(),
        loadChainTotals(client).catch((error: unknown) => {
          input.log({
            message: "stuart.protocol_chain_unavailable",
            error:
              error instanceof Error ? error.message.slice(0, 200) : "unknown",
          })
          return null
        }),
      ])
      return protocolSnapshot({ summary, chain, now: input.now() })
    },
    blockscout: input.blockscout,
    chain: input.chain,
  }
}
