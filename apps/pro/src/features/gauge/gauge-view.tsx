import { StuartMark } from "@matchbox/stuart-ui/launcher"
import * as GaugeCard from "@matchbox/ui/gauge-card"
import { boostLabel } from "@matchbox/ui/gauge-card"
import { Glyph, type GlyphShape, shapes } from "@matchbox/ui/icons"
import * as PillButton from "@matchbox/ui/pill-button"
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { loadCalculator } from "../../boost/calc-mount"
import { island } from "../../components/island"
import type { GaugeProfile } from "../../data/view-models"
import { useMountedAfterHydration } from "../../lib/app-ready"
import {
  formatApy,
  formatCompact,
  formatCompactVotes,
  formatUsd,
  shortAddress,
  weiToWhole,
} from "../../lib/format"
import { useViewer } from "../../lib/viewer"
import { underlineLink } from "../../shell/page"
import { askAboutThis, warmStuart } from "../../stuart"
import { openTx, txIntent } from "../../tx/tx-store"
import { toggleWatching, useWatching } from "../../watchlist/watch-store"
import { BackToVote } from "./back-to-list"
import { gaugeCalcSearch } from "./gauge-calc"
import { optimalVotes, votesContext } from "./optimal"
import { gaugeTransitionName } from "./transition"

/** Gauge profile (`kR3UwhxYSq`): cover and figures, then the details island. */

const Details = island("gauge-details", () =>
  import("./gauge-details").then((module) => module.GaugeDetails),
)

function Social({
  href,
  icon,
  label,
}: {
  href: string
  icon: GlyphShape
  label: string
}): ReactNode {
  return (
    <a
      href={href}
      aria-label={label}
      className="grid size-10 place-items-center rounded-full bg-raised text-ink outline-none hover:bg-soft2 focus-visible:outline-2 focus-visible:outline-ink"
    >
      <Glyph shape={icon} size={18} strokeWidth={1.8} />
    </a>
  )
}

function Figure({
  label,
  value,
  sub,
  tone = "default",
  countUp,
  action,
}: {
  label: string
  value: string
  sub: string
  tone?: "default" | "positive"
  /** A link under the figure, after its sub line. */
  action?: ReactNode
  /** Session key: the figure counts up the first time it is seen. */
  countUp?: string
}): ReactNode {
  return (
    <div className="min-w-0 border-line not-first:border-l not-first:pl-6 max-md:odd:border-l-0 max-md:odd:pl-0">
      <dt className="text-sm text-sec">{label}</dt>
      <dd
        data-count-up={countUp}
        className="mt-1.5 text-[23px] font-[650] tracking-[-0.015em] tabular-nums"
      >
        {value}
      </dd>
      <dd
        className={`mt-0.5 text-sm tabular-nums ${tone === "positive" ? "text-pos" : "text-sec"}`}
      >
        {sub}
      </dd>
      {action === undefined ? null : <dd className="mt-1 text-sm">{action}</dd>}
    </div>
  )
}

export function GaugeView({
  data,
  epoch,
}: {
  data: GaugeProfile
  epoch: number
}): ReactNode {
  const viewer = useViewer()
  const gauge = data.gauge
  const votes = weiToWhole(gauge.votes)
  // Only boost gauges have a 5x point. A pool, validator or MEZO gauge
  // has no optimal vote count and no boost, so it claims neither.
  const watched = useWatching().includes(gauge.address.toLowerCase())
  const optimal = optimalVotes(gauge)
  const calc = gaugeCalcSearch(gauge)
  const toMax = optimal !== null && optimal > votes ? optimal - votes : 0n
  // Opened from a list after load: the card's picture is in the cache, so
  // it is drawn underneath until the larger one arrives (no blank square,
  // in the view transition too). On a first load there is nothing cached
  // to show, and the server and client must agree.
  const fromList = useMountedAfterHydration()
  const poolLabel = gauge.poolLabel ?? null
  return (
    <>
      <BackToVote kind={gauge.kind} />
      <article className="mt-4 overflow-hidden rounded-[24px] bg-soft shadow-[inset_0_0_0_1px_var(--edge)]">
        <div
          className="flex h-[132px] items-start justify-end px-6 pt-5 text-[15px] font-semibold text-white"
          style={{ background: gauge.color.light }}
        >
          {gauge.tokenId === null ? null : `veBTC #${gauge.tokenId}`}
        </div>
        <div className="px-7 pb-7">
          <div className="-mt-14 flex flex-wrap items-end justify-between gap-4">
            <span className="block rounded-[26px] bg-soft p-1">
              <GaugeCard.Picture
                picture={gauge.picture}
                size={104}
                transitionName={gaugeTransitionName(gauge.address)}
                priority
                {...(fromList ? { placeholderSize: 52 } : {})}
                className="rounded-[22px]"
              />
            </span>
            {/* On a phone the four actions make two even rows: the two that
                act on the gauge, then Ask and the star. */}
            <div className="flex flex-wrap items-center gap-2.5 max-sm:w-full">
              <PillButton.Root
                intent="neutral"
                onPointerEnter={warmStuart}
                onFocus={warmStuart}
                onTouchStart={warmStuart}
                onClick={() =>
                  askAboutThis({
                    type: "gauge",
                    id: gauge.address,
                    label: gauge.name,
                  })
                }
                className="shadow-[inset_0_0_0_1.5px_var(--ink)] max-sm:order-3 max-sm:flex-1 max-sm:justify-center"
              >
                <StuartMark size={18} />
                Ask about this
              </PillButton.Root>
              <PillButton.Root
                asChild
                className="max-sm:order-1 max-sm:flex-1 max-sm:justify-center max-sm:px-3"
              >
                <Link to="/vote">Edit ballot</Link>
              </PillButton.Root>
              <PillButton.Root
                intent="secondary"
                className="max-sm:order-2 max-sm:flex-1 max-sm:justify-center max-sm:px-3 max-sm:whitespace-nowrap"
                {...txIntent}
                onClick={() => openTx(viewer, { flow: "incentives", gauge })}
              >
                Add incentives
              </PillButton.Root>
              <button
                type="button"
                aria-label="Watch"
                aria-pressed={watched}
                onClick={() => toggleWatching(gauge.address)}
                className="grid size-11 flex-none cursor-pointer place-items-center rounded-full bg-raised text-ink outline-none focus-visible:outline-2 focus-visible:outline-ink max-sm:order-4"
              >
                <Glyph
                  shape={shapes.star}
                  size={19}
                  strokeWidth={1.8}
                  className={watched ? "fill-acc text-acc" : ""}
                />
              </button>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
            <div>
              {/* One text block for name and tagline: it is the page's largest element, ahead of the picture. */}
              <h1 className="text-[32px] leading-tight font-[650] tracking-[-0.02em]">
                {gauge.name}
                {poolLabel === null ? null : (
                  <span className="ml-2.5 text-[24px] font-medium tracking-[-0.01em] text-mut">
                    {poolLabel}
                  </span>
                )}
                <br />
                <span className="text-base leading-[2] font-normal tracking-normal text-sec">
                  {gauge.tagline ?? shortAddress(gauge.address)}
                </span>
              </h1>
            </div>
            <div className="flex gap-2">
              {data.links.website === null ? null : (
                <Social
                  href={data.links.website}
                  icon={shapes.globe}
                  label="Website"
                />
              )}
              {data.links.x === null ? null : (
                <Social href={data.links.x} icon={shapes.xLogo} label="X" />
              )}
              {data.links.discord === null ? null : (
                <Social
                  href={data.links.discord}
                  icon={shapes.discord}
                  label="Discord"
                />
              )}
            </div>
          </div>
          <dl
            className={`mt-6 grid grid-cols-2 gap-y-5 rounded-[20px] bg-raised px-6 py-5 ${optimal === null ? "md:grid-cols-3" : "md:grid-cols-4"}`}
          >
            <Figure
              label="APY"
              countUp={`gauge-${gauge.address}-apy`}
              value={gauge.apyBps === null ? "None" : formatApy(gauge.apyBps)}
              sub={
                data.apyChangeBps === null
                  ? `Epoch ${epoch}`
                  : `${data.apyChangeBps >= 0 ? "+" : ""}${formatApy(data.apyChangeBps).replace("%", "")} vs Epoch ${epoch - 1}`
              }
              tone={
                data.apyChangeBps !== null && data.apyChangeBps > 0
                  ? "positive"
                  : "default"
              }
            />
            <Figure
              label="Incentives"
              countUp={`gauge-${gauge.address}-incentives`}
              value={formatUsd(gauge.incentivesUsd, "cents")}
              sub={`Epoch ${epoch}`}
            />
            <Figure
              label="Votes"
              countUp={`gauge-${gauge.address}-votes`}
              value={formatCompactVotes(gauge.votes)}
              sub={votesContext(gauge)}
            />
            {optimal === null ? null : (
              <Figure
                label="Boost"
                countUp={`gauge-${gauge.address}-boost`}
                value={boostLabel(Number(votes), Number(optimal))}
                sub={toMax === 0n ? "At 5×" : `${formatCompact(toMax)} to 5×`}
                {...(calc === null
                  ? {}
                  : {
                      action: (
                        // Opens the calculator over this page with the
                        // gauge's own figures; Back closes it.
                        <Link
                          to="."
                          search={(now) => ({ ...now, ...calc })}
                          resetScroll={false}
                          onPointerEnter={loadCalculator}
                          onFocus={loadCalculator}
                          data-gauge-calculate=""
                          className={underlineLink}
                        >
                          Calculate
                        </Link>
                      ),
                    })}
              />
            )}
          </dl>
        </div>
      </article>

      <Details data={data} />
    </>
  )
}
