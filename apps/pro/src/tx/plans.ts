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
  encodeFunctionData,
  getAddress,
  type Hex,
  parseEventLogs,
  type TransactionReceipt,
  zeroAddress,
} from "viem"
import type { LockKind } from "../data/view-models"
import { formatDay, shortAddress } from "../lib/format"
import { amountLabel } from "./amounts"
import type { VoterKind } from "./tx-store"

/**
 * Transaction plans: the exact calls each flow signs, one step per wallet
 * prompt, built from values the review already read on chain. Pure (viem's
 * encoders only), so every flow's calldata is tested. A step prepares its
 * call when it is reached, so a later step can use an earlier receipt (the
 * new lock's id for Auto max).
 *
 * Approvals are ERC-20 and exact, to the contract that pulls the tokens.
 * There is no ERC-721 approval anywhere: on the escrows that is custody.
 *
 * Every step's `detail` says what it does in plain words ("Exactly this
 * amount, nothing more", "Locked until Thu 2 Mar 2028"), never a contract
 * name. The same `prepare` feeds the wallet, the Safe batch and the Safe
 * export, so all three sign identical calldata.
 */

const mainnet = CONTRACTS.mainnet

export type PreparedCall = {
  to: Address
  data: Hex
  /** Native BTC sent with the call, in wei. Absent means none. */
  value?: bigint
  /** Decodes this call's reverts. */
  abi: Abi
  /** What the wallet shows as the contract, for the review. */
  contract: string
}

export type PlanStep = {
  id: string
  /** What the wallet will be asked to sign: "Approve 6,000.00 MEZO". */
  label: string
  /** Under the label, in plain words: "Exactly this amount, nothing more". */
  detail: string
  prepare: (receipts: ReadonlyMap<string, TransactionReceipt>) => PreparedCall
  /**
   * Set when `prepare` needs an earlier step's receipt, naming the value it
   * waits for ("the new lock id"). A Safe batch stops before such a step:
   * it goes in a second proposal once the first executes.
   */
  awaits?: string
}

export const voterAddress: Record<VoterKind, Address> = {
  boost: mainnet.boostVoter,
  pools: mainnet.poolsVoter,
  validators: mainnet.validatorsVoter,
  "third-party": mainnet.thirdPartyVoter,
}

/** What the wallet shows as the contract (never a step subtitle). */
const voterName: Record<VoterKind, string> = {
  boost: "BoostVoter",
  pools: "PoolsVoter",
  validators: "ValidatorsVoter",
  "third-party": "ThirdPartyVoter",
}

/** The gauge type a voter carries, in the singular. */
const gaugeType: Record<VoterKind, string> = {
  boost: "veBTC gauge",
  "third-party": "cross-chain gauge",
  validators: "validator gauge",
  pools: "pool gauge",
}

function gauges(voter: VoterKind, count: number): string {
  return `${count} ${gaugeType[voter]}${count === 1 ? "" : "s"}`
}

/** "Thu 2 Mar 2028", the unlock date a lock step shows. */
export function unlockDate(unix: number): string {
  return `${formatDay(unix)} ${new Date(unix * 1000).getUTCFullYear()}`
}

const weekSeconds = 604_800n

/** "4 weeks", for a duration in seconds. */
function weeksLabel(seconds: bigint): string {
  const weeks = seconds / weekSeconds
  if (weeks < 1n) return "under a week"
  return `${weeks} week${weeks === 1n ? "" : "s"}`
}

const autoMaxDetail = "Full voting power, no unlock date"

export function escrowAddress(kind: LockKind): Address {
  return kind === "vebtc" ? mainnet.veBTC : mainnet.veMEZO
}

const escrowName: Record<LockKind, string> = {
  vebtc: "veBTC",
  vemezo: "veMEZO",
}

/** Which voters a lock votes through. */
export function votersFor(kind: LockKind): readonly VoterKind[] {
  return kind === "vemezo" ? ["boost", "third-party"] : ["validators", "pools"]
}

function fixed(call: PreparedCall): PlanStep["prepare"] {
  return () => call
}

export function approveStep(input: {
  id?: string
  token: Address
  symbol: string
  spender: Address
  amount: bigint
  amountLabel: string
}): PlanStep {
  return {
    id: input.id ?? "approve",
    label: `Approve ${input.amountLabel} ${input.symbol}`,
    detail: "Exactly this amount, nothing more",
    prepare: fixed({
      to: input.token,
      data: encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "approve",
        args: [input.spender, input.amount],
      }),
      abi: ERC20_ABI,
      contract: input.symbol,
    }),
  }
}

/** Approve only when the allowance cannot cover the amount. */
export function needsApproval(allowance: bigint, amount: bigint): boolean {
  return allowance < amount
}

// ---------------------------------------------------------------------------
// Vote
// ---------------------------------------------------------------------------

export type VoteGroup = {
  voter: VoterKind
  /** Gauge addresses, or pool addresses on PoolsVoter. */
  targets: Address[]
  /** Relative weights; the voter spreads the full voting power by them. */
  weights: bigint[]
}

/**
 * Splits a ballot by the voter each gauge belongs to. PoolsVoter votes on
 * the pool behind a gauge, so `poolOf` maps those (read on chain).
 */
export function voteGroups(
  picks: readonly { gauge: string; voter: VoterKind; bps: number }[],
  poolOf: ReadonlyMap<string, Address>,
): VoteGroup[] {
  const groups = new Map<VoterKind, VoteGroup>()
  for (const pick of picks) {
    if (pick.bps <= 0) continue
    const target =
      pick.voter === "pools"
        ? poolOf.get(pick.gauge.toLowerCase())
        : getAddress(pick.gauge)
    if (target === undefined || target === zeroAddress) {
      throw new Error(`No pool for gauge ${pick.gauge}`)
    }
    const group = groups.get(pick.voter) ?? {
      voter: pick.voter,
      targets: [],
      weights: [],
    }
    group.targets.push(target)
    group.weights.push(BigInt(pick.bps))
    groups.set(pick.voter, group)
  }
  return [...groups.values()]
}

const voteLabels: Record<VoterKind, string> = {
  boost: "veBTC gauges",
  "third-party": "cross-chain gauges",
  validators: "validators",
  pools: "pools",
}

export function votePlan(
  tokenId: bigint,
  groups: readonly VoteGroup[],
  /** The epoch the votes count for, shown under each step. */
  options: { epoch?: number } = {},
): PlanStep[] {
  const many = groups.length > 1
  return groups.map((group) => ({
    id: `vote-${group.voter}`,
    label: many
      ? `Vote on ${voteLabels[group.voter]} with #${tokenId}`
      : `Vote with #${tokenId}`,
    detail:
      options.epoch === undefined
        ? gauges(group.voter, group.targets.length)
        : `${gauges(group.voter, group.targets.length)}, Epoch ${options.epoch}`,
    prepare: fixed({
      to: voterAddress[group.voter],
      data: encodeFunctionData({
        abi: VOTER_WRITE_ABI,
        functionName: "vote",
        args: [tokenId, group.targets, group.weights],
      }),
      abi: VOTER_WRITE_ABI,
      contract: voterName[group.voter],
    }),
  }))
}

// ---------------------------------------------------------------------------
// Claim
// ---------------------------------------------------------------------------

export type ClaimCall = {
  voter: VoterKind
  /** "bribes" through claimBribes, "fees" through claimFees (pools). */
  kind: "bribes" | "fees"
  tokenId: bigint
  escrow: LockKind
  /** Reward contracts with something earned, and their earning tokens. */
  rewards: { contract: Address; tokens: Address[] }[]
}

/** Where a claim's rewards come from, in plain words. */
function claimSource(call: ClaimCall): string {
  if (call.kind === "fees") return "Pool fees"
  switch (call.voter) {
    case "boost":
      return "Boost rewards"
    case "third-party":
      return "Cross-chain rewards"
    case "validators":
      return "Validator rewards"
    case "pools":
      return "Pool incentives"
  }
}

export function claimPlan(
  calls: readonly ClaimCall[],
  /** The epoch the rewards were earned in: "Boost rewards from Epoch 46". */
  options: { epoch?: number } = {},
): PlanStep[] {
  const perLock = new Map<string, number>()
  for (const call of calls) {
    const key = `${call.escrow}-${call.tokenId}`
    perLock.set(key, (perLock.get(key) ?? 0) + 1)
  }
  return calls
    .filter((call) => call.rewards.length > 0)
    .map((call) => {
      const shared = (perLock.get(`${call.escrow}-${call.tokenId}`) ?? 0) > 1
      const suffix = shared
        ? call.kind === "fees"
          ? ", pool fees"
          : `, ${voteLabels[call.voter]}`
        : ""
      return {
        id: `claim-${call.escrow}-${call.tokenId}-${call.voter}-${call.kind}`,
        label: `Claim ${escrowName[call.escrow]} #${call.tokenId}${suffix}`,
        detail:
          options.epoch === undefined
            ? claimSource(call)
            : `${claimSource(call)} from Epoch ${options.epoch}`,
        prepare: fixed({
          to: voterAddress[call.voter],
          data: encodeFunctionData({
            abi: VOTER_WRITE_ABI,
            functionName: call.kind === "fees" ? "claimFees" : "claimBribes",
            args: [
              call.rewards.map((reward) => reward.contract),
              call.rewards.map((reward) => reward.tokens),
              call.tokenId,
            ],
          }),
          abi: VOTER_WRITE_ABI,
          contract: voterName[call.voter],
        }),
      }
    })
}

// ---------------------------------------------------------------------------
// Locks
// ---------------------------------------------------------------------------

/** Steps that add to an escrow: approve when short, then the call. */
function withApproval(
  approval: {
    token: Address
    symbol: string
    allowance: bigint
    amount: bigint
    amountLabel: string
    spender: Address
  },
  step: PlanStep,
): PlanStep[] {
  return needsApproval(approval.allowance, approval.amount)
    ? [approveStep(approval), step]
    : [step]
}

export type NewLockInput = {
  kind: LockKind
  token: Address
  symbol: string
  amount: bigint
  amountLabel: string
  allowance: bigint
  /** Seconds from now; rounded down to the week on chain. */
  duration: bigint
  autoMax: boolean
  owner: Address
  /** Where the escrow puts the unlock (unix seconds), for the subtitle. */
  unlocksAt?: number
}

/** The lock id minted in a createLock receipt. */
export function mintedTokenId(
  receipt: TransactionReceipt,
  escrow: Address,
  owner: Address,
): bigint {
  const transfers = parseEventLogs({
    abi: VOTING_ESCROW_WRITE_ABI,
    eventName: "Transfer",
    logs: receipt.logs,
  })
  const minted = transfers.find(
    (log) =>
      log.address.toLowerCase() === escrow.toLowerCase() &&
      log.args.from === zeroAddress &&
      log.args.to.toLowerCase() === owner.toLowerCase(),
  )
  if (minted === undefined) throw new Error("No lock minted")
  return minted.args.tokenId
}

export function newLockPlan(input: NewLockInput): PlanStep[] {
  const escrow = escrowAddress(input.kind)
  const create: PlanStep = {
    id: "create",
    label: `Lock ${input.amountLabel} ${input.symbol}`,
    detail:
      input.unlocksAt === undefined
        ? `Locked for ${weeksLabel(input.duration)}`
        : `Locked until ${unlockDate(input.unlocksAt)}`,
    prepare: fixed({
      to: escrow,
      data: encodeFunctionData({
        abi: VOTING_ESCROW_WRITE_ABI,
        functionName: "createLock",
        args: [input.amount, input.duration],
      }),
      abi: VOTING_ESCROW_WRITE_ABI,
      contract: escrowName[input.kind],
    }),
  }
  const steps = withApproval({ ...input, spender: escrow }, create)
  if (!input.autoMax) return steps
  return [
    ...steps,
    {
      id: "auto-max",
      label: "Turn on auto max",
      detail: autoMaxDetail,
      awaits: "the new lock id",
      prepare: (receipts) => {
        const receipt = receipts.get("create")
        if (receipt === undefined) throw new Error("Lock not created")
        return {
          to: escrow,
          data: encodeFunctionData({
            abi: VOTING_ESCROW_WRITE_ABI,
            functionName: "lockPermanent",
            args: [mintedTokenId(receipt, escrow, input.owner)],
          }),
          abi: VOTING_ESCROW_WRITE_ABI,
          contract: escrowName[input.kind],
        }
      },
    },
  ]
}

export function addPlan(input: {
  kind: LockKind
  tokenId: bigint
  token: Address
  symbol: string
  amount: bigint
  amountLabel: string
  allowance: bigint
  /** The lock's unlock (unix seconds), or auto max, for the subtitle. */
  unlocksAt?: number | "auto-max"
}): PlanStep[] {
  const escrow = escrowAddress(input.kind)
  return withApproval(
    { ...input, spender: escrow },
    {
      id: "add",
      label: `Add to #${input.tokenId}`,
      detail:
        input.unlocksAt === undefined
          ? "Keeps its unlock date"
          : input.unlocksAt === "auto-max"
            ? autoMaxDetail
            : `Locked until ${unlockDate(input.unlocksAt)}`,
      prepare: fixed({
        to: escrow,
        data: encodeFunctionData({
          abi: VOTING_ESCROW_WRITE_ABI,
          functionName: "increaseAmount",
          args: [input.tokenId, input.amount],
        }),
        abi: VOTING_ESCROW_WRITE_ABI,
        contract: escrowName[input.kind],
      }),
    },
  )
}

export function extendPlan(input: {
  kind: LockKind
  tokenId: bigint
  /** null turns on auto max (lockPermanent) instead. */
  duration: bigint | null
  /** The new unlock (unix seconds), for the subtitle. */
  unlocksAt?: number
}): PlanStep[] {
  const escrow = escrowAddress(input.kind)
  return [
    {
      id: input.duration === null ? "auto-max" : "extend",
      label:
        input.duration === null
          ? `Turn on auto max for #${input.tokenId}`
          : `Extend #${input.tokenId}`,
      detail:
        input.duration === null
          ? autoMaxDetail
          : input.unlocksAt === undefined
            ? `Unlocks in ${weeksLabel(input.duration)}`
            : `Unlocks ${unlockDate(input.unlocksAt)}`,
      prepare: fixed({
        to: escrow,
        data:
          input.duration === null
            ? encodeFunctionData({
                abi: VOTING_ESCROW_WRITE_ABI,
                functionName: "lockPermanent",
                args: [input.tokenId],
              })
            : encodeFunctionData({
                abi: VOTING_ESCROW_WRITE_ABI,
                functionName: "increaseUnlockTime",
                args: [input.tokenId, input.duration],
              }),
        abi: VOTING_ESCROW_WRITE_ABI,
        contract: escrowName[input.kind],
      }),
    },
  ]
}

/** Turns auto max off: the lock starts counting down from the maximum. */
export function autoMaxOffPlan(input: {
  kind: LockKind
  tokenId: bigint
  /** Where the escrow puts the unlock (unix seconds), for the subtitle. */
  unlocksAt?: number
}): PlanStep[] {
  const escrow = escrowAddress(input.kind)
  return [
    {
      id: "auto-max-off",
      label: `Turn off auto max for #${input.tokenId}`,
      detail:
        input.unlocksAt === undefined
          ? "Counts down from the maximum"
          : `Unlocks ${unlockDate(input.unlocksAt)}`,
      prepare: fixed({
        to: escrow,
        data: encodeFunctionData({
          abi: VOTING_ESCROW_WRITE_ABI,
          functionName: "unlockPermanent",
          args: [input.tokenId],
        }),
        abi: VOTING_ESCROW_WRITE_ABI,
        contract: escrowName[input.kind],
      }),
    },
  ]
}

/**
 * A lock that voted keeps `voted` set until its votes are reset, and merge
 * and withdraw revert AlreadyVoted until then. One reset per voter it voted
 * through.
 */
export function resetSteps(
  tokenId: bigint,
  voters: readonly VoterKind[],
): PlanStep[] {
  return voters.map((voter) => ({
    id: `reset-${voter}`,
    label: `Clear #${tokenId} votes`,
    detail: `Removes its ${gaugeType[voter]} votes`,
    prepare: fixed({
      to: voterAddress[voter],
      data: encodeFunctionData({
        abi: VOTER_WRITE_ABI,
        functionName: "reset",
        args: [tokenId],
      }),
      abi: VOTER_WRITE_ABI,
      contract: voterName[voter],
    }),
  }))
}

export function mergePlan(input: {
  kind: LockKind
  from: bigint
  to: bigint
  resetVoters: readonly VoterKind[]
  /** An auto max source turns it off first (merge reverts PermanentLock). */
  autoMaxOff?: boolean
}): PlanStep[] {
  const escrow = escrowAddress(input.kind)
  return [
    ...resetSteps(input.from, input.resetVoters),
    ...(input.autoMaxOff === true
      ? autoMaxOffPlan({ kind: input.kind, tokenId: input.from })
      : []),
    {
      id: "merge",
      label: `Merge #${input.from} into #${input.to}`,
      detail: "Keeps the later unlock date",
      prepare: fixed({
        to: escrow,
        data: encodeFunctionData({
          abi: VOTING_ESCROW_WRITE_ABI,
          functionName: "merge",
          args: [input.from, input.to],
        }),
        abi: VOTING_ESCROW_WRITE_ABI,
        contract: escrowName[input.kind],
      }),
    },
  ]
}

export function withdrawPlan(input: {
  kind: LockKind
  tokenId: bigint
  resetVoters: readonly VoterKind[]
  /** What comes back ("18,402.00" and "MEZO"), for the subtitle. */
  amountLabel?: string
  symbol?: string
}): PlanStep[] {
  const escrow = escrowAddress(input.kind)
  return [
    ...resetSteps(input.tokenId, input.resetVoters),
    {
      id: "withdraw",
      label: `Withdraw from #${input.tokenId}`,
      detail:
        input.amountLabel === undefined || input.symbol === undefined
          ? "Locked tokens back to your wallet"
          : `${input.amountLabel} ${input.symbol} back to your wallet`,
      prepare: fixed({
        to: escrow,
        data: encodeFunctionData({
          abi: VOTING_ESCROW_WRITE_ABI,
          functionName: "withdraw",
          args: [input.tokenId],
        }),
        abi: VOTING_ESCROW_WRITE_ABI,
        contract: escrowName[input.kind],
      }),
    },
  ]
}

// ---------------------------------------------------------------------------
// Incentives
// ---------------------------------------------------------------------------

export type IncentivesInput = {
  voter: VoterKind
  gauge: Address
  /** The gauge's bribe contract; PoolsVoter pays it directly. */
  bribe: Address
  token: Address
  symbol: string
  amount: bigint
  amountLabel: string
  allowance: bigint
  /** The gauge's name and the epoch the incentives pay, for the subtitle. */
  gaugeName?: string
  epoch?: number
}

function incentivesDetail(input: IncentivesInput): string {
  const voters =
    input.gaugeName === undefined
      ? "Paid to this gauge's voters"
      : `Paid to ${input.gaugeName} voters`
  return input.epoch === undefined ? voters : `${voters}, Epoch ${input.epoch}`
}

/**
 * BoostVoter, ValidatorsVoter and ThirdPartyVoter take incentives through
 * `addBribes`; PoolsVoter has none, so pool incentives go to the gauge's
 * bribe contract with `notifyRewardAmount`.
 */
export function incentivesPlan(input: IncentivesInput): PlanStep[] {
  const direct = input.voter === "pools"
  const spender = direct ? input.bribe : voterAddress[input.voter]
  const deposit: PlanStep = {
    id: "deposit",
    label: `Add ${input.amountLabel} ${input.symbol}`,
    detail: incentivesDetail(input),
    prepare: fixed(
      direct
        ? {
            to: input.bribe,
            data: encodeFunctionData({
              abi: VOTING_REWARD_WRITE_ABI,
              functionName: "notifyRewardAmount",
              args: [input.token, input.amount],
            }),
            abi: VOTING_REWARD_WRITE_ABI,
            contract: "Pool incentives",
          }
        : {
            to: voterAddress[input.voter],
            data: encodeFunctionData({
              abi: VOTER_WRITE_ABI,
              functionName: "addBribes",
              args: [input.gauge, [input.token], [input.amount]],
            }),
            abi: VOTER_WRITE_ABI,
            contract: voterName[input.voter],
          },
    ),
  }
  return withApproval({ ...input, spender }, deposit)
}

// ---------------------------------------------------------------------------
// Send and transfer
// ---------------------------------------------------------------------------

export type SendToken =
  | { address: Address; symbol: string; decimals: number }
  | "BTC"

/**
 * Sends a token: an ERC-20 `transfer`, or for "BTC" (Mezo's native gas
 * token, 18 decimals) a plain value transfer with no calldata.
 */
export function sendPlan(input: {
  token: SendToken
  to: Address
  amount: bigint
}): PlanStep[] {
  const to = getAddress(input.to)
  const symbol = input.token === "BTC" ? "BTC" : input.token.symbol
  const decimals = input.token === "BTC" ? 18 : input.token.decimals
  return [
    {
      id: "send",
      label: `Send ${amountLabel(input.amount, decimals, symbol)} ${symbol}`,
      detail: `To ${shortAddress(to)}`,
      prepare: fixed(
        input.token === "BTC"
          ? { to, data: "0x", value: input.amount, abi: [], contract: "BTC" }
          : {
              to: input.token.address,
              data: encodeFunctionData({
                abi: ERC20_ABI,
                functionName: "transfer",
                args: [to, input.amount],
              }),
              abi: ERC20_ABI,
              contract: input.token.symbol,
            },
      ),
    },
  ]
}

/**
 * Moves a lock to another owner: clears this epoch's votes first (one
 * reset per voter it voted with), then the owner's own `safeTransferFrom`,
 * which refuses a contract that cannot hold the lock. Never an approve.
 */
/**
 * The owner's own `safeTransferFrom`. The escrow moves a lock with live
 * votes as is (no AlreadyVoted check on transfer), so there is no reset.
 */
export function transferPlan(input: {
  kind: LockKind
  tokenId: bigint
  from: Address
  to: Address
}): PlanStep[] {
  const escrow = escrowAddress(input.kind)
  const to = getAddress(input.to)
  return [
    {
      id: "transfer",
      label: `Transfer ${escrowName[input.kind]} #${input.tokenId}`,
      detail: `To ${shortAddress(to)}`,
      prepare: fixed({
        to: escrow,
        data: encodeFunctionData({
          abi: VOTING_ESCROW_WRITE_ABI,
          functionName: "safeTransferFrom",
          args: [getAddress(input.from), to, input.tokenId],
        }),
        abi: VOTING_ESCROW_WRITE_ABI,
        contract: escrowName[input.kind],
      }),
    },
  ]
}
