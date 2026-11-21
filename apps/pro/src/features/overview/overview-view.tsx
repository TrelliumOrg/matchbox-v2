import { TokenIcon } from "@matchbox/token-icons"
import * as Banner from "@matchbox/ui/banner"
import * as GaugeCard from "@matchbox/ui/gauge-card"
import * as PillButton from "@matchbox/ui/pill-button"
import { Link } from "@tanstack/react-router"
import { type ReactNode, useState } from "react"
import {
  ClaimableAsOfNote,
  LocksAsOfNote,
} from "../../components/claimable-as-of"
import { Coins } from "../../components/coins"
import { island } from "../../components/island"
import { LockCards } from "../../components/lock-cards"
import { Usd } from "../../components/money"
import type { Overview } from "../../data/view-models"
import { formatCompactVotes, formatTokenWithSymbol } from "../../lib/format"
import { gaugeName } from "../../lib/gauge-name"
import { useViewer, useViewingOther } from "../../lib/viewer"
import { useLive } from "../../live/live-context"
import { openClaim } from "../../tx/open-claim"
import { openTx, txIntent } from "../../tx/tx-store"

function Headline({
  id,
  label,
  value,
  coins,
  small = false,
}: {
  /** Names the count-up, stable across epochs. */
  id: string
  label: string
  value: string
  coins: ReactNode
  /** A second figure beside the headline (Projected next to Claimable). */
  small?: boolean
}): ReactNode {
  const Label = small ? "h2" : "h1"
  return (
    <section aria-label={label}>
      <Label className={small ? "text-[15px] text-sec" : "text-base text-sec"}>
        {label}
      </Label>
      <div
        className={`mt-1 flex items-center ${small ? "gap-2.5" : "gap-3.5"}`}
      >
        <p
          className={
            small
              ? "text-[24px] leading-[1.25] font-[650] tracking-[-0.015em] tabular-nums"
              : "text-[40px] leading-[1.15] font-[650] tracking-[-0.025em] tabular-nums md:text-[44px]"
          }
        >
          <Usd value={value} style="cents" countUp={`overview-${id}`} />
        </p>
        {coins}
      </div>
    </section>
  )
}

function Suggestion({
  suggestion,
}: {
  suggestion: NonNullable<Overview["suggestion"]>
}): ReactNode {
  const [open, setOpen] = useState(true)
  if (!open) return null
  const voter = suggestion.gauge.voter
  const unit = voter === "boost" || voter === "third-party" ? "veMEZO" : "veBTC"
  return (
    <Banner.Root className="mt-5">
      <Banner.Icon>
        <GaugeCard.Picture picture={suggestion.gauge.picture} size={24} />
      </Banner.Icon>
      <Banner.Content>
        <p>
          {formatCompactVotes(suggestion.votesToMax)} {unit} to 5× on{" "}
          {gaugeName(suggestion.gauge)}
        </p>
        <Banner.Action asChild>
          <Link to="/vote">Add votes</Link>
        </Banner.Action>
      </Banner.Content>
      <Banner.Close aria-label="Dismiss" onClick={() => setOpen(false)} />
    </Banner.Root>
  )
}

function LockButton({
  symbol,
  amount,
  intent,
}: {
  symbol: "BTC" | "MEZO"
  amount: string
  intent: "primary" | "secondary"
}): ReactNode {
  const viewer = useViewer()
  return (
    <PillButton.Root
      intent={intent}
      className="pl-3"
      {...txIntent}
      onClick={() =>
        openTx(viewer, {
          flow: "new-lock",
          kind: symbol === "BTC" ? "vebtc" : "vemezo",
        })
      }
    >
      <span className="block rounded-full shadow-[0_0_0_2px_var(--raised)]">
        <TokenIcon ticker={symbol} size={22} />
      </span>
      Lock {formatTokenWithSymbol(amount, symbol)}
    </PillButton.Root>
  )
}

const Activity = island("overview-activity", () =>
  import("./overview-activity").then((module) => module.OverviewActivity),
)

/**
 * In place of the actions on someone else's wallet: only its owner can
 * claim, vote or lock with it (as "Nothing to claim" stands in for Claim).
 */
function ViewingOnly(): ReactNode {
  return <PillButton.Root disabled>Viewing only</PillButton.Root>
}

export function OverviewView({ data }: { data: Overview }): ReactNode {
  const viewer = useViewer()
  const other = useViewingOther()
  const hasLocks = data.locks.length > 0
  const nothing = !/[1-9]/.test(data.claimable.usd)
  const wallet = data.wallet
  const projected = data.projected ?? null
  const { market } = useLive()
  return (
    <>
      {hasLocks || wallet === null ? (
        <>
          {/* Shown only when the figure below is not this moment's. */}
          <ClaimableAsOfNote
            asOf={data.claimableAsOf}
            className="mt-6 -mb-4 md:mt-9 md:-mb-7"
          />
          {/* Projected sits beside Claimable, and takes over once claimed. */}
          <div className="mt-6 flex flex-wrap items-end gap-x-12 gap-y-4 md:mt-9">
            {nothing && projected !== null ? null : (
              <Headline
                id="Claimable"
                label="Claimable"
                value={data.claimable.usd}
                coins={
                  <Coins
                    tokens={data.claimable.tokens}
                    size={28}
                    chevron
                    label="Claimable breakdown"
                  />
                }
              />
            )}
            {projected === null ? null : (
              <Headline
                id="Projected"
                label={`Projected, Epoch ${market.epoch.number}`}
                value={projected.usd}
                small={!nothing}
                coins={
                  <Coins
                    tokens={projected.tokens}
                    size={nothing ? 28 : 18}
                    chevron
                    label="Projected breakdown"
                  />
                }
              />
            )}
          </div>
          <div className="mt-[22px] flex flex-wrap gap-2.5">
            {other ? (
              <ViewingOnly />
            ) : (
              <>
                <PillButton.Root
                  {...txIntent}
                  disabled={nothing}
                  onClick={() => void openClaim(viewer, { relock: false })}
                >
                  Claim all
                </PillButton.Root>
                <PillButton.Root
                  intent="secondary"
                  className="max-md:hidden"
                  disabled={nothing}
                  {...txIntent}
                  onClick={() => void openClaim(viewer, { relock: true })}
                >
                  Claim and relock
                </PillButton.Root>
                <PillButton.Root asChild intent="secondary">
                  <Link to="/vote">Vote</Link>
                </PillButton.Root>
              </>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="mt-6 md:mt-9">
            <Headline
              id="Available to lock"
              label="Available to lock"
              value={wallet.usd}
              coins={
                <Coins
                  tokens={[wallet.btc, wallet.mezo]}
                  size={28}
                  label="Wallet breakdown"
                />
              }
            />
          </div>
          <div className="mt-[22px] flex flex-wrap gap-2.5">
            {other ? (
              <ViewingOnly />
            ) : (
              <>
                <LockButton
                  symbol="BTC"
                  amount={wallet.btc.amount}
                  intent="primary"
                />
                <LockButton
                  symbol="MEZO"
                  amount={wallet.mezo.amount}
                  intent="secondary"
                />
              </>
            )}
          </div>
        </>
      )}
      {/* Shown only when the locks below are not this moment's. */}
      <LocksAsOfNote asOf={data.locksAsOf} className="mt-9 -mb-6" />
      <LockCards locks={data.locks} />
      {data.suggestion === null || other ? null : (
        <Suggestion suggestion={data.suggestion} />
      )}
      <Activity events={data.activity} address={data.address} />
    </>
  )
}
