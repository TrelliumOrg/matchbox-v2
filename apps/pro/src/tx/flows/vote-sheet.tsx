import * as GaugeCard from "@matchbox/ui/gauge-card"
import type { ReactNode } from "react"
import { Usd } from "../../components/money"
import type { Lock } from "../../data/view-models"
import { escrowUnit, gaugeKinds } from "../../features/gauge/kinds"
import {
  microToUsd,
  perLock,
  powerOf,
  replacesLine,
  standingVotes,
  voteWeight,
} from "../../features/vote/ballot"
import {
  changeLine,
  clearSaved,
  savedFrom,
  storeSaved,
} from "../../features/vote/saved-ballots"
import { noteSignedVote, voteDeltas } from "../../features/vote/signed-votes"
import { formatShare, formatVoteAmount } from "../../lib/format"
import { gaugeName } from "../../lib/gauge-name"
import { type PlanStep, voteGroups, votePlan, votersFor } from "../plans"
import { voteState } from "../reads"
import { type PrepareContext, type Review, TxSheet } from "../tx-sheet"
import type { TxRequest } from "../tx-store"
import { voteBlock, voteBlockCopy } from "../vote-window"

type VoteRequest = Extract<TxRequest, { flow: "vote" }>

const escrowLabel = { vebtc: "veBTC", vemezo: "veMEZO" } as const

/** "veMEZO #2930, #3011" */
export function locksLabel(locks: readonly Lock[]): string {
  const first = locks[0]
  if (first === undefined) return ""
  return `${escrowLabel[first.kind]} ${locks.map((lock) => `#${lock.tokenId}`).join(", ")}`
}

/**
 * Every lock votes the same split: one vote() per lock and voter, in lock
 * order. Step ids carry the lock ("lock-3011:vote-boost") so a failure on
 * one lock leaves the others signed and the retry resumes there.
 */
export function multiLockVotePlan(
  locks: readonly { tokenId: string }[],
  groups: Parameters<typeof votePlan>[1],
): PlanStep[] {
  return locks.flatMap((lock) =>
    votePlan(BigInt(lock.tokenId), groups).map((step) => ({
      ...step,
      id: `lock-${lock.tokenId}:${step.id}`,
    })),
  )
}

/** "Try lock #3011 again", from the step id ("lock-3011:vote-boost"). */
export function lockRetryLabel(step: { id: string }, index: number): string {
  const lock = /^lock-(\d+):/.exec(step.id)?.[1]
  return lock === undefined
    ? `Try step ${index + 1} again`
    : `Try lock #${lock} again`
}

/**
 * Review vote (`xFq24xVEdT`): the projection, each pick with its share and
 * votes, then one signature per lock and voter. Checked against the voting
 * window, one vote per lock per epoch, and the whitelisted last hour before
 * the wallet opens.
 *
 * Picked locks that voted this epoch cannot vote again until the next one
 * (every voter reverts AlreadyVotedOrDeposited), so their split is saved in
 * this browser for the next epoch instead: on its own ("Save for Epoch 48",
 * nothing to sign) or once the other locks have signed. It is never signed
 * for them later; Vote offers it again when the epoch opens.
 */
export function VoteSheet({
  request,
  config,
  account,
}: PrepareContext & { request: VoteRequest }): ReactNode {
  const { locks, picks, saveLocks } = request
  const first = locks[0] ?? saveLocks[0]
  const unit = first === undefined ? "veMEZO" : escrowUnit[first.kind]
  const saveOnly = locks.length === 0
  const nextEpoch = request.epoch + 1
  const power = powerOf(saveOnly ? saveLocks : locks)
  const live = picks.filter((pick) => pick.bps > 0)
  // The projection covers every picked lock; this epoch only the signing
  // locks earn it.
  const shares = perLock(request.projectedMicro, [...locks, ...saveLocks])
  const signedMicro = locks.reduce(
    (sum, lock) => sum + (shares.get(lock.tokenId) ?? 0n),
    0n,
  )
  const opens = changeLine(request.epochEndsAt)
  const saved = () =>
    savedFrom(
      new Map(live.map((pick) => [pick.gauge.address.toLowerCase(), pick.bps])),
      request.epoch,
      Math.floor(Date.now() / 1_000),
    )
  const saveVoted = () => {
    for (const lock of saveLocks) {
      storeSaved(request.wallet, lock, request.kind, saved())
    }
  }

  async function prepare(context: PrepareContext): Promise<Review> {
    const allowed = new Set(first === undefined ? [] : votersFor(first.kind))
    const stray = live.find((pick) => !allowed.has(pick.gauge.voter))
    const voters = [...new Set(live.map((pick) => pick.gauge.voter))]
    const picksBody = (
      <ul className="mt-6 flex flex-col gap-4">
        {live.map((pick) => {
          const id = pick.gauge.address.toLowerCase()
          return (
            <li key={id} className="flex items-center gap-4">
              <GaugeCard.Picture picture={pick.gauge.picture} size={48} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-semibold">
                  {gaugeName(pick.gauge)}
                </p>
                <p className="text-[14.5px] text-sec tabular-nums">
                  {saveOnly
                    ? `Epoch ${nextEpoch}`
                    : `$${microToUsd(request.perGaugeMicro.get(id) ?? 0n)}`}
                </p>
              </div>
              <div className="text-right tabular-nums">
                <p className="text-base font-semibold">
                  {formatShare(pick.bps)}
                </p>
                <p className="text-[14.5px] text-sec">
                  {formatVoteAmount(voteWeight(power, pick.bps), unit)}
                </p>
              </div>
            </li>
          )
        })}
      </ul>
    )
    const savedLabel = locksLabel(saveLocks)
    // Each gauge type has its own voter: this vote leaves the other alone.
    const kept =
      request.keeps === null
        ? []
        : [
            {
              label: `Votes on ${gaugeKinds[request.keeps].label}`,
              value: "Unchanged",
            },
          ]
    // A vote clears the signing locks' earlier votes of this type: say
    // which gauges those are, before the wallet opens.
    const standing = replacesLine(standingVotes(locks, request.kind))
    const replaces =
      standing === null ? [] : [{ label: "Replaces", value: standing }]
    if (saveOnly) {
      // Nothing to sign: the review saves the split for the next epoch.
      return {
        headline: {
          label: `Saved for Epoch ${nextEpoch}`,
          figure: formatVoteAmount(power, unit),
          sub: opens,
        },
        body: picksBody,
        rows: [
          {
            label: saveLocks.length > 1 ? "Locks" : "Lock",
            value: savedLabel,
          },
          { label: "Signature", value: `In Epoch ${nextEpoch}` },
          ...kept,
        ],
        steps: [],
        blocked:
          stray !== undefined
            ? `${gaugeName(stray.gauge)} takes ${first?.kind === "vemezo" ? "veBTC" : "veMEZO"} votes`
            : null,
        done: {
          sub: opens,
          rows: [
            ...live.map((pick) => ({
              label: gaugeName(pick.gauge),
              value: formatShare(pick.bps),
            })),
            {
              label: saveLocks.length > 1 ? "Locks" : "Lock",
              value: savedLabel,
            },
          ],
        },
      }
    }
    const states = await Promise.all(
      locks.map((lock) =>
        voteState(context.config, {
          tokenId: BigInt(lock.tokenId),
          voters,
          poolGauges: live
            .filter((pick) => pick.gauge.voter === "pools")
            .map((pick) => pick.gauge.address),
        }),
      ),
    )
    const state = states[0]
    const blocks = states.map((each) =>
      voteBlock({
        now: each.now,
        lastVoted: each.lastVoted,
        whitelisted: each.whitelisted,
      }),
    )
    const blockedAt = blocks.findIndex((block) => block !== null)
    const block = blockedAt < 0 ? null : blocks[blockedAt]
    const steps =
      state === undefined
        ? []
        : multiLockVotePlan(
            locks,
            voteGroups(
              live.map((pick) => ({
                gauge: pick.gauge.address,
                voter: pick.gauge.voter,
                bps: pick.bps,
              })),
              state.poolOf,
            ),
          )
    const projected = microToUsd(
      saveLocks.length > 0 ? signedMicro : request.projectedMicro,
    )
    const label = locksLabel(locks)
    return {
      headline: {
        label: "Projected",
        figure: <Usd value={projected} style="cents" />,
        sub: formatVoteAmount(power, unit),
      },
      body: picksBody,
      rows: [
        { label: locks.length > 1 ? "From locks" : "From lock", value: label },
        // Mixed: the voted locks save the same split, said plainly.
        ...(saveLocks.length > 0
          ? [
              {
                label: `Saved for Epoch ${nextEpoch}`,
                value: saveLocks.map((lock) => `#${lock.tokenId}`).join(", "),
              },
              { label: "Voted this epoch", value: opens },
            ]
          : []),
        ...(locks.length > 1
          ? locks.map((lock) => ({
              label: `#${lock.tokenId}`,
              value: `${formatVoteAmount(lock.votingPowerWei, unit)}, $${microToUsd(shares.get(lock.tokenId) ?? 0n)}`,
            }))
          : [
              {
                label: "Voting power",
                value: formatVoteAmount(power, unit),
              },
            ]),
        ...replaces,
        ...kept,
      ],
      signRows: locks.length > 1 ? locks.length + 1 : 1,
      steps,
      blocked:
        stray !== undefined
          ? `${gaugeName(stray.gauge)} takes ${first?.kind === "vemezo" ? "veBTC" : "veMEZO"} votes`
          : block === null || block === undefined
            ? null
            : locks.length > 1 && block === "voted-this-epoch"
              ? `#${locks[blockedAt]?.tokenId} voted this epoch`
              : voteBlockCopy[block],
      done: {
        sub: (
          <>
            Projected <b className="font-semibold text-ink">${projected}</b>
          </>
        ),
        rows: [
          ...live.map((pick) => ({
            label: gaugeName(pick.gauge),
            value: formatShare(pick.bps),
          })),
          {
            label: locks.length > 1 ? "From locks" : "From lock",
            value: label,
          },
          ...(saveLocks.length > 0
            ? [
                {
                  label: `Saved for Epoch ${nextEpoch}`,
                  value: saveLocks.map((lock) => `#${lock.tokenId}`).join(", "),
                },
              ]
            : []),
        ],
      },
    }
  }

  return (
    <TxSheet
      config={config}
      account={account}
      titles={
        saveOnly
          ? { review: "Review changes", sign: "Save", done: "Changes saved" }
          : { review: "Review vote", sign: "Sign vote", done: "Vote submitted" }
      }
      prepare={prepare}
      // Several locks: a failure names the lock to retry ("Try lock #3011 again").
      {...(locks.length > 1 ? { retryLabel: lockRetryLabel } : {})}
      {...(saveOnly ? { commit: saveVoted } : {})}
      onSigned={(block) => {
        // The signed locks spent any saved split; the voted ones save theirs.
        for (const lock of locks) clearSaved(request.wallet, lock, request.kind)
        saveVoted()
        // Vote keeps showing this vote until the gauge directory has it.
        if (block !== null) {
          noteSignedVote({
            wallet: request.wallet,
            block,
            deltas: voteDeltas(
              locks,
              request.kind,
              live.map((pick) => ({
                address: pick.gauge.address,
                bps: pick.bps,
              })),
            ),
          })
        }
      }}
      reviewCta={
        saveOnly
          ? `Save for Epoch ${nextEpoch}`
          : locks.length > 1
            ? `Review and sign, ${locks.length} signatures`
            : "Sign and vote"
      }
      success={{
        toast: "Vote confirmed",
        refresh: ["voter", "overview", "gauges", "gauge", "activity", "home"],
      }}
    />
  )
}
