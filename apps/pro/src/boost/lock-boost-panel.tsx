import { formatBoostWad } from "@matchbox/domain"
import { TokenIcon } from "@matchbox/token-icons"
import { sanitizeAmount } from "@matchbox/ui/field"
import * as GaugeCard from "@matchbox/ui/gauge-card"
import { useRouter } from "@tanstack/react-router"
import { type ReactNode, useId, useState } from "react"
import { useLoad } from "../account/panel-parts"
import { fetchLive } from "../data/live-query"
import { overviewQuery } from "../data/queries"
import type { LockKind } from "../data/view-models"
import { formatVoteAmount, groupThousands } from "../lib/format"
import { useLive } from "../live/live-context"
import { readRpc, useSettings } from "../settings/settings-store"
import { closeTx } from "../tx/tx-store"
import { calcSearch } from "./calc-link"
import { calcModel, fieldValue, wholeUp } from "./calc-model"
import { holdings, type LockBoostFigures, lockBoostFigures } from "./lock-boost"
import { useBoostTotals } from "./use-totals"

/**
 * The Boost panel in New lock (Doop `9AYzWcVWEA`): where the question is
 * asked. It follows the amount and duration being typed, through the
 * voting power the lock will have:
 *
 *   BTC   about how much veMEZO its gauge needs for 5×, and what the
 *         wallet's own veMEZO would give it
 *   MEZO  about how much veBTC its veMEZO can bring to 5×, and how that
 *         compares with the wallet's veBTC locks
 *
 * "About", since the system totals move. With no totals it says so and
 * shows no figure. A link carries the figures into the boost calculator.
 */

const veMezoLabel = (wei: bigint): string => formatVoteAmount(wei, "veMEZO")
const veBtcLabel = (wei: bigint): string => formatVoteAmount(wei, "veBTC")
const times = (wad: bigint): string => `${formatBoostWad(wad)}×`

/** The panel's two lines: the lock's own, then the wallet's. */
function lines(
  kind: LockKind,
  figures: LockBoostFigures | null,
  state: "empty" | "loading" | "no-totals" | "ready",
  wallet: { count: number; total: bigint },
): { main: string; wallet: string | null } {
  const held =
    wallet.count === 0
      ? null
      : kind === "vebtc"
        ? `You hold ${veMezoLabel(wallet.total)} to vote with.`
        : `Your ${wallet.count === 1 ? "veBTC lock holds" : `${wallet.count} veBTC locks hold`} ${veBtcLabel(wallet.total)}.`
  if (state === "empty") {
    return {
      main:
        kind === "vebtc"
          ? "Enter an amount to see the veMEZO it needs for the maximum 5× boost."
          : "Enter an amount to see how much veBTC it can bring to the maximum 5× boost.",
      wallet: held,
    }
  }
  if (state === "no-totals") {
    return {
      main: "System totals could not be read, so there is no figure yet.",
      wallet: held,
    }
  }
  if (figures === null) return { main: "…", wallet: held }
  if (figures.kind === "vebtc") {
    const mine = figures.wallet
    return {
      main: `You will need about ${veMezoLabel(figures.forMax)} on this lock's gauge for the maximum 5× boost.`,
      wallet:
        mine === null
          ? null
          : mine.more === 0n
            ? `Your ${veMezoLabel(mine.veMezo)}, all on its gauge, already reaches the maximum 5×.`
            : `Your ${veMezoLabel(mine.veMezo)}, all on its gauge, would give about ${times(mine.boost)}: about ${veMezoLabel(mine.more)} more for 5×.`,
    }
  }
  const mine = figures.wallet
  return {
    main: `This lock's voting power can bring up to about ${veBtcLabel(figures.carries)} to the maximum 5× boost.`,
    wallet:
      mine === null
        ? null
        : mine.covered
          ? `That is enough for ${mine.count === 1 ? "your veBTC lock" : `all ${mine.count} of your veBTC locks`} (${veBtcLabel(mine.veBtc)}) to reach 5×.`
          : `Your veBTC locks hold ${veBtcLabel(mine.veBtc)}: spread over their gauges, it would give them about ${times(mine.boost)}.`,
  }
}

export function LockBoostPanel({
  kind,
  votingPower,
  account,
}: {
  kind: LockKind
  /** The lock's voting power as typed so far, base units. */
  votingPower: bigint
  /** The connected wallet, whose locks the lines compare with. */
  account: string | null
}): ReactNode {
  const { rpc } = useLive()
  useSettings()
  const totals = useBoostTotals(true, readRpc(rpc))
  const router = useRouter()
  const overview = useLoad(`lock-boost-${account ?? "none"}`, async () =>
    account === null ? null : fetchLive(overviewQuery(account)),
  )
  const locks = overview.data?.locks ?? []
  const [veMezo, setVeMezo] = useState("")
  const inputId = useId()

  const figures = lockBoostFigures({
    kind,
    votingPower,
    totals: totals.read,
    locks,
  })
  const state =
    votingPower <= 0n
      ? "empty"
      : totals.read === null
        ? totals.failed
          ? "no-totals"
          : "loading"
        : "ready"
  const text = lines(
    kind,
    figures,
    state,
    holdings(locks, kind === "vebtc" ? "vemezo" : "vebtc"),
  )

  // BTC only: the boost for a veMEZO figure the person tries.
  const veBtc = votingPower > 0n ? fieldValue(votingPower, 8) : ""
  const model = calcModel({
    solve: "boost",
    veBtc,
    veMezo,
    totals: totals.read,
  })
  const forMax = model.forMax === null ? null : wholeUp(model.forMax)
  const typedVeMezo = model.veMezo ?? 0n

  const open = (): void => {
    // The calculator opens over the page with these figures; the lock form
    // closes, since two sheets cannot share the screen.
    const search =
      kind === "vemezo"
        ? calcSearch({
            veMezo: votingPower > 0n ? fieldValue(votingPower, 0) : null,
            solve: "vebtc",
            target: 500,
          })
        : calcSearch({
            veBtc: veBtc === "" ? null : veBtc,
            veMezo,
            solve: veMezo === "" ? "vemezo" : "boost",
            target: 500,
          })
    closeTx()
    void router.navigate({
      to: ".",
      search: (now) => ({ ...now, ...search }),
      resetScroll: false,
    })
  }

  return (
    <section
      aria-label="Boost"
      data-lock-boost=""
      className="rounded-[20px] bg-soft p-[18px] text-[15px]"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-[650]">Boost</h3>
        {kind === "vebtc" ? (
          <p className="text-right text-[14px] text-sec tabular-nums">
            {model.boost === null
              ? null
              : model.veMezo === null
                ? "1.0× until veMEZO votes for it"
                : times(model.boost)}
          </p>
        ) : null}
      </div>
      {totals.failed ? (
        <p className="mt-2 text-[14px] text-sec">
          {totals.read === null
            ? null
            : `Totals from block ${groupThousands(BigInt(totals.read.block))}. `}
          <button
            type="button"
            onClick={totals.retry}
            className="cursor-pointer rounded-sm font-semibold text-ink underline underline-offset-[3px] outline-none focus-visible:outline-2 focus-visible:outline-ink"
          >
            Try again
          </button>
        </p>
      ) : null}
      {/* Room for two lines each, so typing does not move what is below. */}
      <div aria-live="polite" className="mt-2 tabular-nums">
        <p data-lock-boost-main="" className="min-h-[44px] font-semibold">
          {text.main}
        </p>
        {text.wallet === null ? null : (
          <p
            data-lock-boost-wallet=""
            className="mt-1 min-h-[44px] text-[14.5px] text-sec"
          >
            {text.wallet}
          </p>
        )}
      </div>
      {kind === "vebtc" ? (
        <>
          <label
            htmlFor={inputId}
            className="mt-3 flex h-12 cursor-text items-center gap-3 rounded-[14px] bg-raised px-3.5 focus-within:outline-2 focus-within:outline-acc"
          >
            <span className="flex-none text-sec">If its gauge gets</span>
            <input
              id={inputId}
              inputMode="numeric"
              autoComplete="off"
              value={veMezo}
              placeholder="0"
              onChange={(event) =>
                setVeMezo(sanitizeAmount(event.target.value, 0))
              }
              className="min-w-0 flex-1 bg-transparent text-right text-[17px] font-[650] tabular-nums outline-none placeholder:text-mut"
            />
            <span className="flex flex-none items-center gap-1.5 font-semibold">
              <TokenIcon ticker="MEZO" size={20} />
              veMEZO
            </span>
          </label>
          {forMax === null || veMezo === "" ? null : (
            <div className="mt-3 overflow-hidden rounded-[14px]">
              <GaugeCard.Band
                votes={Number(typedVeMezo / 10n ** 18n)}
                optimal={Number(forMax / 10n ** 18n)}
                count={groupThousands(typedVeMezo / 10n ** 18n)}
                of={`of ${veMezoLabel(forMax)}`}
                toGo={
                  forMax > typedVeMezo
                    ? `${veMezoLabel(forMax - typedVeMezo)} to go`
                    : "At 5×"
                }
                over={`${veMezoLabel(typedVeMezo > forMax ? typedVeMezo - forMax : 0n)} over`}
              />
            </div>
          )}
        </>
      ) : null}
      <p className="mt-3">
        <button
          type="button"
          onClick={open}
          className="cursor-pointer rounded-sm font-semibold underline underline-offset-[3px] outline-none focus-visible:outline-2 focus-visible:outline-ink"
        >
          Open boost calculator
        </button>
      </p>
    </section>
  )
}
