import { TokenIcon } from "@matchbox/token-icons"
import { shapes } from "@matchbox/ui/icons"
import * as ListRow from "@matchbox/ui/list-row"
import * as PillButton from "@matchbox/ui/pill-button"
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { ActivityRow } from "../../components/activity-row"
import { ClaimableAsOfNote } from "../../components/claimable-as-of"
import { Coins } from "../../components/coins"
import { Usd } from "../../components/money"
import type { Rewards } from "../../data/view-models"
import { formatDay, formatTokenWithSymbol, formatUsd } from "../../lib/format"
import { gaugeName } from "../../lib/gauge-name"
import { useViewer } from "../../lib/viewer"
import { useLive } from "../../live/live-context"
import { PageTitle, SectionHeading, underlineLink } from "../../shell/page"
import { EmptyState } from "../../shell/states"
import { openClaim } from "../../tx/open-claim"
import { txIntent } from "../../tx/tx-store"

/**
 * Rewards (`J30sYt2hvm`, cleaned up in `5bSm_Ziy3T`) and nothing to claim
 * (`D6mDhewGde`). Where rewards come from is a list, not cards.
 */

function isZero(value: string): boolean {
  return !/[1-9]/.test(value)
}

/** ", Epoch 38 to 47", ", Epoch 47", or nothing without epochs. */
export function earnedRange(earned: Rewards["earned"]): string {
  const { fromEpoch, toEpoch } = earned
  if (fromEpoch === null && toEpoch === null) return ""
  if (fromEpoch === null || toEpoch === null || fromEpoch === toEpoch) {
    return `, Epoch ${fromEpoch ?? toEpoch}`
  }
  return `, Epoch ${fromEpoch} to ${toEpoch}`
}

/** Where a lock's rewards come from: its gauges, the lock, the amount. */
function Source({
  entry,
  claim,
}: {
  entry: Rewards["locks"][number]
  /** Per lock claiming, only when there is more than one lock. */
  claim: boolean
}): ReactNode {
  const viewer = useViewer()
  const symbol = entry.lock.kind === "vebtc" ? "BTC" : "MEZO"
  const label = `${entry.lock.kind === "vebtc" ? "veBTC" : "veMEZO"} #${entry.lock.tokenId}`
  const gauges = entry.gauges.filter((gauge) => !isZero(gauge.usd))
  return (
    <ListRow.Root>
      <ListRow.Icon>
        <TokenIcon ticker={symbol} size={48} />
      </ListRow.Icon>
      <ListRow.Text>
        <ListRow.Title>
          {gauges.length === 0
            ? label
            : gauges.map((gauge) => gaugeName(gauge)).join(", ")}
        </ListRow.Title>
        {gauges.length === 0 ? null : (
          <ListRow.Subline>{label}</ListRow.Subline>
        )}
      </ListRow.Text>
      <ListRow.Value>
        <ListRow.Main>{formatUsd(entry.usd, "cents")}</ListRow.Main>
        <ListRow.Sub>
          {/* One token reads as text; several stack as coins, so a row never
              outgrows a phone. */}
          {entry.tokens.length === 1 && entry.tokens[0] !== undefined ? (
            formatTokenWithSymbol(
              entry.tokens[0].amount,
              entry.tokens[0].symbol,
            )
          ) : (
            <Coins tokens={entry.tokens} label={`${label} tokens`} />
          )}
        </ListRow.Sub>
      </ListRow.Value>
      {claim ? (
        <PillButton.Root
          intent="neutral"
          size="sm"
          className="ml-1 flex-none bg-soft"
          aria-label={`Claim ${label}`}
          {...txIntent}
          onClick={() =>
            void openClaim(viewer, { relock: false, only: entry.lock })
          }
        >
          Claim
        </PillButton.Root>
      ) : null}
    </ListRow.Root>
  )
}

export function RewardsView({ data }: { data: Rewards }): ReactNode {
  const viewer = useViewer()
  const nothing = isZero(data.claimable.usd)
  const { market } = useLive()
  const claims = data.history.filter((event) => event.detail.kind === "claim")
  // With nothing left to claim, the projection is the headline.
  const takeover = nothing ? data.projected : null
  const sources = nothing
    ? []
    : data.locks.filter((entry) => !isZero(entry.usd))
  return (
    <>
      <PageTitle>Rewards</PageTitle>
      <section aria-label="Claimable" className="mt-9">
        <h2 className="text-base text-sec">
          {takeover !== null
            ? `Projected, Epoch ${takeover.epoch}`
            : nothing
              ? "Ready to claim"
              : `Ready to claim, Epoch ${data.claimable.epoch}`}
        </h2>
        <p
          className={`mt-1 text-[40px] leading-[1.15] font-[650] tracking-[-0.025em] tabular-nums md:text-[44px] ${nothing && takeover === null ? "text-mut" : ""}`}
        >
          <Usd
            value={takeover === null ? data.claimable.usd : takeover.usd}
            style="cents"
            countUp="rewards-claimable"
          />
        </p>
        {takeover === null ? (
          <ClaimableAsOfNote asOf={data.claimableAsOf} className="mt-1" />
        ) : null}
        {nothing ? (
          takeover === null ? null : (
            <p className="mt-2 text-[15px] text-sec tabular-nums">
              Pays{" "}
              <b className="font-semibold text-ink">
                {formatDay(takeover.paysAt)}
              </b>
            </p>
          )
        ) : (
          <ul
            aria-label="Tokens"
            className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-base text-ink2 tabular-nums"
          >
            {data.claimable.tokens.map((token) => (
              <li key={token.symbol} className="flex items-center gap-2">
                <TokenIcon ticker={token.symbol} size={20} />
                {formatTokenWithSymbol(token.amount, token.symbol)}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-6 flex flex-wrap gap-2.5">
          {nothing ? (
            <PillButton.Root disabled>Nothing to claim</PillButton.Root>
          ) : (
            <>
              <PillButton.Root
                {...txIntent}
                onClick={() => void openClaim(viewer, { relock: false })}
              >
                Claim all
              </PillButton.Root>
              <PillButton.Root
                intent="secondary"
                {...txIntent}
                onClick={() => void openClaim(viewer, { relock: true })}
              >
                Claim and relock
              </PillButton.Root>
            </>
          )}
        </div>
        {nothing ? null : data.projected === null ? (
          <p className="mt-6 text-[15px] text-sec tabular-nums">
            Epoch {market.epoch.number} pays{" "}
            <b className="font-semibold text-ink">
              {formatDay(market.epoch.endsAt)}
            </b>
          </p>
        ) : (
          <p className="mt-6 flex flex-wrap gap-x-7 gap-y-1 text-[15px] text-sec tabular-nums">
            <span>
              Projected, Epoch {data.projected.epoch}{" "}
              <b className="ml-1 font-semibold text-ink">
                {formatUsd(data.projected.usd, "cents")}
              </b>
            </span>
            <span>
              Pays{" "}
              <b className="ml-1 font-semibold text-ink">
                {formatDay(data.projected.paysAt)}
              </b>
            </span>
          </p>
        )}
        {/* The API sends a zero placeholder until claim history is summed. */}
        {isZero(data.earned.usd) ? null : (
          <p className="mt-2 text-[15px] text-sec tabular-nums">
            Earned{" "}
            <b className="font-semibold text-ink">
              {formatUsd(data.earned.usd, "cents")}
            </b>
            {earnedRange(data.earned)}
          </p>
        )}
      </section>
      {sources.length === 0 ? null : (
        <section className="mt-12 md:max-w-[688px]">
          <SectionHeading>From</SectionHeading>
          <ListRow.List className="mt-2">
            {sources.map((entry) => (
              <Source
                key={`${entry.lock.kind}-${entry.lock.tokenId}`}
                entry={entry}
                claim={sources.length > 1}
              />
            ))}
          </ListRow.List>
        </section>
      )}
      <section className="mt-12">
        <SectionHeading
          action={
            claims.length === 0 ? null : (
              <Link
                to="/activity"
                search={{ filter: "claims" }}
                className={underlineLink}
              >
                See all
              </Link>
            )
          }
        >
          History
        </SectionHeading>
        {claims.length === 0 ? (
          <EmptyState icon={shapes.gift} title="No claims" variant="plain" />
        ) : (
          <ListRow.List className="mt-3">
            {claims.map((event) => (
              <ActivityRow key={event.id} event={event} context="summary" />
            ))}
          </ListRow.List>
        )}
      </section>
    </>
  )
}
