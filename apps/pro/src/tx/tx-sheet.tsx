import { fireHaptic, preloadHaptics } from "@matchbox/motion/haptics"
import { Glyph, shapes } from "@matchbox/ui/icons"
import * as PillButton from "@matchbox/ui/pill-button"
import * as Sheet from "@matchbox/ui/sheet"
import * as SigningSteps from "@matchbox/ui/signing-steps"
import { Link } from "@tanstack/react-router"
import { type Config, estimateGas, getAccount, getGasPrice } from "@wagmi/core"
import { type ReactNode, useEffect, useRef, useState } from "react"
import type { Address, TransactionReceipt } from "viem"
import { Loading } from "../components/loading"
import { shortAddress } from "../lib/format"
import { useLive } from "../live/live-context"
import type { SafeReview, SafeSubmitted } from "../safe/flow"
import {
  isSafeRoute,
  type SafeRoute,
  type SigningRoute,
  signingRoute,
} from "../safe/route"
import type { ProposalStatus } from "../safe/service"
import { txBuilderOpenUrl } from "../safe/urls"
import { getSettings, useSettings } from "../settings/settings-store"
import { mezoChainId } from "../wallet/wallet-runtime"
import { isUserRejection } from "../wallet/wallets"
import { feeLabel } from "./amounts"
import { failureCopy, rejectedCopy } from "./errors"
import { noteSettled, noteSubmitted } from "./own-txs"
import type { PlanStep } from "./plans"
import { type RefreshTarget, refreshAfterBlock } from "./refresh"
import { runPlan, simulate } from "./runner"
import {
  applyStepEvent,
  buttonLabel,
  retryLabel as defaultRetryLabel,
  failedOnChainCopy,
  failedStep,
  nextStepIndex,
  retryFrom,
  type SigningStep,
  scanTxUrl,
  signingPhase,
  startSigning,
  stepDetail,
  stepLink,
} from "./steps"
import { showToast } from "./toasts"
import { closeTx, useTx } from "./tx-store"

/**
 * Every transaction sheet: an optional form, the review (what the wallet
 * will show, one numbered row per signature with a plain-words subtitle,
 * simulated first), signing (labels morph from "Confirm in your wallet" to
 * "Signed"), failures ("Signature rejected" with Try again, or "Failed on
 * chain" with the reason, a Matchscan link and "Try step 3 again"), and the
 * done face. Frames: Review vote `xFq24xVEdT`, Signing `tWxE5ZYSSC`, Vote
 * submitted `NAwSZ9qYNE`, lock sheets `bFRmKIn4eA`, failure and multisig
 * `yMC5qM2D0S`.
 *
 * Safe: with the Multisig setting and a Safe saved, the primary is "Propose
 * to Safe": the whole plan as one batch, simulated as the Safe, signed once
 * by the connected owner (no gas) and queued on Mezo's Transaction Service,
 * then "Continue to Safe". Inside Safe{Wallet} (as a Safe App or over
 * WalletConnect) the same batch goes to Safe{Wallet} directly. Every review
 * also offers "Export for Safe" (Transaction Builder JSON).
 */

export type Row = { label: string; value: ReactNode }

export type Review = {
  headline: { label: string; figure: ReactNode; sub?: ReactNode }
  /** Between the headline and the rows: gauges, tokens, a preview card. */
  body?: ReactNode
  rows: Row[]
  /** Rows that stay visible while signing (the first n). */
  signRows?: number
  steps: PlanStep[]
  /** Why the plan cannot run now, checked before the wallet opens. */
  blocked: string | null
  done: { sub?: ReactNode; rows: Row[] }
}

export type PrepareContext = { config: Config; account: Address }

/**
 * Thrown by `prepare` to stop before the review with a message, rows to
 * check and a button that reviews again: a recipient whose Mezo ID now
 * points elsewhere, or a lookup that failed. Nothing can be signed until
 * a review passes.
 */
export class ReviewStop extends Error {
  readonly action: string
  readonly rows: Row[]
  constructor(message: string, action = "Try again", rows: Row[] = []) {
    super(message)
    this.name = "ReviewStop"
    this.action = action
    this.rows = rows
  }
}

export type TxSheetProps = {
  config: Config
  account: Address
  titles: { form?: string; review: string; sign: string; done: string }
  form?: { content: ReactNode; cta: string; ready: boolean }
  prepare: (context: PrepareContext) => Promise<Review>
  reviewCta: string
  success: { toast: string; refresh: RefreshTarget[] }
  /** Changing it re-runs the review (a toggle inside it changed the plan). */
  revision?: string
  /** Names the Safe export ("vote-2026-11-09.json"); the open flow by default. */
  flow?: string
  /** The pinned button after a failure ("Try lock #3011 again"). */
  retryLabel?: (step: SigningStep, index: number) => string
  /**
   * Runs once every step is signed and confirmed, before Done, with the
   * block of the last one.
   */
  onSigned?: (block: bigint | null) => void
  /**
   * A review with nothing to sign that still does something here (a vote
   * saved for the next epoch): the primary runs it and shows Done.
   */
  commit?: () => void
}

type Phase =
  | { kind: "form" }
  | { kind: "loading" }
  | { kind: "error"; message: string; action?: string; rows?: Row[] }
  | {
      kind: "review"
      review: Review
      fee: string | null
      route: SigningRoute
      safe: SafeReview | null
    }
  | {
      kind: "signing"
      review: Review
      fee: string | null
      steps: SigningStep[]
    }
  | {
      kind: "done"
      review: Review
      fee: string | null
      receipts: Map<string, TransactionReceipt>
    }
  | {
      kind: "proposing"
      review: Review
      fee: string | null
      route: SafeRoute
      safe: SafeReview
      error: string | null
    }
  | {
      kind: "proposed"
      review: Review
      route: SafeRoute
      safe: SafeReview
      submitted: SafeSubmitted
      status: ProposalStatus | null
      /** After execution: receipts for the second proposal, when one waits. */
      next: Map<string, TransactionReceipt> | null
    }

type Exported = { fileName: string; note: string | null; safe: string | null }

const fallbackGas = 250_000n

async function estimateFee(
  config: Config,
  account: Address,
  steps: readonly PlanStep[],
): Promise<bigint> {
  const price = await getGasPrice(config, { chainId: mezoChainId })
  let gas = 0n
  for (const step of steps) {
    try {
      const call = step.prepare(new Map())
      gas += await estimateGas(config, {
        account,
        to: call.to,
        data: call.data,
        ...(call.value === undefined ? {} : { value: call.value }),
        chainId: mezoChainId,
      })
    } catch {
      gas += fallbackGas
    }
  }
  return gas * price
}

function proposeErrorCopy(error: unknown): string {
  if (isUserRejection(error)) return rejectedCopy
  if (error instanceof Error && error.message.startsWith("Safe service")) {
    return "Safe service refused the proposal"
  }
  return failureCopy(error, [])
}

/** The review's shape while the chain reads land (Skullet measures it). */
const reviewSample: ReactNode = (
  <>
    <p className="text-[15px] text-sec">Projected</p>
    <p className="mt-1 text-[40px] leading-tight font-[650]">$1,000.00</p>
    <p className="mt-1 text-[15px] text-sec">41,260 veMEZO</p>
    <dl className="mt-5 flex flex-col border-line border-t pt-3">
      {["From lock", "Voting power", "Network fee"].map((label) => (
        <div key={label} className="flex justify-between py-2 text-[15.5px]">
          <dt>{label}</dt>
          <dd>veMEZO #2207</dd>
        </div>
      ))}
    </dl>
    <ol className="mt-5 flex flex-col gap-1.5">
      {["Approve 6,000.00 MEZO", "Add to #2207"].map((label) => (
        <li key={label} className="flex min-h-[56px] items-center gap-4">
          <span className="size-10 rounded-full" />
          <span className="text-base font-semibold">{label}</span>
        </li>
      ))}
    </ol>
  </>
)

const textLink =
  "cursor-pointer rounded-sm text-[15px] font-semibold underline underline-offset-[3px] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"

function Rows({ rows }: { rows: readonly Row[] }): ReactNode {
  if (rows.length === 0) return null
  return (
    <dl className="mt-5 flex flex-col border-line border-t pt-3 tabular-nums">
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

function Headline({ review }: { review: Review }): ReactNode {
  return (
    <>
      <p className="text-[15px] text-sec">{review.headline.label}</p>
      <p className="mt-1 flex items-center gap-2.5 text-[40px] leading-tight font-[650] tracking-[-0.025em] tabular-nums max-sm:text-[34px]">
        {review.headline.figure}
      </p>
      {review.headline.sub === undefined ? null : (
        <p className="mt-1 text-[15px] text-sec tabular-nums">
          {review.headline.sub}
        </p>
      )}
    </>
  )
}

function ReviewSteps({ steps }: { steps: readonly PlanStep[] }): ReactNode {
  return (
    <div className="mt-5">
      <SigningSteps.Root>
        {steps.map((step, index) => (
          <SigningSteps.Step
            key={step.id}
            index={index + 1}
            label={step.label}
            detail={step.detail}
            status="review"
          />
        ))}
      </SigningSteps.Root>
    </div>
  )
}

function Blocked({ message }: { message: string }): ReactNode {
  return (
    <p
      role="alert"
      className="mt-4 flex items-center gap-2 text-[15px] font-semibold text-neg"
    >
      <Glyph shape={shapes.circleAlert} size={18} />
      {message}
    </p>
  )
}

function SafeChecks({ safe }: { safe: SafeReview }): ReactNode {
  return (
    <>
      {safe.simulation.ok ? (
        <p className="mt-4 flex items-center gap-2 text-[15px] font-semibold text-pos">
          <Glyph
            shape={shapes.check}
            size={18}
            strokeWidth={2.4}
            className="mbx-draw"
          />
          Simulation passed
        </p>
      ) : null}
      {safe.split === null ? null : (
        <p className="mt-2 text-[14.5px] text-sec">{safe.split}</p>
      )}
    </>
  )
}

function ExternalLink({
  href,
  children,
}: {
  href: string
  children: ReactNode
}): ReactNode {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex items-center gap-1 underline underline-offset-[3px]"
    >
      {children}
      <Glyph shape={shapes.arrowUpRight} size={14} strokeWidth={2.2} />
    </a>
  )
}

export function TxSheet({
  config,
  account,
  titles,
  form,
  prepare,
  reviewCta,
  success,
  revision = "",
  flow,
  retryLabel,
  onSigned,
  commit,
}: TxSheetProps): ReactNode {
  const { store, market } = useLive()
  const settings = useSettings()
  const tx = useTx()
  const flowName = flow ?? tx?.request.flow ?? "matchbox"
  const [phase, setPhase] = useState<Phase>(
    form === undefined ? { kind: "loading" } : { kind: "form" },
  )
  const [exported, setExported] = useState<Exported | null>(null)
  const open = useRef(true)
  const receiptsRef = useRef(new Map<string, TransactionReceipt>())
  const prepareRef = useRef(prepare)
  prepareRef.current = prepare
  const btcUsd = market.prices.btc?.usd ?? null

  useEffect(() => {
    void preloadHaptics()
    return () => {
      open.current = false
    }
  }, [])

  function signer(): Address {
    return getAccount(config).address ?? account
  }

  async function review(): Promise<void> {
    setPhase({ kind: "loading" })
    setExported(null)
    try {
      const route = await signingRoute(config, getSettings().signing)
      // Proposing for a Safe: the plan reads and acts as the Safe.
      const actor = route.kind === "propose" ? route.safe : account
      const prepared = await prepareRef.current({ config, account: actor })
      // Nothing to sign (only saved here): no Safe, no simulation, no fee.
      if (commit !== undefined && prepared.steps.length === 0) {
        if (open.current) {
          setPhase({
            kind: "review",
            review: prepared,
            fee: null,
            route,
            safe: null,
          })
        }
        return
      }
      if (isSafeRoute(route)) {
        const safeFlow = await import("../safe/flow")
        const safe = await safeFlow.reviewForSafe({
          config,
          route,
          signer: signer(),
          steps: prepared.steps,
        })
        const simulation = safe.simulation
        const fee = simulation.ok
          ? await getGasPrice(config, { chainId: mezoChainId })
              .then((price) => feeLabel(price * simulation.gas, btcUsd))
              .catch(() => null)
          : null
        if (open.current) {
          setPhase({
            kind: "review",
            review: { ...prepared, blocked: prepared.blocked ?? safe.blocked },
            fee,
            route,
            safe,
          })
        }
        return
      }
      let blocked = prepared.blocked
      const first = prepared.steps[0]
      if (blocked === null && first !== undefined) {
        try {
          await simulate(config, account, first.prepare(new Map()))
        } catch (error) {
          blocked = failureCopy(error, first.prepare(new Map()).abi)
        }
      }
      const fee = await estimateFee(config, account, prepared.steps)
        .then((wei) => feeLabel(wei, btcUsd))
        .catch(() => null)
      if (open.current) {
        setPhase({
          kind: "review",
          review: { ...prepared, blocked },
          fee,
          route,
          safe: null,
        })
      }
    } catch (error) {
      if (!open.current) return
      setPhase(
        error instanceof ReviewStop
          ? {
              kind: "error",
              message: error.message,
              action: error.action,
              rows: error.rows,
            }
          : { kind: "error", message: "Chain data unavailable" },
      )
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: reviews on open without a form, and again when the plan or the signing setting changes
  useEffect(() => {
    if (form === undefined) void review()
  }, [revision, settings.signing])

  async function sign(
    current: Review,
    fee: string | null,
    steps: SigningStep[],
    receipts: Map<string, TransactionReceipt>,
  ): Promise<void> {
    let live = steps
    setPhase({ kind: "signing", review: current, fee, steps: live })
    const result = await runPlan({
      config,
      account,
      steps: current.steps,
      startAt: Math.max(0, nextStepIndex(live)),
      receipts,
      onEvent: (event) => {
        live = applyStepEvent(live, event)
        // Activity lists what was sent before the indexer has it.
        const step = live.find((entry) => entry.id === event.id)
        if (event.type === "submitted") {
          noteSubmitted({
            hash: event.hash,
            wallet: account,
            label: step?.label ?? "Transaction",
          })
        } else if (step?.hash != null && event.type === "done") {
          noteSettled(step.hash, "confirmed")
        } else if (
          step?.hash != null &&
          event.type === "failed" &&
          event.failure === "chain"
        ) {
          noteSettled(step.hash, "reverted")
        }
        if (open.current) {
          setPhase({ kind: "signing", review: current, fee, steps: live })
        }
      },
    })
    if (!result.ok) {
      fireHaptic("error")
      receiptsRef.current = result.receipts
      if (result.failure.failure === "chain") {
        showToast({
          title: failedOnChainCopy(result.failure.error),
          block: result.failure.block,
          hash: result.failure.hash,
          tone: "negative",
        })
      }
      return
    }
    fireHaptic("success")
    const last = [...result.receipts.values()].at(-1)
    onSigned?.(last?.blockNumber ?? null)
    showToast({
      title: success.toast,
      block: last?.blockNumber ?? null,
      hash: last?.transactionHash ?? null,
      tone: "positive",
    })
    if (last !== undefined) {
      refreshAfterBlock({
        store,
        block: last.blockNumber,
        targets: success.refresh,
        address: account,
      })
    }
    if (open.current) {
      setPhase({
        kind: "done",
        review: current,
        fee,
        receipts: result.receipts,
      })
    }
  }

  async function propose(
    current: Review,
    fee: string | null,
    route: SafeRoute,
    safe: SafeReview,
  ): Promise<void> {
    setPhase({
      kind: "proposing",
      review: current,
      fee,
      route,
      safe,
      error: null,
    })
    try {
      const safeFlow = await import("../safe/flow")
      const submitted = await safeFlow.submitToSafe({
        config,
        route,
        signer: signer(),
        review: safe,
      })
      fireHaptic("success")
      if (open.current) {
        setPhase({
          kind: "proposed",
          review: current,
          route,
          safe,
          submitted,
          status: null,
          next: null,
        })
      }
    } catch (error) {
      fireHaptic("error")
      if (open.current) {
        setPhase({
          kind: "proposing",
          review: current,
          fee,
          route,
          safe,
          error: proposeErrorCopy(error),
        })
      }
    }
  }

  /** The second proposal, once the first executed (the minted lock id). */
  async function proposeNext(
    current: Review,
    route: SafeRoute,
    safe: SafeReview,
    receipts: Map<string, TransactionReceipt>,
  ): Promise<void> {
    const gap = safe.batches.gap
    if (gap === null) return
    setPhase({ kind: "loading" })
    try {
      const safeFlow = await import("../safe/flow")
      const next = await safeFlow.reviewForSafe({
        config,
        route,
        signer: signer(),
        steps: current.steps,
        receipts,
        startAt: gap.index,
      })
      if (open.current) {
        setPhase({
          kind: "review",
          review: { ...current, blocked: next.blocked },
          fee: null,
          route,
          safe: next,
        })
      }
    } catch {
      if (open.current)
        setPhase({ kind: "error", message: "Chain data unavailable" })
    }
  }

  const watching = phase.kind === "proposed" ? phase.submitted.safeTxHash : null

  // Polls the Transaction Service only while this sheet shows the proposal.
  // biome-ignore lint/correctness/useExhaustiveDependencies: restarts per proposal only
  useEffect(() => {
    if (watching === null) return
    let stop = (): void => undefined
    let cancelled = false
    let settled = false
    void import("../safe/flow").then((safeFlow) => {
      if (cancelled) return
      stop = safeFlow.watchProposal(watching, (status) => {
        setPhase((prev) =>
          prev.kind === "proposed" && prev.submitted.safeTxHash === watching
            ? { ...prev, status }
            : prev,
        )
        if (!status.executed || settled || status.transactionHash === null) {
          return
        }
        settled = true
        void settle(safeFlow, status.transactionHash, status.successful)
      })
    })
    return () => {
      cancelled = true
      stop()
    }
  }, [watching])

  async function settle(
    safeFlow: typeof import("../safe/flow"),
    hash: `0x${string}`,
    successful: boolean | null,
  ): Promise<void> {
    const current = phase.kind === "proposed" ? phase : null
    if (current === null) return
    try {
      const receipts = await safeFlow.executedReceipts({
        config,
        hash,
        review: current.safe,
        receipts: receiptsRef.current,
      })
      receiptsRef.current = receipts
      const receipt = receipts.get(current.safe.batches.now[0]?.step.id ?? "")
      const block = receipt?.blockNumber ?? null
      if (successful === false) {
        showToast({
          title: failedOnChainCopy(null),
          block,
          hash,
          tone: "negative",
        })
        return
      }
      showToast({ title: success.toast, block, hash, tone: "positive" })
      if (block !== null) {
        refreshAfterBlock({
          store,
          block,
          targets: success.refresh,
          address: current.safe.safe,
        })
      }
      if (open.current && current.safe.batches.gap !== null) {
        setPhase((prev) =>
          prev.kind === "proposed" ? { ...prev, next: receipts } : prev,
        )
      }
    } catch {
      // The poll already shows it executed; the refresh follows the head.
    }
  }

  async function exportForSafe(
    current: Review,
    safe: string | null,
  ): Promise<void> {
    const { downloadSafeExport, safeExport, safeExportFileName } = await import(
      "./safe-export"
    )
    const now = new Date()
    const result = safeExport({
      steps: current.steps,
      name: `Matchbox Pro ${flowName}`,
      safe,
      createdAt: now.getTime(),
    })
    const fileName = safeExportFileName(flowName, now)
    downloadSafeExport(fileName, result.file)
    setExported({ fileName, note: result.note, safe })
  }

  const title =
    phase.kind === "form"
      ? (titles.form ?? titles.review)
      : phase.kind === "signing"
        ? titles.sign
        : phase.kind === "done"
          ? titles.done
          : titles.review

  const rows = (
    current: Review,
    fee: string | null,
    signing: boolean,
    safe: SafeReview | null = null,
  ): Row[] => {
    const base = signing
      ? current.rows.slice(0, current.signRows ?? current.rows.length)
      : current.rows
    const extra: Row[] = []
    if (safe !== null) {
      extra.push({ label: "Safe", value: shortAddress(safe.safe) })
      extra.push({
        label: "Signers",
        value: `${safe.info.threshold} of ${safe.info.owners.length}`,
      })
    } else if (!signing && current.steps.length > 1) {
      extra.push({ label: "Signatures", value: current.steps.length })
    }
    if (fee !== null) extra.push({ label: "Network fee", value: fee })
    return [...base, ...extra]
  }

  const exportSafe = (route: SigningRoute): string | null =>
    isSafeRoute(route)
      ? route.safe
      : settings.signing.mode === "multisig"
        ? settings.signing.safe
        : null

  const exportNote =
    exported === null ? null : (
      <div
        role="status"
        className="flex flex-col items-center gap-1 text-center text-[14px] text-sec"
      >
        <p>
          Saved {exported.fileName}, drop it into Transaction Builder
          {exported.safe === null ? null : (
            <>
              {" "}
              <a
                href={txBuilderOpenUrl(exported.safe)}
                target="_blank"
                rel="noreferrer noopener"
                className="font-semibold text-ink underline underline-offset-[3px]"
              >
                Continue to Safe
              </a>
            </>
          )}
        </p>
        {exported.note === null ? null : <p>{exported.note}</p>}
      </div>
    )

  const failed = phase.kind === "signing" ? failedStep(phase.steps) : null

  return (
    <Sheet.Root open onOpenChange={(next) => (next ? undefined : closeTx())}>
      <Sheet.Content>
        <Sheet.Header>
          {phase.kind === "done" || phase.kind === "proposed" ? (
            <span className="sr-only">{title}</span>
          ) : (
            title
          )}
        </Sheet.Header>
        <Sheet.Body>
          {phase.kind === "form" ? form?.content : null}
          {phase.kind === "loading" ? (
            <Loading id="tx-review" label="Checking" sample={reviewSample} />
          ) : null}
          {phase.kind === "error" ? (
            <>
              <p role="alert" className="text-[15px] font-semibold text-neg">
                {phase.message}
              </p>
              <Rows rows={phase.rows ?? []} />
            </>
          ) : null}
          {phase.kind === "review" || phase.kind === "proposing" ? (
            <>
              <Headline review={phase.review} />
              {phase.review.body}
              <Rows rows={rows(phase.review, phase.fee, false, phase.safe)} />
              <ReviewSteps steps={phase.review.steps} />
              {phase.kind === "proposing" && phase.error !== null ? (
                <Blocked message={phase.error} />
              ) : phase.review.blocked !== null ? (
                <Blocked message={phase.review.blocked} />
              ) : phase.safe !== null ? (
                <SafeChecks safe={phase.safe} />
              ) : null}
            </>
          ) : null}
          {phase.kind === "signing" ? (
            <>
              <Headline review={phase.review} />
              <div className="mt-5">
                <SigningSteps.Root>
                  {phase.steps.map((step, index) => (
                    <SigningSteps.Step
                      key={step.id}
                      index={index + 1}
                      label={step.label}
                      detail={stepDetail(step)}
                      status={step.status}
                      link={stepLink(step)}
                    />
                  ))}
                </SigningSteps.Root>
              </div>
              <Rows rows={rows(phase.review, phase.fee, true)} />
            </>
          ) : null}
          {phase.kind === "done" ? (
            <Done
              title={titles.done}
              review={phase.review}
              fee={phase.fee}
              hash={
                [...phase.receipts.values()].at(-1)?.transactionHash ?? null
              }
            />
          ) : null}
          {phase.kind === "proposed" ? <Proposed phase={phase} /> : null}
        </Sheet.Body>
        <Sheet.Footer>
          {phase.kind === "form" ? (
            <PillButton.Root
              size="lg"
              disabled={form?.ready !== true}
              onClick={() => void review()}
            >
              {form?.cta ?? "Review"}
            </PillButton.Root>
          ) : null}
          {phase.kind === "loading" ? (
            <PillButton.Root size="lg" pending>
              Checking
            </PillButton.Root>
          ) : null}
          {phase.kind === "error" ? (
            <>
              <PillButton.Root size="lg" onClick={() => void review()}>
                {phase.action ?? "Try again"}
              </PillButton.Root>
              {form === undefined ? null : (
                <button
                  type="button"
                  className={textLink}
                  onClick={() => setPhase({ kind: "form" })}
                >
                  Edit
                </button>
              )}
            </>
          ) : null}
          {phase.kind === "review" ? (
            <ReviewFooter
              phase={phase}
              reviewCta={reviewCta}
              {...(commit === undefined
                ? {}
                : {
                    onCommit: () => {
                      commit()
                      fireHaptic("success")
                      setPhase({
                        kind: "done",
                        review: phase.review,
                        fee: null,
                        receipts: new Map(),
                      })
                    },
                  })}
              onSign={() =>
                void sign(
                  phase.review,
                  phase.fee,
                  startSigning(phase.review.steps),
                  new Map(),
                )
              }
              onPropose={(route, safe) =>
                void propose(phase.review, phase.fee, route, safe)
              }
              onExport={() =>
                void exportForSafe(phase.review, exportSafe(phase.route))
              }
              exportNote={exportNote}
            />
          ) : null}
          {phase.kind === "proposing" ? (
            phase.error === null ? (
              <PillButton.Root size="lg" pending>
                {phase.route.kind === "propose"
                  ? "Waiting for wallet"
                  : "Waiting for Safe"}
              </PillButton.Root>
            ) : (
              <PillButton.Root
                size="lg"
                onClick={() =>
                  void propose(phase.review, phase.fee, phase.route, phase.safe)
                }
              >
                Try again
              </PillButton.Root>
            )
          ) : null}
          {phase.kind === "signing" ? (
            signingPhase(phase.steps) === "failed" ? (
              <PillButton.Root
                size="lg"
                onClick={() =>
                  void sign(
                    phase.review,
                    phase.fee,
                    retryFrom(phase.steps),
                    receiptsRef.current,
                  )
                }
              >
                {failed !== null && retryLabel !== undefined
                  ? retryLabel(failed.step, failed.index)
                  : defaultRetryLabel(phase.steps)}
              </PillButton.Root>
            ) : (
              <>
                <PillButton.Root size="lg" pending>
                  {buttonLabel(phase.steps)}
                </PillButton.Root>
                <Sheet.Close className={textLink}>Cancel</Sheet.Close>
              </>
            )
          ) : null}
          {phase.kind === "done" ? (
            <>
              <PillButton.Root size="lg" onClick={closeTx}>
                Done
              </PillButton.Root>
              {/* Saved, not signed: there is no activity to show yet. */}
              {phase.receipts.size === 0 ? null : (
                <PillButton.Root asChild size="lg" intent="secondary">
                  <Link to="/activity" onClick={closeTx}>
                    View activity
                  </Link>
                </PillButton.Root>
              )}
            </>
          ) : null}
          {phase.kind === "proposed" ? (
            phase.next !== null && phase.safe.batches.gap !== null ? (
              <>
                <PillButton.Root
                  size="lg"
                  onClick={() => {
                    if (phase.next === null) return
                    void proposeNext(
                      phase.review,
                      phase.route,
                      phase.safe,
                      phase.next,
                    )
                  }}
                >
                  {`Propose step ${phase.safe.batches.gap.index + 1}`}
                </PillButton.Root>
                <button type="button" className={textLink} onClick={closeTx}>
                  Done
                </button>
              </>
            ) : (
              <>
                <PillButton.Root asChild size="lg">
                  <a
                    href={phase.submitted.url}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    Continue to Safe
                  </a>
                </PillButton.Root>
                <button type="button" className={textLink} onClick={closeTx}>
                  Done
                </button>
              </>
            )
          ) : null}
        </Sheet.Footer>
      </Sheet.Content>
    </Sheet.Root>
  )
}

function ReviewFooter({
  phase,
  reviewCta,
  onCommit,
  onSign,
  onPropose,
  onExport,
  exportNote,
}: {
  phase: Extract<Phase, { kind: "review" }>
  reviewCta: string
  /** Nothing to sign: the primary does the local part and shows Done. */
  onCommit?: () => void
  onSign: () => void
  onPropose: (route: SafeRoute, safe: SafeReview) => void
  onExport: () => void
  exportNote: ReactNode
}): ReactNode {
  const { review, route, safe } = phase
  const empty = review.steps.length === 0
  if (empty && onCommit !== undefined) {
    return (
      <PillButton.Root
        size="lg"
        disabled={review.blocked !== null}
        onClick={onCommit}
      >
        {reviewCta}
      </PillButton.Root>
    )
  }
  const exportLink = (
    <button
      type="button"
      className={`inline-flex items-center gap-1.5 ${textLink}`}
      disabled={empty}
      onClick={onExport}
    >
      <Glyph shape={shapes.arrowDown} size={16} strokeWidth={2.2} />
      Export for Safe
    </button>
  )
  if (route.kind === "export") {
    return (
      <>
        <PillButton.Root size="lg" disabled={empty} onClick={onExport}>
          Export for Safe
        </PillButton.Root>
        {exportNote}
        <button
          type="button"
          className={textLink}
          disabled={empty || review.blocked !== null}
          onClick={onSign}
        >
          {reviewCta}
        </button>
      </>
    )
  }
  if (isSafeRoute(route) && safe !== null) {
    return (
      <>
        <PillButton.Root
          size="lg"
          disabled={review.blocked !== null || safe.batches.now.length === 0}
          onClick={() => onPropose(route, safe)}
        >
          Propose to Safe
        </PillButton.Root>
        {exportLink}
        {exportNote}
      </>
    )
  }
  return (
    <>
      <PillButton.Root
        size="lg"
        disabled={review.blocked !== null || empty}
        onClick={onSign}
      >
        {reviewCta}
      </PillButton.Root>
      {exportLink}
      {exportNote}
    </>
  )
}

function Proposed({
  phase,
}: {
  phase: Extract<Phase, { kind: "proposed" }>
}): ReactNode {
  const { submitted, status, safe } = phase
  const signed = status?.confirmations ?? submitted.signed
  const required = status?.required ?? submitted.threshold
  const executed = status?.executed === true
  const failed = executed && status?.successful === false
  const heading = failed
    ? "Failed on chain"
    : executed
      ? "Executed"
      : "Proposed to Safe"
  const rows: Row[] = [
    { label: "Safe", value: shortAddress(submitted.safe) },
    { label: "Signed", value: `${signed} of ${required}` },
  ]
  if (
    status?.transactionHash !== null &&
    status?.transactionHash !== undefined
  ) {
    rows.push({
      label: "Transaction",
      value: (
        <ExternalLink href={scanTxUrl(status.transactionHash)}>
          View on Matchscan
        </ExternalLink>
      ),
    })
  } else {
    rows.push({
      label: "Queue",
      value: <ExternalLink href={submitted.url}>View in Safe</ExternalLink>,
    })
  }
  return (
    <div className="flex flex-col">
      <span
        aria-hidden="true"
        data-mbx-motion=""
        className={`mx-auto mt-4 grid size-24 animate-[mbx-check-pop_320ms_var(--ease-roll)] place-items-center rounded-full ${failed ? "bg-neg-soft text-neg" : "bg-acc-soft text-acc-ink"}`}
      >
        <Glyph
          shape={failed ? shapes.x : shapes.check}
          size={40}
          strokeWidth={2.6}
          className={failed ? undefined : "mbx-draw"}
        />
      </span>
      <h2 className="mt-6 text-center text-[30px] font-[650] tracking-[-0.02em]">
        {heading}
      </h2>
      <p
        aria-live="polite"
        className="mt-1 text-center text-[15.5px] text-sec tabular-nums"
      >
        {`${signed} of ${required} signed`}
      </p>
      <Rows rows={rows} />
      {safe.split === null ? null : (
        <p className="mt-3 text-[14.5px] text-sec">{safe.split}</p>
      )}
    </div>
  )
}

function Done({
  title,
  review,
  fee,
  hash,
}: {
  title: string
  review: Review
  fee: string | null
  hash: string | null
}): ReactNode {
  const rows: Row[] = [...review.done.rows]
  if (fee !== null)
    rows.push({ label: "Network fee", value: fee.replace("About ", "") })
  if (hash !== null) {
    rows.push({
      label: "Transaction",
      value: (
        <ExternalLink href={scanTxUrl(hash)}>View on Matchscan</ExternalLink>
      ),
    })
  }
  return (
    <div className="flex flex-col">
      <span
        aria-hidden="true"
        data-mbx-motion=""
        className="mx-auto mt-4 grid size-24 animate-[mbx-check-pop_320ms_var(--ease-roll)] place-items-center rounded-full bg-acc-soft text-acc-ink"
      >
        <Glyph
          shape={shapes.check}
          size={40}
          strokeWidth={2.6}
          className="mbx-draw"
        />
      </span>
      <h2 className="mt-6 text-center text-[30px] font-[650] tracking-[-0.02em]">
        {title}
      </h2>
      {review.done.sub === undefined ? null : (
        <p className="mt-1 text-center text-[15.5px] text-sec tabular-nums">
          {review.done.sub}
        </p>
      )}
      <Rows rows={rows} />
    </div>
  )
}
