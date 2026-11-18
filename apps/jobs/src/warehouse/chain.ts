import { BRIBE_ABI, CONTRACTS, VOTING_ESCROW_ABI } from "@matchbox/chain"
import type { VoterKind } from "@matchbox/contracts/market"
import type { Escrow } from "@matchbox/contracts/read-models"
import {
  type Abi,
  getAddress,
  type PublicClient,
  parseAbi,
  zeroAddress,
} from "viem"

// Chain reads the warehouse cannot answer: current voting power, which
// gauge a voted pool belongs to, each voted gauge's reward contracts and
// their tokens, and what each lock can claim now (`earned`).

export type EarnedRequest = {
  rewardContract: string
  token: string
  tokenId: string
}

/** A gauge a lock votes, with the voter it is voted through. */
export type VotedGauge = { gauge: string; voter: VoterKind }

/** One reward contract of a gauge: its bribes, or a pool gauge's fees. */
export type RewardContract = { gauge: string; rewardContract: string }

/** Tokens read per reward contract, at most (its `rewards` list). */
export const rewardTokenSlots = 16

/**
 * How a read is sent: calls to an RPC request, and requests open at once.
 *
 * The public Mezo RPC throttles `earned` under load. Measured with the
 * Worker's own client on 12 Nov 2026: 12 batches of 40 one at a time all
 * answered; the same 12 six at a time all failed. `earned` walks a lock's
 * epochs since its last claim, so it is the expensive call. It goes ten to
 * a request. The getters (`gauges`, `gaugeToBribe`, `gaugeToFees`,
 * `rewardsListLength`, `rewards`) are one storage read each and never
 * failed: 400 to a request.
 */
export type Pace = { perRequest: number; inFlight: number }

export const viewPace: Pace = { perRequest: 400, inFlight: 6 }
/** The bulk of a run's `earned` calls. */
export const earnedPace: Pace = { perRequest: 10, inFlight: 6 }
/**
 * `earned` for the wallets someone is waiting for: one request at a time,
 * before the bulk, while the RPC's allowance is untouched.
 */
export const gentlePace: Pace = { perRequest: 10, inFlight: 1 }
/** A retry asks for fewer calls at once, one request at a time. */
export const retryPace: Pace = { perRequest: 5, inFlight: 1 }
/** Retries of a read's failed calls, each after a longer pause. */
export const retryRounds = 2
export const retryPauseMs = 700

/** Kept for the tests that count requests. */
export const earnedCallsPerRequest = earnedPace.perRequest
export const viewCallsPerRequest = viewPace.perRequest

/** What went wrong in a run's chain reads, for the log. */
export type ChainDiagnostics = {
  /**
   * Requests an endpoint refused as malformed (JSON-RPC -32602). One of
   * the public fallbacks answers a Multicall3 `eth_call` this way, which
   * says "this endpoint cannot serve this call", not that the call is
   * wrong. Counted apart, to show how often a fallback is no fallback.
   */
  rejectedRequests: number
  /** Requests that failed any other way (throttled, timed out, reset). */
  lostRequests: number
  /** The first few distinct error texts, without URLs or bodies. */
  errors: string[]
}

export type EarnedOptions = {
  /** "gentle" for wallets someone is waiting for. */
  pace?: Pace
  /** Unix ms: no request starts after this, and what is left is unread. */
  deadline?: number
}

export type WalletChainReader = {
  /**
   * PoolsVoter's gauge for each pool (`gauges(pool)`), both lower-case.
   * An address that is not a pool with a gauge is in neither list; a pool
   * whose read failed twice is in `failed`.
   */
  poolGauges(
    pools: readonly string[],
  ): Promise<{ gauges: Map<string, string>; failed: string[] }>
  /**
   * Every reward contract of these gauges: `gaugeToBribe` on the gauge's
   * voter, and `gaugeToFees` too for a pool gauge. Lower-case. `failed`
   * lists the gauges with a read that failed twice.
   */
  rewardContracts(
    gauges: readonly VotedGauge[],
  ): Promise<{ contracts: RewardContract[]; failed: string[] }>
  /**
   * The tokens each reward contract pays (`rewards(i)`), lower-case, keyed
   * by the contract. A contract any of whose reads failed twice is in
   * `failed` and not in `tokens`. `truncated` lists contracts with more
   * than `rewardTokenSlots` tokens, of which only the first are read.
   */
  rewardTokens(contracts: readonly string[]): Promise<{
    tokens: Map<string, string[]>
    failed: string[]
    truncated: string[]
  }>
  /** Keyed by `${escrow}:${tokenId}`; missing when the read failed. */
  votingPower(
    locks: readonly { escrow: Escrow; tokenId: string }[],
  ): Promise<Map<string, bigint>>
  /**
   * Keyed by `${rewardContract}:${token}:${tokenId}`; zero amounts dropped.
   * `failed` lists the requests that failed twice: unknown, not zero.
   */
  earned(
    requests: readonly EarnedRequest[],
    options?: EarnedOptions,
  ): Promise<{ earned: Map<string, bigint>; failed: EarnedRequest[] }>
  /** What failed since the last call, and why; reading it clears it. */
  diagnostics(): ChainDiagnostics
  /** The chain's head block now; null when it cannot be read. */
  head(): Promise<number | null>
  /**
   * Keyed by `${escrow}:${tokenId}`: `locked(tokenId)`, the chain's word on
   * each lock's amount, end and permanence; missing when the read failed.
   */
  locked(
    locks: readonly { escrow: Escrow; tokenId: string }[],
  ): Promise<Map<string, ChainLock>>
}

export type ChainLock = { amount: bigint; end: bigint; isPermanent: boolean }

export function earnedKey(request: EarnedRequest): string {
  return `${request.rewardContract}:${request.token}:${request.tokenId}`
}

const escrows = {
  vebtc: CONTRACTS.mainnet.veBTC,
  vemezo: CONTRACTS.mainnet.veMEZO,
} as const

const voters: Record<VoterKind, `0x${string}`> = {
  boost: CONTRACTS.mainnet.boostVoter,
  pools: CONTRACTS.mainnet.poolsVoter,
  validators: CONTRACTS.mainnet.validatorsVoter,
  "third-party": CONTRACTS.mainnet.thirdPartyVoter,
}

// The same three reads on all four voters (`gaugeToFees` and `gauges` are
// only asked of PoolsVoter).
const voterReadAbi = parseAbi([
  "function gauges(address pool) view returns (address)",
  "function gaugeToBribe(address gauge) view returns (address)",
  "function gaugeToFees(address gauge) view returns (address)",
])

const rewardListAbi = parseAbi([
  "function rewardsListLength() view returns (uint256)",
  "function rewards(uint256 index) view returns (address)",
])

/**
 * RPC requests open at once. The first run with these reads (12 Nov 2026,
 * 14:46 UTC) sent every request of a read together: 206 `earned` calls
 * failed twice and 24 of 61 wallets were skipped. Each failed call answers
 * when asked alone, and a batch of 40 on its own answers in half a second,
 * so it was the load: a Worker holds six connections open and the rest
 * wait in line while their timeout runs, and a public RPC throttles a
 * burst. Six at a time is what the Worker can really have in flight.
 */
export const requestsInFlight = earnedPace.inFlight

/** Runs `work` over `items`, at most `limit` at a time, keeping the order. */
export async function inTurn<Item, Result>(
  items: readonly Item[],
  limit: number,
  work: (item: Item) => Promise<Result>,
): Promise<Result[]> {
  const results: Result[] = []
  let next = 0
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next
      next += 1
      const item = items[index]
      if (item === undefined) continue
      results[index] = await work(item)
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  )
  return results
}

/** A call that failed twice: not an answer. */
const unread: unique symbol = Symbol("unread")

type Call = {
  address: `0x${string}`
  abi: Abi
  functionName: string
  args?: readonly unknown[]
}

export type ChainTiming = {
  /** Resolves after `ms`; injected so tests need no clock. */
  wait: (ms: number) => Promise<void>
  now: () => number
}

const realTiming: ChainTiming = {
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
}

/** "InvalidParamsRpcError: Missing or invalid parameters." No URL, no body. */
function errorText(error: unknown): string {
  if (typeof error !== "object" || error === null) return String(error)
  const name: unknown = Reflect.get(error, "name")
  const short: unknown = Reflect.get(error, "shortMessage")
  const message: unknown = Reflect.get(error, "message")
  const text = typeof short === "string" ? short : String(message ?? "")
  // viem puts "URL: ..." and "Request body: ..." on later lines.
  return `${typeof name === "string" ? name : "Error"}: ${text.split("\n")[0]?.slice(0, 160) ?? ""}`
}

/**
 * JSON-RPC -32602 ("invalid params") anywhere in the error's chain of
 * causes. viem's multicall hands back its own error around it, so the text
 * is checked too.
 */
function isRejection(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; depth < 8; depth += 1) {
    if (typeof current !== "object" || current === null) return false
    if (Reflect.get(current, "code") === -32602) return true
    if (Reflect.get(current, "name") === "InvalidParamsRpcError") return true
    const short: unknown = Reflect.get(current, "shortMessage")
    if (
      typeof short === "string" &&
      short.startsWith("Missing or invalid parameters")
    ) {
      return true
    }
    current = Reflect.get(current, "cause")
  }
  return false
}

export function createWalletChainReader(
  client: PublicClient,
  blockNumber?: bigint,
  timing: ChainTiming = realTiming,
): WalletChainReader {
  const at = blockNumber === undefined ? {} : { blockNumber }
  let found: ChainDiagnostics = {
    rejectedRequests: 0,
    lostRequests: 0,
    errors: [],
  }

  function note(error: unknown): void {
    if (isRejection(error)) found.rejectedRequests += 1
    else found.lostRequests += 1
    const text = errorText(error)
    if (found.errors.length < 4 && !found.errors.includes(text)) {
      found.errors.push(text)
    }
  }

  async function attempt(
    calls: readonly Call[],
    pace: Pace,
    deadline?: number,
  ): Promise<unknown[]> {
    const slices: (readonly Call[])[] = []
    for (let start = 0; start < calls.length; start += pace.perRequest) {
      slices.push(calls.slice(start, start + pace.perRequest))
    }
    const answers = await inTurn(slices, pace.inFlight, async (slice) => {
      // Out of time: these are unread, and the caller says so.
      if (deadline !== undefined && timing.now() >= deadline) {
        return slice.map((): unknown => unread)
      }
      try {
        const results = await client.multicall({
          ...at,
          allowFailure: true,
          // One RPC request per slice: the slices are the batches.
          batchSize: 0,
          contracts: slice,
        })
        // A request that failed as a whole fails every call with one error.
        const [first] = results
        if (
          first !== undefined &&
          results.every((result) => result.status === "failure")
        ) {
          note(first.error)
        }
        return results.map((result): unknown =>
          result.status === "success" ? result.result : unread,
        )
      } catch (error) {
        note(error)
        return slice.map((): unknown => unread)
      }
    })
    return answers.flat()
  }

  /**
   * Runs the calls through Multicall3 at `pace`, then asks again for the
   * ones that failed: after a pause, fewer at a time, one request open, up
   * to `retryRounds` times and never past `deadline`. A lost request fails
   * every call in it, and a throttled RPC answers again once it is left
   * alone for a moment. What still fails comes back as `unread`; a caller
   * must not take it for an empty answer.
   *
   * A revert cannot be told from a lost request in viem's results with any
   * certainty, and none of these calls reverts as a real answer (a missing
   * gauge or reward contract is the zero address, a successful result), so
   * every failure counts.
   */
  async function read(
    calls: readonly Call[],
    pace: Pace,
    deadline?: number,
  ): Promise<unknown[]> {
    const results = await attempt(calls, pace, deadline)
    for (let round = 1; round <= retryRounds; round += 1) {
      const again = results.flatMap((result, index) =>
        result === unread ? [index] : [],
      )
      if (again.length === 0) break
      const pause = retryPauseMs * round
      if (deadline !== undefined && timing.now() + pause >= deadline) break
      await timing.wait(pause)
      const retried = await attempt(
        again.flatMap((index) => {
          const call = calls[index]
          return call === undefined ? [] : [call]
        }),
        {
          perRequest: Math.min(pace.perRequest, retryPace.perRequest),
          inFlight: retryPace.inFlight,
        },
        deadline,
      )
      again.forEach((index, position) => {
        results[index] = position < retried.length ? retried[position] : unread
      })
    }
    return results
  }

  return {
    async poolGauges(pools) {
      const results = await read(
        pools.map((pool) => ({
          address: voters.pools,
          abi: voterReadAbi,
          functionName: "gauges",
          args: [getAddress(pool)],
        })),
        viewPace,
      )
      const gauges = new Map<string, string>()
      const failed: string[] = []
      pools.forEach((pool, index) => {
        const result = results[index]
        if (typeof result !== "string") failed.push(pool.toLowerCase())
        else if (result !== zeroAddress) {
          gauges.set(pool.toLowerCase(), result.toLowerCase())
        }
      })
      return { gauges, failed }
    },

    async rewardContracts(gauges) {
      const lookups = gauges.flatMap((voted) =>
        (voted.voter === "pools"
          ? ["gaugeToBribe", "gaugeToFees"]
          : ["gaugeToBribe"]
        ).map((functionName) => ({ voted, functionName })),
      )
      const results = await read(
        lookups.map((lookup) => ({
          address: voters[lookup.voted.voter],
          abi: voterReadAbi,
          functionName: lookup.functionName,
          args: [getAddress(lookup.voted.gauge)],
        })),
        viewPace,
      )
      const contracts: RewardContract[] = []
      const failed = new Set<string>()
      lookups.forEach((lookup, index) => {
        const result = results[index]
        const gauge = lookup.voted.gauge.toLowerCase()
        if (typeof result !== "string") failed.add(gauge)
        else if (result !== zeroAddress) {
          contracts.push({ gauge, rewardContract: result.toLowerCase() })
        }
      })
      return { contracts, failed: [...failed] }
    },

    async rewardTokens(contracts) {
      const lengths = await read(
        contracts.map((contract) => ({
          address: getAddress(contract),
          abi: rewardListAbi,
          functionName: "rewardsListLength",
        })),
        viewPace,
      )
      const failed = new Set<string>()
      const truncated: string[] = []
      const slots = contracts.flatMap((contract, index) => {
        const length = lengths[index]
        if (typeof length !== "bigint") {
          failed.add(contract.toLowerCase())
          return []
        }
        if (length > BigInt(rewardTokenSlots)) {
          truncated.push(contract.toLowerCase())
        }
        const count = Math.min(Number(length), rewardTokenSlots)
        return Array.from({ length: count }, (_, slot) => ({ contract, slot }))
      })
      const results = await read(
        slots.map((entry) => ({
          address: getAddress(entry.contract),
          abi: rewardListAbi,
          functionName: "rewards",
          args: [BigInt(entry.slot)],
        })),
        viewPace,
      )
      const tokens = new Map<string, string[]>()
      slots.forEach((entry, index) => {
        const result = results[index]
        const contract = entry.contract.toLowerCase()
        if (typeof result !== "string") failed.add(contract)
        else {
          tokens.set(contract, [
            ...(tokens.get(contract) ?? []),
            result.toLowerCase(),
          ])
        }
      })
      for (const contract of contracts) {
        const key = contract.toLowerCase()
        // A partly read list would hide a token: the contract is unread.
        if (failed.has(key)) tokens.delete(key)
        // An empty list pays nothing: that is a read, not a failure.
        else if (!tokens.has(key)) tokens.set(key, [])
      }
      return { tokens, failed: [...failed], truncated }
    },

    async votingPower(locks) {
      const results = await client.multicall({
        ...at,
        allowFailure: true,
        contracts: locks.map((lock) => ({
          address: escrows[lock.escrow],
          abi: VOTING_ESCROW_ABI,
          functionName: "votingPowerOfNFT" as const,
          args: [BigInt(lock.tokenId)] as const,
        })),
      })
      const powers = new Map<string, bigint>()
      locks.forEach((lock, index) => {
        const result = results[index]
        if (result?.status === "success") {
          powers.set(`${lock.escrow}:${lock.tokenId}`, result.result)
        }
      })
      return powers
    },

    async locked(locks) {
      const results = await client.multicall({
        ...at,
        allowFailure: true,
        contracts: locks.map((lock) => ({
          address: escrows[lock.escrow],
          abi: VOTING_ESCROW_ABI,
          functionName: "locked" as const,
          args: [BigInt(lock.tokenId)] as const,
        })),
      })
      const locked = new Map<string, ChainLock>()
      locks.forEach((lock, index) => {
        const result = results[index]
        if (result?.status === "success") {
          locked.set(`${lock.escrow}:${lock.tokenId}`, {
            amount: result.result.amount < 0n ? 0n : result.result.amount,
            end: result.result.end,
            isPermanent: result.result.isPermanent,
          })
        }
      })
      return locked
    },

    async earned(requests, options = {}) {
      const results = await read(
        requests.map((request) => ({
          address: getAddress(request.rewardContract),
          abi: BRIBE_ABI,
          functionName: "earned",
          args: [getAddress(request.token), BigInt(request.tokenId)],
        })),
        options.pace ?? earnedPace,
        options.deadline,
      )
      const earned = new Map<string, bigint>()
      const failed: EarnedRequest[] = []
      requests.forEach((request, index) => {
        const result = results[index]
        if (typeof result !== "bigint") failed.push(request)
        else if (result > 0n) earned.set(earnedKey(request), result)
      })
      return { earned, failed }
    },

    async head() {
      try {
        return Number(await client.getBlockNumber())
      } catch {
        return null
      }
    },

    diagnostics() {
      const taken = found
      found = { rejectedRequests: 0, lostRequests: 0, errors: [] }
      return taken
    },
  }
}
