import { MorphText } from "@matchbox/motion"
import { TokenIcon } from "@matchbox/token-icons"
import * as PillButton from "@matchbox/ui/pill-button"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { AllocationRows, claimSource, ProjectedLine } from "./blocks"
import type {
  AllocationDiffBlock,
  CallStatus,
  ClaimRow,
  Proposal,
  ProposalRefreshResponse,
} from "./contract"
import {
  formatBlock,
  formatShare,
  formatToken,
  formatUsd,
  signatures,
} from "./format"
import { GaugeMark } from "./gauge-mark"
import { EntityLink, useHost } from "./host"
import { Glyph } from "./icons"
import { downloadSafeBatch, safeBatch } from "./safe-export"
import { initialCallStatus, refreshProposal, signWith } from "./signing"
import type { StuartSignOutcome } from "./store"

/**
 * A prepared transaction inside a reply (frames XuFyxNZnjN, mESEW_GbVT).
 * "Review and sign" refreshes the proposal first; a material change shows
 * the difference and waits for acknowledgement; then the host's signer
 * takes over and the card shows what the wallet reports, call by call.
 * Without a signer the card links to the Pro page that does the job.
 */

type CardState =
  | { kind: "idle" }
  | { kind: "refreshing" }
  | { kind: "material"; refresh: ProposalRefreshResponse }
  | { kind: "signing"; status: CallStatus }
  | {
      kind: "done"
      outcome: StuartSignOutcome
      status: CallStatus
      hashes: string[]
    }
  | { kind: "failed"; message: string }

const blockedLabel: Record<NonNullable<Proposal["blockedReason"]>, string> = {
  connect_this_wallet: "Connect this wallet to sign",
  insufficient_balance: "Insufficient balance",
  simulation_reverted: "Simulation reverted",
  price_impact_too_high: "Price impact too high",
  oracle_stale: "Price feed stale",
  exceeds_max_repay: "Above the maximum repayment",
  trove_not_active: "Loan not active",
  voting_window_closed: "Voting closed for this epoch",
  already_voted_this_epoch: "Already voted this epoch",
  nothing_to_claim: "Nothing to claim",
  lock_vesting: "Vesting lock",
  lock_managed: "Managed lock",
  lock_expired: "Lock expired",
  lock_not_expired: "Not expired yet",
  lock_auto_max: "Auto max lock",
  lock_voted_this_epoch: "Voted this epoch, reset first",
  different_escrows: "veBTC and veMEZO never merge",
  distribute_window: "Votes paused 00:00 to 01:00 UTC",
  lock_not_owned: "Not your lock",
}

const callWord: Record<CallStatus["calls"][number]["status"], string> = {
  not_sent: "Waiting",
  awaiting_wallet: "Confirm in your wallet",
  submitted: "Signed",
  mined: "Confirmed",
  reverted: "Reverted",
  rejected: "Signature rejected",
}

const outcomeWord: Record<StuartSignOutcome, string> = {
  success: "Confirmed",
  partial: "Partly confirmed",
  failed: "Failed",
  rejected: "Signature rejected",
}

/** "#2930" for one lock, "3 locks" for several. */
function locksOf(rows: readonly ClaimRow[]): string {
  const ids = [
    ...new Set(
      rows.flatMap((row) => (row.tokenId === null ? [] : [row.tokenId])),
    ),
  ]
  const first = ids[0]
  if (ids.length === 1 && first !== undefined) return `#${first}`
  return `${ids.length} locks`
}

const lockTitle: Record<
  Extract<Proposal["content"], { kind: "lock" }>["action"],
  string
> = {
  add: "Add to",
  extend: "Extend",
  auto_max: "Auto max",
  withdraw: "Withdraw",
  merge: "Merge",
  transfer: "Transfer",
}

export function titleOf(proposal: Proposal): string {
  const content = proposal.content
  switch (content.kind) {
    case "vote": {
      const selected = content.ballots.filter((ballot) => ballot.selected)
      const first = selected[0]
      return selected.length === 1 && first !== undefined
        ? `Vote, #${first.tokenId}`
        : `Vote, ${selected.length} locks`
    }
    case "claim":
      return `Claim, ${locksOf(content.rows)}`
    case "claim_relock":
      return `Claim and relock into #${content.relockTokenId}`
    case "lock":
      if (content.action === "merge" && content.intoTokenId !== null) {
        return `Merge #${content.tokenId} into #${content.intoTokenId}`
      }
      if (content.action === "transfer") {
        return `Transfer ${content.escrow} #${content.tokenId}`
      }
      if (content.action === "add") return `Add to #${content.tokenId}`
      return `${lockTitle[content.action]}, #${content.tokenId}`
    case "repay":
      return "Repay"
    case "zap":
      return "Zap"
    case "earn_deposit":
      return "Deposit"
    case "claim_surplus":
      return "Claim surplus"
  }
}

const veMezoSources = new Set(["boost_bribes", "mezo_bribes"])

/** The epoch a claim's rewards run through, when the server sent it. */
function epochOf(proposal: Proposal): number | null {
  const content = proposal.content
  if (content.kind === "claim" || content.kind === "claim_relock") {
    return content.epoch ?? null
  }
  return null
}

export function tabOf(proposal: Proposal): {
  tone: "mezo" | "btc" | "plain"
  ticker: string | null
} {
  const mezo = { tone: "mezo", ticker: "MEZO" } as const
  const btc = { tone: "btc", ticker: "BTC" } as const
  const content = proposal.content
  switch (content.kind) {
    case "vote":
      return content.ballots[0]?.governanceAsset === "veBTC" ? btc : mezo
    case "claim":
      return content.rows.every((row) => veMezoSources.has(row.source))
        ? mezo
        : content.rows.every((row) => !veMezoSources.has(row.source))
          ? btc
          : { tone: "plain", ticker: null }
    case "claim_relock":
      return mezo
    case "lock":
      return content.escrow === "veBTC" ? btc : mezo
    default:
      return { tone: "plain", ticker: null }
  }
}

function proPage(proposal: Proposal): { to: string; label: string } | null {
  if (proposal.kind === "vote") return { to: "/vote", label: "Edit in Vote" }
  if (proposal.kind === "claim" || proposal.kind === "claim_relock")
    return { to: "/rewards", label: "Open Rewards" }
  if (proposal.kind === "lock") return { to: "/", label: "Open locks" }
  return null
}

function gasTotal(proposal: Proposal): string | null {
  let total = 0n
  for (const call of proposal.simulation.calls) {
    if (call.gasEstimate === null) return null
    total += BigInt(call.gasEstimate)
  }
  return total === 0n ? null : `${formatBlock(total.toString())} gas`
}

function Allocations({
  proposal,
  diff,
}: {
  proposal: Proposal
  diff: AllocationDiffBlock | null
}): ReactNode {
  if (proposal.content.kind !== "vote") return null
  if (diff !== null) return <AllocationRows rows={diff.rows} />
  return (
    <ul className="stuart-alloc">
      {proposal.content.ballots
        .filter((ballot) => ballot.selected)
        .flatMap((ballot) =>
          ballot.allocations.map((allocation) => (
            <li key={`${ballot.ballotKey}:${allocation.targetId}`}>
              <GaugeMark
                picture={null}
                address={allocation.targetAddress}
                name={allocation.name}
                size={26}
              />
              <EntityLink
                to={`/gauges/${allocation.targetAddress}`}
                className="stuart-alloc-name"
              >
                {allocation.name}
              </EntityLink>
              <b className="stuart-alloc-change">
                {formatShare(allocation.bps)}
              </b>
            </li>
          )),
        )}
    </ul>
  )
}

/** Per lock and source: "Boost incentives, #2930" and the amounts. */
function ClaimRows({ rows }: { rows: readonly ClaimRow[] }): ReactNode {
  return (
    <ul className="stuart-alloc">
      {rows.map((row) => (
        <li key={row.rowKey}>
          <span className="stuart-alloc-name">
            {claimSource[row.source]}
            {row.tokenId === null ? null : (
              <span className="stuart-unit"> #{row.tokenId}</span>
            )}
          </span>
          <b className="stuart-alloc-change">
            {row.rewards.map((reward) => formatToken(reward.amount)).join(", ")}
          </b>
        </li>
      ))}
    </ul>
  )
}

function Headline({
  label,
  value,
  sub,
}: {
  label: string
  value: string
  sub?: string | null
}): ReactNode {
  return (
    <p className="stuart-projected">
      <span className="stuart-figure-label">{label}</span>
      <span className="stuart-projected-row">
        <b>{value}</b>
        {sub === null || sub === undefined ? null : <span>{sub}</span>}
      </span>
    </p>
  )
}

function lockHeadline(
  content: Extract<Proposal["content"], { kind: "lock" }>,
): ReactNode {
  switch (content.action) {
    case "add":
      return (
        <Headline
          label="Add"
          value={content.amount === null ? "" : formatToken(content.amount)}
        />
      )
    case "withdraw":
      return (
        <Headline
          label="Back to your wallet"
          value={content.amount === null ? "" : formatToken(content.amount)}
        />
      )
    case "transfer":
      return (
        <Headline
          label="To"
          value={
            content.recipient === null ? "" : shortAddress(content.recipient)
          }
          sub={content.amount === null ? null : formatToken(content.amount)}
        />
      )
    case "merge":
      return (
        <Headline
          label="Merged lock"
          value={`#${content.intoTokenId ?? ""}`}
          sub={content.amount === null ? null : formatToken(content.amount)}
        />
      )
    case "extend":
    case "auto_max":
      return (
        <Headline
          label="Unlocks"
          value={
            content.unlocksAt === null
              ? "Auto max"
              : new Date(content.unlocksAt * 1000).toLocaleDateString("en-GB", {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                  timeZone: "UTC",
                })
          }
        />
      )
  }
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

/** Plain-word steps, one per signature (matchbox-v3 Signing). */
function Steps({ proposal }: { proposal: Proposal }): ReactNode {
  const calls = [...proposal.calls].sort((a, b) => a.index - b.index)
  if (calls.length === 0) return null
  return (
    <ol className="stuart-tx-steps" aria-label="Steps">
      {calls.map((call, position) => (
        <li key={call.index}>
          <span className="stuart-tx-step-index" aria-hidden="true">
            {position + 1}
          </span>
          <span>
            <b>{call.label.replace(/^\d+\s*[.\u00b7]\s*/, "")}</b>
            {call.detail === undefined ? null : <span>{call.detail}</span>}
          </span>
        </li>
      ))}
    </ol>
  )
}

function Summary({ proposal }: { proposal: Proposal }): ReactNode {
  const content = proposal.content
  switch (content.kind) {
    case "vote":
      return null
    case "claim":
      return (
        <>
          <Headline
            label="Claimable"
            value={
              content.totalUsd === null
                ? "Unpriced"
                : formatUsd(content.totalUsd)
            }
          />
          <ClaimRows rows={content.rows} />
        </>
      )
    case "claim_relock":
      return (
        <>
          <Headline
            label="Claim and relock"
            value={
              content.totalUsd === null
                ? "Unpriced"
                : formatUsd(content.totalUsd)
            }
            sub={`${formatToken(content.relockAmount)} into #${content.relockTokenId}`}
          />
          <ClaimRows rows={content.rows} />
        </>
      )
    case "lock":
      return lockHeadline(content)
    case "repay":
      return (
        <p className="stuart-projected">
          <span className="stuart-figure-label">Repay</span>
          <span className="stuart-projected-row">
            <b>{formatToken(content.amount)}</b>
            <span>debt {formatToken(content.debtAfter)} after</span>
          </span>
        </p>
      )
    case "zap":
      return (
        <p className="stuart-projected">
          <span className="stuart-figure-label">Deposit</span>
          <span className="stuart-projected-row">
            <b>{formatToken(content.depositAmount)}</b>
          </span>
        </p>
      )
    case "earn_deposit":
    case "claim_surplus":
      return (
        <p className="stuart-projected">
          <span className="stuart-figure-label">Amount</span>
          <span className="stuart-projected-row">
            <b>{formatToken(content.amount)}</b>
          </span>
        </p>
      )
  }
}

function CallList({ status }: { status: CallStatus }): ReactNode {
  const host = useHost()
  return (
    <ol className="stuart-calls">
      {status.calls.map((call) => (
        <li key={call.index}>
          <span className="stuart-call-label">{call.label}</span>
          <MorphText
            as="span"
            className={
              call.status === "reverted" || call.status === "rejected"
                ? "stuart-neg"
                : call.status === "mined"
                  ? "stuart-pos"
                  : "stuart-acc-ink"
            }
          >
            {callWord[call.status]}
          </MorphText>
          {call.hash === null ? null : (
            <a
              className="stuart-link"
              href={`${host.scanUrl}/tx/${call.hash}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              View on Matchscan
            </a>
          )}
        </li>
      ))}
    </ol>
  )
}

export function ProposalCard({
  proposal,
  diff,
}: {
  proposal: Proposal
  diff: AllocationDiffBlock | null
}): ReactNode {
  const host = useHost()
  const [state, setState] = useState<CardState>({ kind: "idle" })
  const controller = useRef<AbortController | null>(null)
  const title = titleOf(proposal)
  const tab = tabOf(proposal)
  const page = proPage(proposal)
  const gas = gasTotal(proposal)
  const canSign =
    proposal.canSign && host.signer !== null && host.wallet !== null
  const multisig = host.signing.mode === "multisig"
  const exportable =
    proposal.calls.length > 0 && proposal.simulation.status !== "blocked"
  function exportForSafe(): void {
    downloadSafeBatch(
      safeBatch({
        proposal,
        name: title,
        createdAt: Date.now(),
        safe: host.signing.mode === "multisig" ? host.signing.safe : null,
      }),
      proposal.proposalId,
    )
  }
  const signLabel =
    proposal.calls.length > 1
      ? `Review and sign, ${signatures(proposal.calls.length)}`
      : "Review and sign"

  useEffect(() => () => controller.current?.abort(), [])

  async function sign(fresh: Proposal, signal: AbortSignal): Promise<void> {
    const signer = host.signer
    if (signer === null) return
    let latest = initialCallStatus(fresh)
    setState({ kind: "signing", status: latest })
    const result = await signWith(
      signer,
      fresh,
      (status) => {
        latest = status
        if (!signal.aborted) setState({ kind: "signing", status })
      },
      signal,
    )
    if (!signal.aborted) {
      setState({
        kind: "done",
        outcome: result.outcome,
        status: latest,
        hashes: result.hashes,
      })
    }
  }

  async function review(): Promise<void> {
    if (host.wallet === null) return
    controller.current?.abort()
    const next = new AbortController()
    controller.current = next
    setState({ kind: "refreshing" })
    const result = await refreshProposal({
      endpoint: host.endpoint,
      proposal,
      wallet: { address: host.wallet.address, mode: host.wallet.mode },
      signal: next.signal,
    })
    if (next.signal.aborted) return
    if (result.kind === "failed") {
      setState({ kind: "failed", message: result.message })
      return
    }
    if (result.kind === "material") {
      setState({ kind: "material", refresh: result.refresh })
      return
    }
    await sign(result.proposal, next.signal)
  }

  async function acknowledge(refresh: ProposalRefreshResponse): Promise<void> {
    const next = new AbortController()
    controller.current?.abort()
    controller.current = next
    await sign(refresh.proposal, next.signal)
  }

  function cancel(): void {
    controller.current?.abort()
    setState({ kind: "idle" })
  }

  const simulated = proposal.simulation.status === "passed"

  return (
    <section className="stuart-tx" aria-label={title}>
      <header className={`stuart-tx-tab stuart-tx-${tab.tone}`}>
        <span>{title}</span>
        {tab.ticker === null ? null : (
          <TokenIcon ticker={tab.ticker} size={20} className="stuart-tx-coin" />
        )}
        {epochOf(proposal) === null ? null : (
          <span className="stuart-tx-epoch">Epoch {epochOf(proposal)}</span>
        )}
      </header>
      <div className="stuart-tx-body">
        {proposal.content.kind === "vote" ? (
          <ProjectedLine
            before={diff?.beforeProjectedUsd ?? null}
            after={diff?.afterProjectedUsd ?? proposal.content.projectedUsd}
          />
        ) : (
          <Summary proposal={proposal} />
        )}
        <Allocations proposal={proposal} diff={diff} />
        <Steps proposal={proposal} />
        <p className={`stuart-sim ${simulated ? "stuart-pos" : "stuart-neg"}`}>
          <Glyph name={simulated ? "shield-check" : "alert"} size={17} />
          <span>
            {simulated ? "Simulation passed" : "Simulation not passed"}
          </span>
          <span className="stuart-sim-block">
            Block {formatBlock(proposal.snapshotBlock)}
          </span>
        </p>
        <dl className="stuart-kv">
          <div>
            <dt>Network fee, {signatures(proposal.calls.length)}</dt>
            <dd>{gas ?? "In wallet"}</dd>
          </div>
        </dl>

        {state.kind === "material" ? (
          <fieldset className="stuart-material">
            <legend className="stuart-card-title">
              Changed at block{" "}
              {formatBlock(state.refresh.proposal.snapshotBlock)}
            </legend>
            {state.refresh.diff === null ? (
              <dl className="stuart-kv">
                {state.refresh.changes.map((change) => (
                  <div key={change.key}>
                    <dt>{change.label}</dt>
                    <dd>
                      {change.before} to <b>{change.after}</b>
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <>
                <ProjectedLine
                  before={state.refresh.diff.beforeProjectedUsd}
                  after={state.refresh.diff.afterProjectedUsd}
                />
                <AllocationRows rows={state.refresh.diff.rows} />
              </>
            )}
          </fieldset>
        ) : null}

        {state.kind === "signing" || state.kind === "done" ? (
          <div role="status" aria-live="polite">
            <CallList status={state.status} />
            {state.kind === "done" ? (
              <p
                className={`stuart-outcome ${state.outcome === "success" ? "stuart-pos" : "stuart-neg"}`}
              >
                {outcomeWord[state.outcome]}
              </p>
            ) : null}
          </div>
        ) : null}

        {state.kind === "failed" ? (
          <p className="stuart-outcome stuart-neg" role="status">
            {state.message}
          </p>
        ) : null}

        {!proposal.canSign && proposal.blockedReason !== null ? (
          <p className="stuart-blocked">
            {blockedLabel[proposal.blockedReason]}
          </p>
        ) : null}

        <div className="stuart-ctas">
          {multisig && exportable && state.kind === "idle" ? (
            <PillButton.Root onClick={exportForSafe}>
              Export for Safe
            </PillButton.Root>
          ) : null}
          {canSign && state.kind === "idle" ? (
            multisig ? (
              <button
                type="button"
                className="stuart-link"
                onClick={() => void review()}
              >
                {signLabel}
              </button>
            ) : (
              <PillButton.Root onClick={() => void review()}>
                {signLabel}
              </PillButton.Root>
            )
          ) : null}
          {canSign && state.kind === "refreshing" ? (
            <PillButton.Root pending>{signLabel}</PillButton.Root>
          ) : null}
          {!multisig && exportable && state.kind === "idle" ? (
            <button
              type="button"
              className="stuart-link"
              onClick={exportForSafe}
            >
              Export for Safe
            </button>
          ) : null}
          {state.kind === "material" ? (
            <PillButton.Root onClick={() => void acknowledge(state.refresh)}>
              Acknowledge new optimum
            </PillButton.Root>
          ) : null}
          {state.kind === "signing" ? (
            <PillButton.Root pending>Waiting for wallet</PillButton.Root>
          ) : null}
          {canSign &&
          ((state.kind === "done" && state.outcome !== "success") ||
            state.kind === "failed") ? (
            <PillButton.Root onClick={() => void review()}>
              Try again
            </PillButton.Root>
          ) : null}
          {state.kind === "material" ? (
            <button type="button" className="stuart-link" onClick={cancel}>
              Cancel
            </button>
          ) : null}
          {page === null ? null : canSign ? (
            <EntityLink to={page.to} className="stuart-link">
              {page.label}
            </EntityLink>
          ) : (
            <PillButton.Root asChild intent="secondary">
              <EntityLink to={page.to}>{page.label}</EntityLink>
            </PillButton.Root>
          )}
        </div>
      </div>
    </section>
  )
}

ProposalCard.displayName = "Stuart.ProposalCard"
