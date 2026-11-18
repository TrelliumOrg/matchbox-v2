import { MorphText } from "@matchbox/motion"
import { TokenIcon } from "@matchbox/token-icons"
import { Glyph, shapes } from "@matchbox/ui/icons"
import type { ReactNode } from "react"
import { island } from "../../components/island"
import { Usd } from "../../components/money"
import type { Protocol } from "../../data/view-models"
import {
  formatApy,
  formatCompact,
  formatCompactVotes,
  formatDecimal,
  formatSignedUsd,
} from "../../lib/format"
import { PageTitle } from "../../shell/page"

/** Protocol (`jUbWoLBGiB`): Mezo Earn for everyone, one epoch at a time. */

const Details = island("protocol-details", () =>
  import("./protocol-details").then((module) => module.ProtocolDetails),
)

/** A stat; its figure and subline morph between epochs. */
function Stat({
  label,
  value,
  icon,
  sub,
}: {
  label: string
  value: string
  icon?: ReactNode
  sub?: string
}): ReactNode {
  return (
    <div className="min-w-0 border-line py-1 not-first:border-l not-first:pl-6 max-md:odd:border-l-0 max-md:odd:pl-0">
      <dt className="text-[14.5px] text-sec">{label}</dt>
      <dd className="mt-1 flex items-center gap-2 text-[22px] font-[650] tracking-[-0.015em] tabular-nums">
        {icon}
        <MorphText>{value}</MorphText>
      </dd>
      {sub === undefined ? null : (
        <dd className="mt-0.5 text-[13.5px] text-sec">
          <MorphText>{sub}</MorphText>
        </dd>
      )}
    </div>
  )
}

export function ProtocolView({
  data,
  now,
  onEpoch,
}: {
  data: Protocol
  now: number
  onEpoch: (epoch: number) => void
}): ReactNode {
  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <PageTitle>Protocol</PageTitle>
        <div className="mt-6 flex h-11 items-center rounded-[22px] bg-soft p-1 shadow-[inset_0_0_0_1px_var(--edge)]">
          <button
            type="button"
            aria-label="Previous epoch"
            disabled={!data.browsableEpochs.includes(data.epoch - 1)}
            onClick={() => onEpoch(data.epoch - 1)}
            data-tap=""
            className="grid size-9 cursor-pointer place-items-center rounded-full bg-raised text-ink outline-none focus-visible:outline-2 focus-visible:outline-ink disabled:cursor-default disabled:bg-transparent disabled:text-mut"
          >
            <Glyph shape={shapes.chevronLeft} size={18} />
          </button>
          <MorphText className="px-3 text-[15px] font-semibold tabular-nums">
            {`Epoch ${data.epoch}`}
          </MorphText>
          <button
            type="button"
            aria-label="Next epoch"
            disabled={!data.browsableEpochs.includes(data.epoch + 1)}
            onClick={() => onEpoch(data.epoch + 1)}
            data-tap=""
            className="grid size-9 cursor-pointer place-items-center rounded-full bg-raised text-ink outline-none focus-visible:outline-2 focus-visible:outline-ink disabled:cursor-default disabled:bg-transparent disabled:text-mut"
          >
            <Glyph shape={shapes.chevronRight} size={18} />
          </button>
        </div>
      </div>

      <section aria-label="Incentives this epoch" className="mt-8">
        <h2 className="text-base text-sec">Incentives this epoch</h2>
        <p className="mt-1 text-[40px] leading-[1.15] font-[650] tracking-[-0.025em] tabular-nums md:text-[44px]">
          <Usd
            value={data.incentivesUsd}
            style="cents"
            countUp="protocol-incentives"
          />
        </p>
        <p className="mt-1 text-[15px] text-sec tabular-nums">
          <MorphText as="b" className="font-semibold text-ink">
            {formatSignedUsd(data.incentivesChangeUsd, "cents")}
          </MorphText>{" "}
          <MorphText>{`vs Epoch ${data.epoch - 1}`}</MorphText>
        </p>
      </section>

      <dl className="mt-7 grid grid-cols-2 gap-y-5 border-y border-line py-5 md:grid-cols-4">
        <Stat
          label="veMEZO locked"
          value={formatCompactVotes(data.stats.veMezoLocked)}
          sub={`${data.stats.lockers.toLocaleString("en-US")} lockers`}
        />
        <Stat
          label="veBTC locked"
          icon={<TokenIcon ticker="BTC" size={20} />}
          value={formatDecimal(data.stats.veBtcLocked, 2)}
          sub={
            data.stats.veBtcLockedUsd === null
              ? "BTC"
              : `$${formatCompact(data.stats.veBtcLockedUsd.split(".")[0] ?? "0")}`
          }
        />
        <Stat
          label="veBTC vote weight"
          value={formatDecimal(data.stats.veBtcVoteWeight, 2)}
          sub={`${data.stats.votesThisEpoch.toLocaleString("en-US")} ${data.stats.votesThisEpoch === 1 ? "vote" : "votes"} this epoch`}
        />
        <Stat
          label="Median APY"
          value={
            data.stats.medianApyBps === null
              ? "None"
              : formatApy(data.stats.medianApyBps)
          }
          sub="Funded gauges"
        />
      </dl>

      <Details data={data} now={now} onEpoch={onEpoch} />
    </>
  )
}
