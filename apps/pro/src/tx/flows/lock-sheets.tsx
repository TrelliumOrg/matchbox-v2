import { TokenIcon } from "@matchbox/token-icons"
import { Glyph, shapes } from "@matchbox/ui/icons"
import * as SegmentedControl from "@matchbox/ui/segmented-control"
import * as Switch from "@matchbox/ui/switch"
import { type ReactNode, useId, useState } from "react"
import { LockBoostPanel } from "../../boost/lock-boost-panel"
import type { Lock, LockKind } from "../../data/view-models"
import {
  formatCompact,
  formatDate,
  formatDay,
  formatToken,
  formatUsd,
  formatVeBtc,
  shortAddress,
  weiToWhole,
} from "../../lib/format"
import { gaugeName } from "../../lib/gauge-name"
import { useLive } from "../../live/live-context"
import {
  blockLabel,
  type LockAction,
  type LockBlock,
  type LockFacts,
  lockEligibility,
  mergeTargetBlock,
  viewFacts,
} from "../../locks/eligibility"
import { amountLabel, parseAmount, toDecimal, usdValue } from "../amounts"
import {
  type DurationChoice,
  durations,
  extendDurations,
  maxLockSeconds,
  unlockAt,
  votingPowerAt,
} from "../durations"
import { openClaim } from "../open-claim"
import {
  addPlan,
  autoMaxOffPlan,
  escrowAddress,
  extendPlan,
  mergePlan,
  newLockPlan,
  resetSteps,
  withdrawPlan,
} from "../plans"
import {
  chainTime,
  type LockState,
  lockFacts,
  lockState,
  locksFacts,
  lockToken,
  tokenState,
} from "../reads"
import { type PrepareContext, type Review, TxSheet } from "../tx-sheet"
import { openTx, type TxRequest } from "../tx-store"
import { AmountField, LockPreview, useChainRead } from "./parts"

/**
 * The lock flows: New lock (`uRQ0EspYqi`), Add (`EmAMfb9C92`), Extend
 * (`yUKrUWakzM`), Merge (`iiUgPHy2Az`) and Withdraw (`eMGjuGc1IY`), each
 * a form, then review and signing (`bFRmKIn4eA`).
 */

export type Props<F extends TxRequest["flow"]> = PrepareContext & {
  request: Extract<TxRequest, { flow: F }>
}

export const escrowLabel = { vebtc: "veBTC", vemezo: "veMEZO" } as const
export const refreshLocks = [
  "overview",
  "voter",
  "activity",
  "rewards",
] as const

export function wei(decimal: string): bigint {
  return parseAmount(decimal, 18) ?? 0n
}

/** "41.26k veMEZO", "0.6110 veBTC": always in the escrow's unit. */
export function powerLabel(kind: LockKind, amount: bigint): string {
  return kind === "vebtc"
    ? formatVeBtc(toDecimal(amount, 18))
    : `${formatCompact(weiToWhole(`${amount}`))} veMEZO`
}

/**
 * The lock's edge cases (`locks/eligibility`) on chain, before the wallet
 * opens: who owns it, then what it may do now and whether it resets first.
 */
export function checkLock(
  chain: LockState,
  lock: Pick<Lock, "kind" | "tokenId">,
  action: LockAction,
  account: string,
): { blocked: string | null; reset: boolean; autoMaxOff: boolean } {
  if (chain.owner.toLowerCase() !== account.toLowerCase()) {
    return { blocked: "Not your lock", reset: false, autoMaxOff: false }
  }
  const result = lockEligibility(
    lockFacts(lock.kind, BigInt(lock.tokenId), chain),
    action,
    chain.now,
  )
  return result.ok
    ? { blocked: null, reset: result.reset, autoMaxOff: result.autoMaxOff }
    : { blocked: blockLabel(result.block), reset: false, autoMaxOff: false }
}

/** Why the lock cannot run `action`, read on chain when the form opens. */
export function useLockBlock(
  context: PrepareContext,
  lock: Pick<Lock, "kind" | "tokenId">,
  action: LockAction,
): LockBlock | null {
  const read = useChainRead(`${action}-${lock.kind}-${lock.tokenId}`, () =>
    lockState(context.config, lock.kind, BigInt(lock.tokenId)),
  )
  if (read.data === null) return null
  const result = lockEligibility(
    lockFacts(lock.kind, BigInt(lock.tokenId), read.data),
    action,
    read.data.now,
  )
  return result.ok ? null : result.block
}

/** A blocked state at the top of a form (amber in the design). */
export function BlockBanner({ block }: { block: LockBlock | null }): ReactNode {
  if (block === null) return null
  return <Notice label={blockLabel(block)} />
}

/**
 * A notice at the top of a form (amber): what stands in the way, and the
 * fix when there is one ("Claim first"), as an underlined action.
 */
export function Notice({
  label,
  action,
}: {
  label: string
  action?: { label: string; onClick: () => void } | undefined
}): ReactNode {
  return (
    <li>
      <div
        role="status"
        className="flex items-center gap-3 rounded-[20px] bg-acc-soft px-4 py-3.5 text-[15.5px] font-semibold text-acc-ink"
      >
        <Glyph shape={shapes.circleAlert} size={20} strokeWidth={1.9} />
        <span className="min-w-0 flex-1">{label}</span>
        {action === undefined ? null : (
          <button
            type="button"
            onClick={action.onClick}
            className="flex-none cursor-pointer rounded-md underline underline-offset-4 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
          >
            {action.label}
          </button>
        )}
      </div>
    </li>
  )
}

/** "Claim first": the lock's own claim sheet, in place of this one. */
export function claimFirst(
  account: string,
  lock: Pick<Lock, "kind" | "tokenId">,
): { label: string; onClick: () => void } {
  return {
    label: "Claim first",
    onClick: () =>
      void openClaim(
        { kind: "connected", address: account },
        { relock: false, only: { kind: lock.kind, tokenId: lock.tokenId } },
      ),
  }
}

function usePrice(kind: LockKind): string | null {
  const { market } = useLive()
  return (
    (kind === "vebtc" ? market.prices.btc : market.prices.mezo)?.usd ?? null
  )
}

function amountError(
  amount: bigint | null,
  balance: bigint | null,
): string | null {
  if (amount === null || balance === null) return null
  return amount > balance ? "More than your balance" : null
}

// ---------------------------------------------------------------------------
// New lock
// ---------------------------------------------------------------------------

export function NewLockSheet({
  request,
  config,
  account,
}: Props<"new-lock">): ReactNode {
  const [kind, setKind] = useState<LockKind>(request.kind)
  const [input, setInput] = useState("")
  const [choice, setChoice] = useState<string>("auto")
  const token = lockToken[kind]
  const escrow = escrowAddress(kind)
  const price = usePrice(kind)
  const read = useChainRead(`${kind}-${account}`, async () => {
    const [state, now] = await Promise.all([
      tokenState(config, {
        token: token.address,
        owner: account,
        spender: escrow,
      }),
      chainTime(config),
    ])
    return { ...state, now }
  })
  const amount = parseAmount(input, token.decimals)
  const balance = read.data?.balance ?? null
  const error = amountError(amount, balance)
  const options = durations[kind]
  const picked = options.find((option) => option.id === choice) ?? null
  const now = read.data?.now ?? Math.floor(Date.now() / 1000)
  const end = picked === null ? null : unlockAt(now, picked.seconds)
  const label =
    amount === null ? "0" : amountLabel(amount, token.decimals, token.symbol)
  const usd = amount === null ? null : usdValue(amount, token.decimals, price)
  const votes = votingPowerAt({ kind, amount: amount ?? 0n, now, end })

  const summary = [
    {
      label: "Unlocks",
      value: end === null ? "Never (auto max)" : formatDate(end),
    },
    { label: "Voting power", value: `About ${powerLabel(kind, votes)}` },
    { label: "Lock type", value: escrowLabel[kind] },
  ]

  async function prepare(context: PrepareContext): Promise<Review> {
    if (amount === null) throw new Error("No amount")
    const state = await tokenState(context.config, {
      token: token.address,
      owner: context.account,
      spender: escrow,
    })
    const duration = picked?.seconds ?? options.at(-1)?.seconds ?? 0
    return {
      headline: {
        label: `New ${escrowLabel[kind]} lock`,
        figure: (
          <>
            <TokenIcon ticker={token.symbol} size={36} />
            {label} {token.symbol}
          </>
        ),
        sub: usd === null ? undefined : formatUsd(usd, "cents"),
      },
      rows: summary.slice(0, 2),
      signRows: 1,
      steps: newLockPlan({
        kind,
        token: token.address,
        symbol: token.symbol,
        amount,
        amountLabel: label,
        allowance: state.allowance,
        duration: BigInt(duration),
        autoMax: picked === null,
        owner: context.account,
      }),
      blocked: amount > state.balance ? "More than your balance" : null,
      done: { sub: `${label} ${token.symbol}`, rows: summary },
    }
  }

  return (
    <TxSheet
      config={config}
      account={account}
      titles={{
        form: "New lock",
        review: "Review",
        sign: "Sign",
        done: "Lock created",
      }}
      form={{
        cta: "Review",
        ready: amount !== null && error === null && balance !== null,
        content: (
          <ol className="flex flex-col gap-5">
            <li>
              <SegmentedControl.Root
                surface="sheet"
                value={kind}
                onValueChange={(value) => {
                  if (value === "vebtc" || value === "vemezo") {
                    setKind(value)
                    setInput("")
                  }
                }}
              >
                <SegmentedControl.Item value="vemezo">
                  MEZO
                </SegmentedControl.Item>
                <SegmentedControl.Item value="vebtc">BTC</SegmentedControl.Item>
              </SegmentedControl.Root>
            </li>
            <li>
              <AmountField
                label="You lock"
                symbol={token.symbol}
                value={input}
                onValueChange={setInput}
                balance={balance}
                decimals={token.decimals}
                usd={null}
                error={error}
              />
            </li>
            <li>
              <DurationPicker
                label="Duration"
                options={options}
                value={choice}
                onValueChange={setChoice}
                autoMax
              />
            </li>
            <li>
              <SummaryRows rows={summary} />
            </li>
            <li hidden={kind === "vebtc"}>
              <p className="mb-2.5 text-[15px] text-sec">Preview</p>
              <LockPreview
                kind={kind}
                title={`New ${escrowLabel[kind]} lock`}
                amount={`${label} ${token.symbol}`}
                {...(usd === null ? {} : { sub: formatUsd(usd, "cents") })}
                rows={[
                  { label: "Voting power", value: powerLabel(kind, votes) },
                  {
                    label: "Unlocks",
                    value: end === null ? "Auto max" : formatDate(end),
                  },
                ]}
              />
            </li>
            {/* BTC: the Boost panel takes the Preview's place. The rows above
                already say what the lock will be; what a veBTC lock earns
                depends on the veMEZO its gauge gets. MEZO: it follows the
                Preview, with the veBTC this veMEZO can boost. */}
            <li>
              <LockBoostPanel
                key={kind}
                kind={kind}
                votingPower={votes}
                account={account}
              />
            </li>
          </ol>
        ),
      }}
      prepare={prepare}
      reviewCta="Create lock"
      success={{ toast: "Lock created", refresh: [...refreshLocks] }}
    />
  )
}

// ---------------------------------------------------------------------------
// Add
// ---------------------------------------------------------------------------

export function AddSheet({
  request,
  config,
  account,
}: Props<"add">): ReactNode {
  const { lock } = request
  const token = lockToken[lock.kind]
  const escrow = escrowAddress(lock.kind)
  const price = usePrice(lock.kind)
  const [input, setInput] = useState("")
  const block = useLockBlock({ config, account }, lock, "add")
  const read = useChainRead(`add-${lock.tokenId}-${account}`, async () => {
    const [state, now] = await Promise.all([
      tokenState(config, {
        token: token.address,
        owner: account,
        spender: escrow,
      }),
      chainTime(config),
    ])
    return { ...state, now }
  })
  const amount = parseAmount(input, token.decimals)
  const balance = read.data?.balance ?? null
  const error = amountError(amount, balance)
  const now = read.data?.now ?? Math.floor(Date.now() / 1000)
  const locked = wei(lock.amount)
  const after = locked + (amount ?? 0n)
  const label =
    amount === null ? "0" : amountLabel(amount, token.decimals, token.symbol)
  const usd = amount === null ? null : usdValue(amount, token.decimals, price)
  const before = BigInt(lock.votingPowerWei)
  const next = votingPowerAt({
    kind: lock.kind,
    amount: after,
    now,
    end: lock.unlocksAt,
  })
  const rows = [
    {
      label: "Lock after",
      value: `${formatToken(toDecimal(after, 18), token.symbol)} ${token.symbol}`,
    },
    {
      label: "Voting power",
      value: `${powerLabel(lock.kind, before)} to ${powerLabel(lock.kind, next)}`,
    },
    {
      label: "Unlocks",
      value: lock.unlocksAt === null ? "Auto max" : formatDate(lock.unlocksAt),
    },
  ]

  async function prepare(context: PrepareContext): Promise<Review> {
    if (amount === null) throw new Error("No amount")
    const [state, chain] = await Promise.all([
      tokenState(context.config, {
        token: token.address,
        owner: context.account,
        spender: escrow,
      }),
      lockState(context.config, lock.kind, BigInt(lock.tokenId)),
    ])
    const check = checkLock(chain, lock, "add", context.account)
    return {
      headline: {
        label: `Add to ${escrowLabel[lock.kind]} #${lock.tokenId}`,
        figure: (
          <>
            <TokenIcon ticker={token.symbol} size={36} />
            {label} {token.symbol}
          </>
        ),
        sub: usd === null ? undefined : formatUsd(usd, "cents"),
      },
      rows,
      signRows: 1,
      steps: addPlan({
        kind: lock.kind,
        tokenId: BigInt(lock.tokenId),
        token: token.address,
        symbol: token.symbol,
        amount,
        amountLabel: label,
        allowance: state.allowance,
      }),
      blocked:
        check.blocked ??
        (amount > state.balance ? "More than your balance" : null),
      done: { sub: `${label} ${token.symbol} added`, rows },
    }
  }

  return (
    <TxSheet
      config={config}
      account={account}
      titles={{
        form: `Add ${token.symbol}`,
        review: "Review",
        sign: "Sign",
        done: "Lock updated",
      }}
      form={{
        cta: "Review",
        ready:
          amount !== null &&
          error === null &&
          balance !== null &&
          block === null,
        content: (
          <ol className="flex flex-col gap-5">
            <BlockBanner block={block} />
            <li>
              <LockPreview
                kind={lock.kind}
                title={`${escrowLabel[lock.kind]} #${lock.tokenId}`}
                amount={`${formatToken(lock.amount, token.symbol)} ${token.symbol}`}
                aside={
                  lock.unlocksAt === null
                    ? "Auto max"
                    : `Unlocks ${formatDate(lock.unlocksAt)}`
                }
              />
            </li>
            <li>
              <AmountField
                label="Add"
                symbol={token.symbol}
                value={input}
                onValueChange={setInput}
                balance={balance}
                decimals={token.decimals}
                usd={usd}
                error={error}
              />
            </li>
            <li>
              <SummaryRows rows={rows} />
            </li>
          </ol>
        ),
      }}
      prepare={prepare}
      reviewCta="Sign"
      success={{ toast: "Lock updated", refresh: [...refreshLocks] }}
    />
  )
}

// ---------------------------------------------------------------------------
// Extend
// ---------------------------------------------------------------------------

export function ExtendSheet({
  request,
  config,
  account,
}: Props<"extend">): ReactNode {
  const { lock } = request
  const token = lockToken[lock.kind]
  const options = extendDurations[lock.kind]
  const [choice, setChoice] = useState<string>(options.at(-1)?.id ?? "")
  const [autoMax, setAutoMax] = useState(false)
  const switchId = useId()
  // An auto max lock is already at the maximum: its sheet offers turning
  // auto max off instead (it then counts down from the maximum).
  const autoMaxLock = lock.unlocksAt === null
  const [autoMaxOff, setAutoMaxOff] = useState(false)
  const block = useLockBlock(
    { config, account },
    lock,
    autoMaxLock ? "auto-max-off" : "extend",
  )
  const read = useChainRead(`extend-${lock.tokenId}`, () => chainTime(config))
  const now = read.data ?? Math.floor(Date.now() / 1000)
  const current = lock.unlocksAt
  const picked = options.find((option) => option.id === choice) ?? null
  const end = autoMaxLock
    ? autoMaxOff
      ? unlockAt(now, maxLockSeconds(lock.kind))
      : null
    : autoMax || picked === null
      ? null
      : unlockAt(now, picked.seconds)
  const locked = wei(lock.amount)
  const before = BigInt(lock.votingPowerWei)
  const next = votingPowerAt({ kind: lock.kind, amount: locked, now, end })
  const later = end === null || current === null || end > current
  const rows = [
    {
      label: "Unlocks",
      value: `${current === null ? "Auto max" : formatDate(current)} to ${end === null ? "Never" : formatDate(end)}`,
    },
    {
      label: "Voting power",
      value: `${powerLabel(lock.kind, before)} to ${powerLabel(lock.kind, next)}`,
    },
    ...(lock.votes[0] === undefined
      ? []
      : [
          {
            label: lock.votes.length > 1 ? "Gauges" : "Gauge",
            value:
              lock.votes.length > 1
                ? `${lock.votes.length}`
                : gaugeName(lock.votes[0].gauge),
          },
        ]),
  ]

  async function prepare(context: PrepareContext): Promise<Review> {
    const chain = await lockState(
      context.config,
      lock.kind,
      BigInt(lock.tokenId),
    )
    const check = checkLock(
      chain,
      lock,
      autoMaxLock ? "auto-max-off" : "extend",
      context.account,
    )
    const tokenId = BigInt(lock.tokenId)
    return {
      headline: {
        label: `${escrowLabel[lock.kind]} #${lock.tokenId} unlocks`,
        figure:
          end === null
            ? "Never"
            : `${formatDay(end)} ${new Date(end * 1000).getUTCFullYear()}`,
        sub:
          current === null
            ? "was Auto max"
            : `was ${formatDay(current)} ${new Date(current * 1000).getUTCFullYear()}`,
      },
      rows: [
        {
          label: "Lock",
          value: `${formatToken(lock.amount, token.symbol)} ${token.symbol}`,
        },
        ...rows.slice(1),
      ],
      signRows: 2,
      steps: autoMaxLock
        ? [
            ...resetSteps(tokenId, check.reset ? chain.votedVoters : []),
            ...autoMaxOffPlan({
              kind: lock.kind,
              tokenId,
              ...(end === null ? {} : { unlocksAt: end }),
            }),
          ]
        : extendPlan({
            kind: lock.kind,
            tokenId,
            duration: end === null ? null : BigInt(picked?.seconds ?? 0),
          }),
      blocked:
        check.blocked ??
        (autoMaxLock
          ? autoMaxOff
            ? null
            : "Auto max is on"
          : !later
            ? "Pick a later unlock"
            : null),
      done: {
        sub: end === null ? "Auto max on" : `Unlocks ${formatDate(end)}`,
        rows,
      },
    }
  }

  return (
    <TxSheet
      config={config}
      account={account}
      titles={{
        form: "Extend unlock",
        review: "Review",
        sign: "Sign",
        done: autoMaxLock ? "Auto max off" : "Lock extended",
      }}
      form={{
        cta: "Review",
        ready:
          block === null &&
          !lock.expired &&
          (autoMaxLock ? autoMaxOff : current !== null && later),
        content: (
          <ol className="flex flex-col gap-5">
            <BlockBanner block={block} />
            <li>
              <LockPreview
                kind={lock.kind}
                title={`${escrowLabel[lock.kind]} #${lock.tokenId}`}
                amount={`${formatToken(lock.amount, token.symbol)} ${token.symbol}`}
                aside={
                  current === null
                    ? "Auto max"
                    : `Unlocks ${formatDay(current)} ${new Date(current * 1000).getUTCFullYear()}`
                }
              />
            </li>
            {current === null ? (
              <li className="flex items-center gap-4">
                <span className="grid size-11 flex-none place-items-center rounded-full bg-soft text-ink2 dark:bg-soft2">
                  <Glyph shape={shapes.infinity} size={20} strokeWidth={1.8} />
                </span>
                <label htmlFor={switchId} className="min-w-0 flex-1">
                  <span className="block text-base font-semibold">
                    Auto max
                  </span>
                  <span className="block text-[14.5px] text-sec">
                    {end === null
                      ? "Never unlocks"
                      : `Unlocks ${formatDate(end)}`}
                  </span>
                </label>
                <Switch.Root
                  id={switchId}
                  checked={!autoMaxOff}
                  onCheckedChange={(on) => setAutoMaxOff(!on)}
                />
              </li>
            ) : (
              <>
                <li>
                  <DurationPicker
                    label="Lock for"
                    options={options}
                    value={autoMax ? "" : choice}
                    onValueChange={(value) => {
                      setChoice(value)
                      setAutoMax(false)
                    }}
                    disabledBefore={{ now, current }}
                  />
                </li>
                <li className="flex items-center gap-4">
                  <span className="grid size-11 flex-none place-items-center rounded-full bg-soft text-ink2 dark:bg-soft2">
                    <Glyph
                      shape={shapes.infinity}
                      size={20}
                      strokeWidth={1.8}
                    />
                  </span>
                  <label htmlFor={switchId} className="min-w-0 flex-1">
                    <span className="block text-base font-semibold">
                      Auto max
                    </span>
                    <span className="block text-[14.5px] text-sec">
                      Never unlocks
                    </span>
                  </label>
                  <Switch.Root
                    id={switchId}
                    checked={autoMax}
                    onCheckedChange={setAutoMax}
                  />
                </li>
              </>
            )}
            <li>
              <SummaryRows rows={rows} />
            </li>
          </ol>
        ),
      }}
      prepare={prepare}
      reviewCta="Sign"
      success={{
        toast: autoMaxLock ? "Auto max off" : "Lock extended",
        refresh: [...refreshLocks],
      }}
    />
  )
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

/**
 * Merge (`iiUgPHy2Az`, edge cases `yMC5qM2D0S`): the card's lock merges into
 * one picked from the wallet's other locks, and is burned. Every other lock
 * stays in the Into list; the ones it cannot merge into are dimmed with the
 * reason ("Other escrow", "Expired", "Vesting until Sun 15 Apr 2029").
 */
export function MergeSheet({
  request,
  config,
  account,
}: Props<"merge">): ReactNode {
  const from = request.lock
  const name = useId()
  const targets = request.locks.filter(
    (lock) => !(lock.kind === from.kind && lock.tokenId === from.tokenId),
  )
  const sameEscrow = request.locks.filter((lock) => lock.kind === from.kind)
  const read = useChainRead(`merge-${from.kind}-${from.tokenId}`, () =>
    locksFacts(
      config,
      sameEscrow.map((lock) => ({
        kind: lock.kind,
        tokenId: BigInt(lock.tokenId),
      })),
    ),
  )
  const now = read.data?.now ?? Math.floor(Date.now() / 1000)
  const factsOf = (lock: Lock): LockFacts =>
    read.data?.facts.find(
      (facts) => facts.kind === lock.kind && facts.tokenId === lock.tokenId,
    ) ?? viewFacts(lock)
  const fromFacts = factsOf(from)
  const source = lockEligibility(fromFacts, "merge", now)
  const sourceBlock = source.ok ? null : source.block
  // Burning the lock forfeits what it has not claimed, so claim first.
  const unclaimed = wei(from.claimableUsd) > 0n
  const options = targets.map((lock) => ({
    lock,
    key: `${lock.kind}-${lock.tokenId}`,
    block: mergeTargetBlock(fromFacts, factsOf(lock), now),
  }))
  const open = options.filter((option) => option.block === null)
  const [picked, setPicked] = useState<string | null>(null)
  const intoKey = picked ?? (open.length === 1 ? (open[0]?.key ?? null) : null)
  const into = open.find((option) => option.key === intoKey)?.lock ?? null
  const token = lockToken[from.kind]
  const total = wei(from.amount) + (into === null ? 0n : wei(into.amount))
  // An auto max source turns it off first, which sets its unlock to the
  // maximum from now; the merged lock is auto max only when the target is.
  const fromEnd = from.unlocksAt ?? unlockAt(now, maxLockSeconds(from.kind))
  const end =
    into === null || into.unlocksAt === null
      ? null
      : Math.max(into.unlocksAt, fromEnd)
  const rows = [
    {
      label: "New amount",
      value: `${formatToken(toDecimal(total, 18), token.symbol)} ${token.symbol}`,
    },
    {
      label: "Voting power",
      value: powerLabel(
        from.kind,
        votingPowerAt({ kind: from.kind, amount: total, now, end }),
      ),
    },
    { label: "Unlocks", value: end === null ? "Auto max" : formatDate(end) },
  ]

  async function prepare(context: PrepareContext): Promise<Review> {
    if (into === null) throw new Error("No lock to merge into")
    const [chainFrom, chainInto] = await Promise.all([
      lockState(context.config, from.kind, BigInt(from.tokenId)),
      lockState(context.config, into.kind, BigInt(into.tokenId)),
    ])
    const check = checkLock(chainFrom, from, "merge", context.account)
    const target = mergeTargetBlock(
      lockFacts(from.kind, BigInt(from.tokenId), chainFrom),
      lockFacts(into.kind, BigInt(into.tokenId), chainInto),
      chainFrom.now,
    )
    return {
      headline: {
        label: `Merge ${escrowLabel[from.kind]} #${from.tokenId}`,
        figure: (
          <>
            <TokenIcon ticker={token.symbol} size={36} />
            {formatToken(from.amount, token.symbol)} {token.symbol}
          </>
        ),
        sub: `Into #${into.tokenId}`,
      },
      rows,
      signRows: 1,
      steps: mergePlan({
        kind: from.kind,
        from: BigInt(from.tokenId),
        to: BigInt(into.tokenId),
        resetVoters: check.reset ? chainFrom.votedVoters : [],
        autoMaxOff: check.autoMaxOff,
      }),
      blocked:
        check.blocked ??
        (chainInto.owner.toLowerCase() !== context.account.toLowerCase()
          ? `#${into.tokenId} is not your lock`
          : target !== null
            ? `#${into.tokenId}: ${blockLabel(target)}`
            : unclaimed
              ? `Claim #${from.tokenId} rewards first`
              : null),
      done: { sub: `#${from.tokenId} merged into #${into.tokenId}`, rows },
    }
  }

  return (
    <TxSheet
      config={config}
      account={account}
      titles={{
        form: "Merge locks",
        review: "Review",
        sign: "Sign",
        done: "Locks merged",
      }}
      form={{
        cta: "Merge",
        ready: into !== null && sourceBlock === null && !unclaimed,
        content: (
          <ol className="flex flex-col gap-5">
            <BlockBanner block={sourceBlock} />
            {sourceBlock === null && unclaimed ? (
              <Notice
                label={`${formatUsd(from.claimableUsd, "cents")} unclaimed on #${from.tokenId}`}
                action={claimFirst(account, from)}
              />
            ) : null}
            <li>
              <p className="mb-2.5 text-[15px] text-sec">From</p>
              <MiniLock lock={from} />
            </li>
            <li>
              <fieldset>
                <legend className="mb-2.5 text-[15px] text-sec">Into</legend>
                {options.length === 0 ? (
                  <p className="text-[15px] text-sec">No other lock</p>
                ) : (
                  <ol className="flex flex-col gap-1 rounded-[20px] bg-soft p-1.5 dark:bg-soft2">
                    {options.map((option) => (
                      <IntoOption
                        key={option.key}
                        name={name}
                        value={option.key}
                        lock={option.lock}
                        block={option.block}
                        checked={option.key === intoKey}
                        onSelect={() => setPicked(option.key)}
                      />
                    ))}
                  </ol>
                )}
              </fieldset>
            </li>
            {into === null ? null : (
              <>
                <li>
                  <SummaryRows rows={rows} />
                </li>
                <li className="flex items-center gap-4">
                  <span className="grid size-12 flex-none place-items-center rounded-full bg-acc-soft text-acc-ink">
                    <Glyph
                      shape={shapes.circleAlert}
                      size={20}
                      strokeWidth={1.9}
                    />
                  </span>
                  <p className="text-base font-semibold">
                    #{from.tokenId} is burned
                  </p>
                </li>
                {source.ok && (source.reset || source.autoMaxOff) ? (
                  <li className="flex items-center gap-4">
                    <span className="grid size-12 flex-none place-items-center rounded-full bg-soft text-ink2 dark:bg-soft2">
                      <Glyph
                        shape={shapes.rotateCw}
                        size={20}
                        strokeWidth={1.8}
                      />
                    </span>
                    <p className="text-base font-semibold">
                      {mergeFirst(
                        from.tokenId,
                        source.reset,
                        source.autoMaxOff,
                      )}
                    </p>
                  </li>
                ) : null}
              </>
            )}
          </ol>
        ),
      }}
      prepare={prepare}
      reviewCta="Sign"
      success={{ toast: "Locks merged", refresh: [...refreshLocks] }}
    />
  )
}

/** The steps a merge adds before it: "Clears #2930 votes first". */
function mergeFirst(tokenId: string, reset: boolean, autoMaxOff: boolean) {
  if (reset && autoMaxOff) return `Clears #${tokenId} votes and auto max first`
  return reset
    ? `Clears #${tokenId} votes first`
    : `Turns off auto max on #${tokenId} first`
}

function IntoOption({
  name,
  value,
  lock,
  block,
  checked,
  onSelect,
}: {
  name: string
  value: string
  lock: Lock
  block: LockBlock | null
  checked: boolean
  onSelect: () => void
}): ReactNode {
  const symbol = lock.kind === "vebtc" ? "BTC" : "MEZO"
  const id = useId()
  const off = block !== null
  return (
    <li>
      <label
        className={`flex items-center gap-3 rounded-[16px] px-3 py-2.5 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ink ${
          off
            ? "cursor-not-allowed opacity-55"
            : checked
              ? "cursor-pointer bg-raised shadow-[inset_0_0_0_2px_var(--acc)]"
              : "cursor-pointer hover:bg-raised"
        }`}
      >
        <input
          type="radio"
          name={name}
          value={value}
          checked={checked}
          disabled={off}
          onChange={onSelect}
          aria-describedby={`${id}-meta`}
          className="sr-only"
        />
        <TokenIcon ticker={symbol} size={32} />
        <span className="min-w-0 flex-1">
          <span className="block text-base font-semibold">
            {escrowLabel[lock.kind]} #{lock.tokenId}
          </span>
          <span
            id={`${id}-meta`}
            className="block text-[14.5px] text-sec tabular-nums"
          >
            {formatToken(lock.amount, symbol)} {symbol},{" "}
            {lock.unlocksAt === null
              ? "auto max"
              : `unlocks ${formatDate(lock.unlocksAt)}`}
            {off ? (
              <span className="sr-only">, {blockLabel(block)}</span>
            ) : null}
          </span>
        </span>
        {off ? (
          <span
            aria-hidden="true"
            className="flex flex-none items-center gap-1.5 text-[14px] text-sec"
          >
            <Glyph shape={shapes.lock} size={14} strokeWidth={1.9} />
            {blockLabel(block)}
          </span>
        ) : null}
      </label>
    </li>
  )
}

function MiniLock({ lock }: { lock: Lock }): ReactNode {
  const symbol = lock.kind === "vebtc" ? "BTC" : "MEZO"
  return (
    <LockPreview
      compact
      kind={lock.kind}
      title={`${escrowLabel[lock.kind]} #${lock.tokenId}`}
      amount={`${formatToken(lock.amount, symbol)} ${symbol}`}
      rows={[
        {
          label: "Voting power",
          value: powerLabel(lock.kind, BigInt(lock.votingPowerWei)),
        },
      ]}
    />
  )
}

// ---------------------------------------------------------------------------
// Withdraw
// ---------------------------------------------------------------------------

export function WithdrawSheet({
  request,
  config,
  account,
}: Props<"withdraw">): ReactNode {
  const { lock } = request
  const token = lockToken[lock.kind]
  const price = usePrice(lock.kind)
  const amount = wei(lock.amount)
  const usd = usdValue(amount, 18, price)
  const claimable = wei(lock.claimableUsd) > 0n
  const block = useLockBlock({ config, account }, lock, "withdraw")
  const rows = [
    {
      label: "To",
      value: (
        <span className="font-mono text-[14px]">{shortAddress(account)}</span>
      ),
    },
    { label: "Voting power", value: "None" },
    {
      label: "Rewards",
      value: claimable
        ? `${formatUsd(lock.claimableUsd, "cents")} to claim`
        : "All claimed",
    },
  ]

  async function prepare(context: PrepareContext): Promise<Review> {
    const chain = await lockState(
      context.config,
      lock.kind,
      BigInt(lock.tokenId),
    )
    const check = checkLock(chain, lock, "withdraw", context.account)
    return {
      headline: {
        label: `Withdraw ${escrowLabel[lock.kind]} #${lock.tokenId}`,
        figure: (
          <>
            <TokenIcon ticker={token.symbol} size={36} />
            {formatToken(lock.amount, token.symbol)} {token.symbol}
          </>
        ),
        sub: usd === null ? undefined : formatUsd(usd, "cents"),
      },
      rows: [
        rows[0] ?? { label: "To", value: "" },
        { label: "Lock after", value: "Closed" },
      ],
      signRows: 1,
      steps: withdrawPlan({
        kind: lock.kind,
        tokenId: BigInt(lock.tokenId),
        resetVoters: check.reset ? chain.votedVoters : [],
      }),
      blocked: check.blocked,
      done: {
        sub: `${formatToken(lock.amount, token.symbol)} ${token.symbol} to your wallet`,
        rows: [rows[0] ?? { label: "To", value: "" }],
      },
    }
  }

  return (
    <TxSheet
      config={config}
      account={account}
      titles={{
        form: "Withdraw",
        review: "Review",
        sign: "Sign",
        done: "Withdrawn",
      }}
      form={{
        cta: "Review",
        ready: lock.expired && block === null,
        content: (
          <ol className="flex flex-col gap-6">
            <BlockBanner block={block} />
            <li>
              <LockPreview
                kind="expired"
                title={`${escrowLabel[lock.kind]} #${lock.tokenId}`}
                amount={`${formatToken(lock.amount, token.symbol)} ${token.symbol}`}
                rows={
                  lock.unlocksAt === null
                    ? []
                    : [{ label: "Expired", value: formatDay(lock.unlocksAt) }]
                }
              />
            </li>
            <li>
              <p className="text-[15px] text-sec">You receive</p>
              <p className="mt-1 flex items-center gap-2.5 text-[34px] font-[650] tracking-[-0.02em] tabular-nums">
                <TokenIcon ticker={token.symbol} size={32} />
                {formatToken(lock.amount, token.symbol)} {token.symbol}
              </p>
              {usd === null ? null : (
                <p className="mt-0.5 text-[15px] text-sec tabular-nums">
                  {formatUsd(usd, "cents")}
                </p>
              )}
            </li>
            <li>
              <SummaryRows rows={rows} />
            </li>
            <li className="text-center">
              <button
                type="button"
                onClick={() =>
                  openTx(
                    { kind: "connected", address: account },
                    { flow: "new-lock", kind: lock.kind },
                  )
                }
                className="cursor-pointer text-[15px] font-semibold underline underline-offset-[3px] outline-none focus-visible:outline-2 focus-visible:outline-ink"
              >
                Lock again
              </button>
            </li>
          </ol>
        ),
      }}
      prepare={prepare}
      reviewCta="Sign"
      success={{ toast: "Withdrawn", refresh: [...refreshLocks] }}
    />
  )
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

function DurationPicker({
  label,
  options,
  value,
  onValueChange,
  autoMax = false,
  disabledBefore,
}: {
  label: string
  options: readonly DurationChoice[]
  value: string
  onValueChange: (value: string) => void
  autoMax?: boolean
  /** Disables choices that would not move the unlock later. */
  disabledBefore?: { now: number; current: number | null }
}): ReactNode {
  return (
    <fieldset>
      <legend className="mb-2.5 text-[15px] text-sec">{label}</legend>
      <SegmentedControl.Root
        surface="sheet"
        size="sm"
        value={value}
        onValueChange={onValueChange}
      >
        {options.map((option) => (
          <SegmentedControl.Item
            key={option.id}
            value={option.id}
            disabled={
              disabledBefore !== undefined &&
              disabledBefore.current !== null &&
              unlockAt(disabledBefore.now, option.seconds) <=
                disabledBefore.current
            }
          >
            {option.label}
          </SegmentedControl.Item>
        ))}
        {autoMax ? (
          <SegmentedControl.Item value="auto">Auto max</SegmentedControl.Item>
        ) : null}
      </SegmentedControl.Root>
    </fieldset>
  )
}

function SummaryRows({
  rows,
}: {
  rows: readonly { label: string; value: ReactNode }[]
}): ReactNode {
  return (
    <dl className="flex flex-col tabular-nums">
      {rows.map((row) => (
        <div
          key={row.label}
          className="flex items-center justify-between gap-4 py-2 text-[15.5px]"
        >
          <dt className="text-sec">{row.label}</dt>
          <dd className="text-right font-semibold">{row.value}</dd>
        </div>
      ))}
    </dl>
  )
}
