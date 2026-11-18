import {
  ERC20_ABI,
  VEBTC_MAX_LOCK_SECONDS,
  VEMEZO_MAX_LOCK_SECONDS,
  VOTER_WRITE_ABI,
  VOTING_ESCROW_WRITE_ABI,
} from "@matchbox/chain"
import type {
  Evidence,
  Fact,
  Proposal,
  TransactionRequest,
} from "@matchbox/stuart-ui/contract"
import { type Address, encodeFunctionData, getAddress, isAddress } from "viem"
import { z } from "zod"
import { displayToken, listWithAnd, shortAddress, tokenAmount } from "../format"
import {
  BLOCKED_TEXT,
  type BlockedReason,
  type LockActionKind,
  lockVerdict,
  mergeTargetVerdict,
} from "../lockRules"
import { makeEvidence, makeFact, type ToolOutcome, traceItem } from "../outcome"
import {
  callTarget,
  expiresAt,
  type ProposalDraft,
  sealProposal,
  signability,
  simulationOf,
} from "../proposals"
import type { ClaimVoter } from "../providers/claimsChain"
import {
  escrowOf,
  type LockAsset,
  type LockChainState,
  VOTER_ADDRESSES,
} from "../providers/locks"
import { wholeToBaseUnits } from "../providers/units"
import { errorOutcome, plainOutcome, ZERO_WALLET } from "./common"
import { defineTool, type ToolContext } from "./tool"

// Lock actions as unsigned proposals: add, extend, auto max, withdraw an
// expired lock, merge and transfer. Each checks the lock's chain state
// against the rules in ../lockRules (vesting, managed, expired, auto max,
// votes to reset, escrows never mix), then simulates the whole sequence.
// Never an ERC-721 approve, never a relayer: a transfer is the owner's own
// safeTransferFrom, an add approves the escrow token for exactly the amount.

const WEEK = 604_800n
const TOOL = "prepare_lock_action"
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
]

/** Unix seconds to "Thu 2 Mar 2028". */
export function unlockDay(unix: bigint): string {
  const date = new Date(Number(unix) * 1000)
  return `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`
}

const VOTER_WORD: Record<ClaimVoter, string> = {
  boost: "veBTC gauge",
  "third-party": "MEZO gauge",
  validators: "validator",
  pools: "pool",
}

const SYMBOL: Record<LockAsset, string> = { veMEZO: "MEZO", veBTC: "BTC" }

export const lockActionInput = z.object({
  action: z.enum([
    "add",
    "extend",
    "auto_max",
    "withdraw",
    "merge",
    "transfer",
  ]),
  tokenId: z
    .string()
    .regex(/^\d{1,12}$/)
    .nullable()
    .describe("The lock, e.g. 2930, null picks the only fitting lock."),
  intoTokenId: z
    .string()
    .regex(/^\d{1,12}$/)
    .nullable()
    .describe("Merge only: the lock that receives tokenId."),
  amount: z
    .string()
    .regex(/^\d{1,15}(\.\d{1,18})?$/)
    .nullable()
    .describe("Add only: whole tokens, e.g. 1000 or 0.05."),
  weeks: z
    .number()
    .int()
    .min(1)
    .max(208)
    .nullable()
    .describe("Extend only: new duration in weeks from now, null = maximum."),
  recipient: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/)
    .nullable()
    .describe("Transfer only: the recipient's 0x address."),
})

export type LockActionInput = z.infer<typeof lockActionInput>

type Plan = {
  asset: LockAsset
  lock: LockChainState
  into: LockChainState | null
  calls: Array<
    Omit<
      TransactionRequest,
      "index" | "chainId" | "from" | "dependsOn" | "refreshAfterDependency"
    >
  >
  approval: { token: Address; amount: bigint } | null
  amount: bigint | null
  unlocksAt: bigint | null
  recipient: Address | null
  resets: ClaimVoter[]
  lead: string
}

function stop(
  context: ToolContext,
  text: string,
  templateId: string,
  facts: Fact[] = [],
): ToolOutcome {
  // What the answer read: the wallet's locks and, for a refusal, the lock's
  // state on chain.
  const evidence: Evidence[] =
    facts.length === 0
      ? []
      : [
          makeEvidence({
            scope: context.scope,
            key: "locks",
            kind: "chain",
            label: "Lock state",
            source: "veMEZO and veBTC escrows",
            fetchedAt: context.now().toISOString(),
            status: "live",
          }),
        ]
  const refs = evidence.map((item) => item.id)
  const cited = facts.map((fact) => ({ ...fact, evidenceRefs: refs }))
  return {
    ...plainOutcome({
      scope: context.scope,
      tool: TOOL,
      intent: "navigate",
      status: "empty",
      title: "Lock",
      templateId,
      text,
      kind: "empty",
      traceLabel: "Checked the lock",
      evidence,
    }),
    facts: cited,
    answer: {
      kind: "empty",
      templateId,
      text,
      factRefs: cited.map((fact) => fact.id),
    },
  }
}

function idsFact(context: ToolContext, ids: readonly bigint[]): Fact {
  const display = listWithAnd(ids.map((id) => `#${id}`)).slice(0, 60)
  return makeFact({
    scope: context.scope,
    key: "lock_ids",
    label: "Locks",
    value: { kind: "text", text: display },
    display,
    status: "live",
    evidenceRefs: [],
  })
}

function resetCalls(
  tokenId: bigint,
  resets: readonly ClaimVoter[],
): Plan["calls"] {
  return resets.map((voter) => ({
    to: VOTER_ADDRESSES[voter],
    data: encodeFunctionData({
      abi: VOTER_WRITE_ABI,
      functionName: "reset",
      args: [tokenId],
    }),
    value: "0x0",
    kind: "reset",
    label: `Clear #${tokenId} votes`,
    detail: `Removes its ${VOTER_WORD[voter]} votes`,
  }))
}

/** Picks the lock: the one named, else the only one the action fits. */
async function pickLock(
  context: ToolContext,
  input: LockActionInput,
): Promise<
  | { kind: "found"; asset: LockAsset; tokenId: bigint }
  | { kind: "stop"; outcome: ToolOutcome }
> {
  const owner = context.wallet.address
  const [mezo, btc] = await Promise.all([
    context.providers.walletLocks(owner, "veMEZO"),
    context.providers.walletLocks(owner, "veBTC"),
  ])
  const all = [...mezo, ...btc]
  if (input.tokenId !== null) {
    const id = BigInt(input.tokenId)
    const found = all.find((lock) => lock.tokenId === id)
    if (found === undefined) {
      return {
        kind: "stop",
        outcome: stop(
          context,
          BLOCKED_TEXT.lock_not_owned,
          `${TOOL}.not_owned.v1`,
        ),
      }
    }
    return { kind: "found", asset: found.asset, tokenId: id }
  }
  const nowSeconds = BigInt(Math.floor(context.now().getTime() / 1000))
  const fits = all.filter((lock) => {
    const expired =
      !lock.isPermanent && lock.end !== 0n && lock.end <= nowSeconds
    if (input.action === "withdraw") return expired
    if (input.action === "add") return !expired && lock.asset === "veMEZO"
    if (input.action === "extend" || input.action === "auto_max") {
      return !expired && !lock.isPermanent
    }
    return !expired
  })
  const only = fits[0]
  if (fits.length === 1 && only !== undefined) {
    return { kind: "found", asset: only.asset, tokenId: only.tokenId }
  }
  if (fits.length === 0) {
    return {
      kind: "stop",
      outcome: stop(
        context,
        input.action === "withdraw"
          ? "No expired lock to withdraw."
          : "No lock in this wallet fits that.",
        `${TOOL}.none.v1`,
      ),
    }
  }
  const fact = idsFact(
    context,
    fits.map((lock) => lock.tokenId),
  )
  return {
    kind: "stop",
    outcome: stop(context, `Which lock: ${fact.display}?`, `${TOOL}.which.v1`, [
      fact,
    ]),
  }
}

function blockedOutcome(
  context: ToolContext,
  reason: BlockedReason,
  until: bigint | null,
): ToolOutcome {
  if (
    until !== null &&
    (reason === "lock_vesting" || reason === "lock_not_expired")
  ) {
    const day = unlockDay(until)
    const fact = makeFact({
      scope: context.scope,
      key: "until",
      label: reason === "lock_vesting" ? "Vesting ends" : "Unlocks",
      value: { kind: "text", text: day },
      display: day,
      status: "live",
      evidenceRefs: [],
    })
    const text =
      reason === "lock_vesting"
        ? `This lock is vesting until ${day}.`
        : `This lock unlocks ${day}, so it cannot be withdrawn yet.`
    return stop(context, text, `${TOOL}.blocked.${reason}.v1`, [fact])
  }
  return stop(context, BLOCKED_TEXT[reason], `${TOOL}.blocked.${reason}.v1`)
}

async function planAction(
  context: ToolContext,
  input: LockActionInput,
): Promise<
  | { kind: "plan"; plan: Plan; now: bigint; blockNumber: bigint }
  | { kind: "stop"; outcome: ToolOutcome }
> {
  const picked = await pickLock(context, input)
  if (picked.kind === "stop") return picked
  const { asset, tokenId } = picked
  const owner = context.wallet.address
  const ids = [tokenId]
  if (input.action === "merge") {
    if (input.intoTokenId === null) {
      return {
        kind: "stop",
        outcome: stop(
          context,
          "Which lock should it merge into?",
          `${TOOL}.merge_into.v1`,
        ),
      }
    }
    ids.push(BigInt(input.intoTokenId))
  }
  const states = await context.providers.lockStates(asset, ids)
  const lock = states.locks[0]
  if (lock === undefined) throw new Error("No lock state")
  const now = states.now
  const verdict = lockVerdict(lock, input.action as LockActionKind, now, owner)
  if (!verdict.ok) {
    return {
      kind: "stop",
      outcome: blockedOutcome(context, verdict.reason, verdict.until),
    }
  }
  let into: LockChainState | null = null
  if (input.action === "merge") {
    const target = states.locks[1] ?? null
    if (target === null) {
      return {
        kind: "stop",
        outcome: stop(
          context,
          BLOCKED_TEXT.lock_not_owned,
          `${TOOL}.not_owned.v1`,
        ),
      }
    }
    // A merge across escrows reads the target in the wrong escrow: its
    // owner comes back empty. Say so plainly.
    const otherAsset: LockAsset = asset === "veMEZO" ? "veBTC" : "veMEZO"
    const otherLocks = await context.providers.walletLocks(owner, otherAsset)
    if (
      otherLocks.some((entry) => entry.tokenId === target.tokenId) &&
      target.owner === null
    ) {
      return {
        kind: "stop",
        outcome: stop(
          context,
          BLOCKED_TEXT.different_escrows,
          `${TOOL}.blocked.different_escrows.v1`,
        ),
      }
    }
    const targetVerdict = mergeTargetVerdict(lock, target, now, owner)
    if (!targetVerdict.ok) {
      return {
        kind: "stop",
        outcome: blockedOutcome(
          context,
          targetVerdict.reason,
          targetVerdict.until,
        ),
      }
    }
    into = target
  }
  const escrow = escrowOf(asset)
  const resets = verdict.resets
  const symbol = SYMBOL[asset]
  const base = {
    asset,
    lock,
    into,
    resets,
    approval: null,
    amount: null,
    unlocksAt: null,
    recipient: null,
  }
  const lockCall = (
    functionName: string,
    args: readonly unknown[],
    label: string,
    detail: string,
    kind: "lock" | "transfer" = "lock",
  ) => ({
    to: escrow,
    data: encodeFunctionData({
      abi: VOTING_ESCROW_WRITE_ABI,
      functionName,
      args,
    } as never),
    value: "0x0" as const,
    kind,
    label,
    detail,
  })
  switch (input.action) {
    case "add": {
      if (input.amount === null) {
        return {
          kind: "stop",
          outcome: stop(
            context,
            "How much should it add?",
            `${TOOL}.amount.v1`,
          ),
        }
      }
      const amount = wholeToBaseUnits(input.amount, 18)
      if (amount <= 0n) {
        return {
          kind: "stop",
          outcome: stop(
            context,
            "How much should it add?",
            `${TOOL}.amount.v1`,
          ),
        }
      }
      const funding = await context.providers.escrowFunding(asset, owner)
      if (funding.balance < amount) {
        return {
          kind: "stop",
          outcome: stop(
            context,
            BLOCKED_TEXT.insufficient_balance,
            `${TOOL}.balance.v1`,
          ),
        }
      }
      const shown = displayToken(tokenAmount(amount, 18, symbol))
      const calls: Plan["calls"] = []
      if (funding.allowance < amount) {
        calls.push({
          to: funding.token,
          data: encodeFunctionData({
            abi: ERC20_ABI,
            functionName: "approve",
            args: [escrow, amount],
          }),
          value: "0x0",
          kind: "approve",
          label: `Approve ${shown}`,
          detail: "Exactly this amount, nothing more",
        })
      }
      calls.push(
        lockCall(
          "increaseAmount",
          [tokenId, amount],
          `Add to #${tokenId}`,
          lock.isPermanent
            ? "Full voting power, no unlock date"
            : `Locked until ${unlockDay(lock.end)}`,
        ),
      )
      return {
        kind: "plan",
        now,
        blockNumber: states.blockNumber,
        plan: {
          ...base,
          calls,
          amount,
          approval:
            funding.allowance < amount
              ? { token: funding.token, amount }
              : null,
          lead: `Add ${shown} to ${asset} #${tokenId}`,
        },
      }
    }
    case "extend": {
      const max = BigInt(
        asset === "veMEZO" ? VEMEZO_MAX_LOCK_SECONDS : VEBTC_MAX_LOCK_SECONDS,
      )
      const requested = input.weeks === null ? max : BigInt(input.weeks) * WEEK
      // biome-ignore lint/complexity/useMathMinMax: Math.min takes no bigints.
      const duration = requested > max ? max : requested
      const newEnd = ((now + duration) / WEEK) * WEEK
      if (newEnd <= lock.end) {
        return {
          kind: "stop",
          outcome: stop(
            context,
            `Already locked until ${unlockDay(lock.end)}.`,
            `${TOOL}.already.v1`,
            [
              makeFact({
                scope: context.scope,
                key: "until",
                label: "Unlocks",
                value: { kind: "text", text: unlockDay(lock.end) },
                display: unlockDay(lock.end),
                status: "live",
                evidenceRefs: [],
              }),
            ],
          ),
        }
      }
      return {
        kind: "plan",
        now,
        blockNumber: states.blockNumber,
        plan: {
          ...base,
          unlocksAt: newEnd,
          calls: [
            lockCall(
              "increaseUnlockTime",
              [tokenId, duration],
              `Extend #${tokenId}`,
              `Unlocks ${unlockDay(newEnd)}`,
            ),
          ],
          lead: `Extend ${asset} #${tokenId} to ${unlockDay(newEnd)}`,
        },
      }
    }
    case "auto_max":
      return {
        kind: "plan",
        now,
        blockNumber: states.blockNumber,
        plan: {
          ...base,
          calls: [
            lockCall(
              "lockPermanent",
              [tokenId],
              `Turn on auto max for #${tokenId}`,
              "Full voting power, no unlock date",
            ),
          ],
          lead: `Turn on auto max for ${asset} #${tokenId}`,
        },
      }
    case "withdraw": {
      const shown = displayToken(tokenAmount(lock.amount, 18, symbol))
      return {
        kind: "plan",
        now,
        blockNumber: states.blockNumber,
        plan: {
          ...base,
          amount: lock.amount,
          calls: [
            ...resetCalls(tokenId, resets),
            lockCall(
              "withdraw",
              [tokenId],
              `Withdraw from #${tokenId}`,
              `${shown} back to your wallet`,
            ),
          ],
          lead: `Withdraw ${shown} from ${asset} #${tokenId}`,
        },
      }
    }
    case "merge": {
      const target = into
      if (target === null) throw new Error("No merge target")
      return {
        kind: "plan",
        now,
        blockNumber: states.blockNumber,
        plan: {
          ...base,
          calls: [
            ...resetCalls(tokenId, resets),
            lockCall(
              "merge",
              [tokenId, target.tokenId],
              `Merge #${tokenId} into #${target.tokenId}`,
              "Keeps the later unlock date",
            ),
          ],
          lead: `Merge ${asset} #${tokenId} into #${target.tokenId}`,
        },
      }
    }
    case "transfer": {
      if (input.recipient === null || !isAddress(input.recipient)) {
        return {
          kind: "stop",
          outcome: stop(
            context,
            "Give the recipient's 0x address.",
            `${TOOL}.recipient.v1`,
          ),
        }
      }
      const recipient = getAddress(input.recipient)
      if (recipient.toLowerCase() === owner.toLowerCase()) {
        return {
          kind: "stop",
          outcome: stop(context, "That is this wallet.", `${TOOL}.self.v1`),
        }
      }
      return {
        kind: "plan",
        now,
        blockNumber: states.blockNumber,
        plan: {
          ...base,
          recipient,
          calls: [
            ...resetCalls(tokenId, resets),
            lockCall(
              "safeTransferFrom",
              [getAddress(owner), recipient, tokenId],
              `Transfer ${asset} #${tokenId}`,
              `To ${shortAddress(recipient)}`,
              "transfer",
            ),
          ],
          lead: `Transfer ${asset} #${tokenId} to ${shortAddress(recipient)}`,
        },
      }
    }
  }
}

export async function buildLockProposal(
  context: ToolContext,
  input: LockActionInput,
): Promise<
  | { proposal: Proposal; plan: Plan; blockNumber: bigint }
  | { stop: ToolOutcome }
> {
  const planned = await planAction(context, input)
  if (planned.kind === "stop") return { stop: planned.outcome }
  const { plan } = planned
  const from = context.wallet.address
  const calls: TransactionRequest[] = plan.calls.map((call, index) => ({
    ...call,
    index,
    chainId: 31_612,
    from,
    dependsOn: index === 0 ? null : index - 1,
    refreshAfterDependency: false,
  }))
  const simulated =
    calls.length === 1
      ? [
          await context.providers.simulateSingle(
            from,
            callTarget(calls[0] as TransactionRequest),
          ),
        ]
      : await context.providers.simulateSequence(from, calls.map(callTarget))
  const simulation = simulationOf(
    simulated,
    calls.length === 1 ? "eth_call" : "eth_simulateV1",
  )
  const draft: ProposalDraft = {
    kind: "lock",
    chainId: 31_612,
    from,
    origin: "user_request",
    ...signability({
      walletMode: context.wallet.mode,
      simulation,
      blockedReason: null,
      needsApproval: plan.approval !== null,
    }),
    createdAt: context.now().toISOString(),
    expiresAt: expiresAt("lock", context.now()),
    snapshotBlock: planned.blockNumber.toString(),
    calculationVersion: "lock-1.0.0",
    atomicity: calls.length > 1 ? "sequential_non_atomic" : "single",
    approvals:
      plan.approval === null
        ? []
        : [
            {
              token: plan.approval.token,
              spender: escrowOf(plan.asset),
              amount: tokenAmount(plan.approval.amount, 18, SYMBOL[plan.asset]),
              mode: "exact",
            },
          ],
    calls,
    simulation,
    quote: null,
    content: {
      kind: "lock",
      action: input.action,
      escrow: plan.asset,
      tokenId: plan.lock.tokenId.toString(),
      intoTokenId: plan.into?.tokenId.toString() ?? null,
      amount:
        plan.amount === null
          ? null
          : tokenAmount(plan.amount, 18, SYMBOL[plan.asset]),
      unlocksAt: plan.unlocksAt === null ? null : Number(plan.unlocksAt),
      recipient: plan.recipient,
      resets: plan.resets.length,
    },
  }
  return {
    proposal: await sealProposal(draft, context.secret),
    plan,
    blockNumber: planned.blockNumber,
  }
}

function signaturesText(count: number): string {
  return count === 1 ? "One signature" : `${count} signatures`
}

export const lockActionTool = defineTool({
  name: TOOL,
  family: "votes",
  description:
    "Prepare an unsigned lock action for the selected wallet: add tokens to a lock, extend it (weeks, or null for the maximum), turn on auto max, withdraw an expired lock, merge one lock into another of the same escrow, or transfer a lock to a 0x address. Checks vesting, managed, expired, auto max and votes that need a reset first. Never an NFT approval.",
  input: lockActionInput,
  async run(context, input) {
    if (context.wallet.address === ZERO_WALLET) {
      return plainOutcome({
        scope: context.scope,
        tool: TOOL,
        intent: "navigate",
        status: "empty",
        title: "Lock",
        templateId: `${TOOL}.no_wallet.v1`,
        text: "Connect or watch a wallet to act on its locks.",
        kind: "empty",
        traceLabel: "No wallet selected",
      })
    }
    try {
      const built = await buildLockProposal(context, input)
      if ("stop" in built) return built.stop
      const { proposal, plan, blockNumber } = built
      const { scope } = context
      const evidence: Evidence[] = [
        makeEvidence({
          scope,
          key: "lock",
          kind: "chain",
          label: `${plan.asset} escrow`,
          source: "locked, vestingEnd, escrowType, votedVoters",
          blockNumber: blockNumber.toString(),
          fetchedAt: context.now().toISOString(),
          status: "live",
        }),
      ]
      const refs = evidence.map((item) => item.id)
      const leadFact = makeFact({
        scope,
        key: "lead",
        label: "Action",
        value: { kind: "text", text: plan.lead.slice(0, 80) },
        display: plan.lead.slice(0, 60),
        status: "live",
        evidenceRefs: refs,
      })
      const countFact = makeFact({
        scope,
        key: "signatures",
        label: "Signatures",
        value: { kind: "count", count: proposal.calls.length },
        display: String(proposal.calls.length),
        status: "live",
        evidenceRefs: refs,
      })
      const facts = [leadFact, countFact]
      const text = `${leadFact.display}. ${signaturesText(proposal.calls.length)}.`
      const lockLine = plan.lock.isPermanent
        ? "Auto max"
        : plan.lock.end === 0n
          ? "No unlock date"
          : `Unlocks ${unlockDay(plan.lock.end)}`
      return {
        tool: TOOL,
        intent: "navigate",
        status: "ok",
        title: plan.lead.slice(0, 120),
        snapshot: {
          blockNumber,
          epoch: null,
          label: `block ${blockNumber.toLocaleString("en-US")}`,
        },
        answer: {
          kind: "result",
          templateId: `${TOOL}.${input.action}.v1`,
          text,
          factRefs: facts.map((fact) => fact.id),
        },
        why: null,
        facts,
        evidence,
        blocks: [],
        proposals: [proposal],
        followups: [],
        trace: [
          traceItem({
            scope,
            key: "read",
            label: `Read lock #${plan.lock.tokenId}`,
            detail: `${displayToken(tokenAmount(plan.lock.amount, 18, SYMBOL[plan.asset]))}, ${lockLine}`,
            tool: TOOL,
          }),
          traceItem({
            scope,
            key: "rules",
            label: "Checked the lock rules",
            detail: plan.resets.length
              ? `Votes to clear first on ${plan.resets.length} voter${plan.resets.length === 1 ? "" : "s"}`
              : "Not vesting, not managed, nothing to reset",
            tool: TOOL,
          }),
          traceItem({
            scope,
            key: "simulate",
            label: "Simulated the transaction",
            detail: `From ${shortAddress(context.wallet.address)}, ${proposal.simulation.status === "passed" ? "passed" : "reverted"}`,
            tool: TOOL,
            status: proposal.simulation.status === "passed" ? "ok" : "error",
          }),
        ],
        model: {
          rows: [
            {
              action: plan.lead,
              signatures: String(proposal.calls.length),
              simulation: proposal.simulation.status,
            },
          ],
          notes: [],
        },
        surface: "canvas",
        checked: [plan.into ? "2 locks" : "1 lock"],
      } satisfies ToolOutcome
    } catch {
      return errorOutcome({
        scope: context.scope,
        tool: TOOL,
        intent: "navigate",
        title: "Lock",
      })
    }
  },
})
