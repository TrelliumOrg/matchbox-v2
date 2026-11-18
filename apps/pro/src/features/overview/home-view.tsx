import * as CoinStack from "@matchbox/ui/coin-stack"
import * as GaugeCard from "@matchbox/ui/gauge-card"
import { Glyph, type GlyphShape, shapes } from "@matchbox/ui/icons"
import * as ListRow from "@matchbox/ui/list-row"
import * as PillButton from "@matchbox/ui/pill-button"
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { CoinMarks } from "../../components/coins"
import { Usd } from "../../components/money"
import type { Home } from "../../data/view-models"
import {
  formatApy,
  formatCompactVotes,
  formatUsd,
  weiToWhole,
} from "../../lib/format"
import { gaugeName } from "../../lib/gauge-name"
import { SectionHeading, underlineLink } from "../../shell/page"

/** Overview signed out (`LgSH7Lrsvk`): protocol figures, top gauges, how it works. */

function percentOf(part: string, whole: string): string {
  const total = BigInt(whole)
  if (total === 0n) return "0%"
  return `${(weiToWhole(part) * 100n) / weiToWhole(whole)}%`
}

function Step({
  icon,
  label,
  coins,
}: {
  icon: GlyphShape
  label: string
  coins?: ReactNode
}): ReactNode {
  return (
    <li className="flex h-[88px] items-center gap-3.5 rounded-[24px] bg-soft px-5 shadow-[inset_0_0_0_1px_var(--edge)]">
      <span className="grid size-12 flex-none place-items-center rounded-full bg-raised text-ink">
        <Glyph shape={icon} size={20} strokeWidth={1.8} />
      </span>
      <span className="text-base font-semibold">{label}</span>
      {coins === undefined ? null : <span className="ml-auto">{coins}</span>}
    </li>
  )
}

export function HomeView({ data }: { data: Home }): ReactNode {
  return (
    <div className="max-w-[800px]">
      <section className="mt-6 flex flex-wrap gap-x-[72px] gap-y-6 md:mt-9">
        <div>
          <h1 className="text-base text-sec">Incentives this epoch</h1>
          <p className="mt-1 text-[40px] leading-[1.15] font-[650] tracking-[-0.025em] tabular-nums md:text-[44px]">
            <Usd
              value={data.incentivesUsd}
              style="whole"
              countUp="home-incentives"
            />
          </p>
          <p className="mt-1 text-[15px] text-sec">
            {data.gaugesFunded} of {data.gaugesTotal} gauges funded
          </p>
        </div>
        <div>
          <h2 className="text-base text-sec">veMEZO voted</h2>
          <p className="mt-1 text-[40px] leading-[1.15] font-[650] tracking-[-0.025em] tabular-nums md:text-[44px]">
            <span data-count-up="home-vemezo-voted">
              {formatCompactVotes(data.veMezoVoted)}
            </span>
            <span className="ml-2 text-[22px] font-semibold tracking-normal text-sec">
              of {formatCompactVotes(data.veMezoLocked)}
            </span>
          </p>
          <p className="mt-1 text-[15px] text-sec">
            {percentOf(data.veMezoVoted, data.veMezoLocked)} of locked MEZO
          </p>
        </div>
      </section>
      <PillButton.Root asChild intent="secondary" className="mt-6">
        <Link to="/vote">Browse gauges</Link>
      </PillButton.Root>
      <section className="mt-14">
        <SectionHeading
          action={
            <Link to="/vote" className={underlineLink}>
              See all {data.gaugesTotal}
            </Link>
          }
        >
          Top gauges
        </SectionHeading>
        <ListRow.List className="mt-3">
          {data.topGauges.map((gauge) => (
            <ListRow.Root key={gauge.address} asChild>
              <li>
                <Link
                  to="/gauges/$address"
                  params={{ address: gauge.address }}
                  className="flex w-full items-center gap-4 outline-none"
                >
                  <GaugeCard.Picture picture={gauge.picture} size={48} />
                  <ListRow.Text>
                    <ListRow.Title>{gaugeName(gauge)}</ListRow.Title>
                    <ListRow.Subline>
                      {gauge.optimalVotes === null
                        ? `${formatCompactVotes(gauge.votes)} ${gauge.votesUnit}`
                        : `${formatCompactVotes(gauge.votes)} of ${formatCompactVotes(gauge.optimalVotes)} ${gauge.votesUnit}`}
                    </ListRow.Subline>
                  </ListRow.Text>
                  <ListRow.Value>
                    <ListRow.Main>
                      {gauge.apyBps === null
                        ? "No incentives"
                        : `${formatApy(gauge.apyBps)} APY`}
                    </ListRow.Main>
                    <ListRow.Sub className="flex items-center justify-end gap-1.5">
                      <CoinMarks symbols={gauge.incentiveTokens} />
                      {formatUsd(gauge.incentivesUsd, "cents")}
                    </ListRow.Sub>
                  </ListRow.Value>
                </Link>
              </li>
            </ListRow.Root>
          ))}
        </ListRow.List>
      </section>
      <section className="mt-14">
        <SectionHeading>How it works</SectionHeading>
        <ol className="mt-5 grid gap-4 md:grid-cols-3">
          <Step
            icon={shapes.lock}
            label="Lock"
            coins={
              <CoinStack.Root
                coins={[{ ticker: "BTC" }, { ticker: "MEZO" }]}
                size={28}
                surface="var(--soft)"
                decorative
              />
            }
          />
          <Step icon={shapes.vote} label="Vote" />
          <Step icon={shapes.gift} label="Claim" />
        </ol>
      </section>
    </div>
  )
}
