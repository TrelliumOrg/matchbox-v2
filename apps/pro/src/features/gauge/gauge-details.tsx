import { TokenIcon } from "@matchbox/token-icons"
import { LineChart } from "@matchbox/ui/chart"
import { Glyph, shapes } from "@matchbox/ui/icons"
import * as Inspect from "@matchbox/ui/inspect"
import * as ListRow from "@matchbox/ui/list-row"
import * as PropertyIcon from "@matchbox/ui/property-icon"
import type { ReactNode } from "react"
import type { GaugeProfile } from "../../data/view-models"
import {
  formatCompact,
  formatCompactVotes,
  formatDay,
  formatToken,
  formatUsd,
  shortAddress,
  weiToWhole,
} from "../../lib/format"
import { useIsPhone } from "../../lib/phone"
import { SectionHeading } from "../../shell/page"
import { gaugeKinds } from "./kinds"
import { optimalVotes, votesContext } from "./optimal"

/** Gauge profile below the fold: about, strategy, votes chart, incentives. */

export function GaugeDetails({ data }: { data: GaugeProfile }): ReactNode {
  const gauge = data.gauge
  // Null for gauges that are not boost gauges: they have no optimal count.
  const optimal = optimalVotes(gauge)
  const phone = useIsPhone()
  const points = data.votesHistory.map((entry) =>
    Number(weiToWhole(entry.votes)),
  )
  // What the chart reads into the headline on hover, touch or focus.
  const inspect = data.votesHistory.map((entry) => ({
    label: `Epoch ${entry.epoch}`,
    value: `${formatCompactVotes(entry.votes)} ${gauge.votesUnit}`,
  }))
  return (
    <>
      <div className="mt-12 grid gap-10 md:grid-cols-2 md:gap-16">
        <section>
          <SectionHeading>About</SectionHeading>
          <p className="mt-4 text-base text-ink2">
            {data.about ?? gauge.tagline ?? "No profile"}
          </p>
          <PropertyIcon.Group className="mt-4">
            <PropertyIcon.Root name={gaugeKinds[gauge.kind].property} />
            <PropertyIcon.Root name="mainnet" />
          </PropertyIcon.Group>
        </section>
        <section>
          <SectionHeading>Strategy</SectionHeading>
          <dl className="mt-4 flex flex-col gap-4 text-base">
            {data.strategy.map((row) => (
              // On a phone a long value sits under its label, left
              // aligned: right-aligned wrapped text is hard to read.
              <div
                key={row.label}
                className="flex justify-between gap-4 max-sm:flex-col max-sm:gap-1"
              >
                <dt className="text-sec">{row.label}</dt>
                <dd className="text-right max-sm:text-left">{row.value}</dd>
              </div>
            ))}
            {data.owner === null ? null : (
              <div className="flex justify-between gap-4">
                <dt className="text-sec">Owner</dt>
                <dd className="tabular-nums">{shortAddress(data.owner)}</dd>
              </div>
            )}
          </dl>
        </section>
      </div>

      {data.details.length === 0 ? null : (
        <section className="mt-12" data-gauge-facts="">
          <SectionHeading>Details</SectionHeading>
          <dl className="mt-4 grid gap-x-16 gap-y-4 text-base md:grid-cols-2">
            {data.details.map((row) => (
              <div
                key={row.label}
                className="flex justify-between gap-4 max-sm:flex-col max-sm:gap-1"
              >
                <dt className="text-sec">{row.label}</dt>
                <dd className="text-right tabular-nums max-sm:text-left">
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <section className="mt-12" {...Inspect.scope}>
        <SectionHeading>Votes</SectionHeading>
        <p className="mt-2 text-[15px] text-sec tabular-nums">
          <b className="mr-1.5 text-xl font-[650] text-ink">
            <Inspect.Value
              reserve={Inspect.widest([
                formatCompactVotes(gauge.votes),
                ...inspect.map((each) => each.value),
              ])}
            >
              {formatCompactVotes(gauge.votes)}
            </Inspect.Value>
          </b>
          <Inspect.Note
            reserve={Inspect.noteReserve(
              inspect.map((each, index) => ({
                label: each.label,
                n: points[index],
              })),
              true,
            )}
          >
            {votesContext(gauge)}
          </Inspect.Note>
        </p>
        {points.length < 2 ? null : (
          <>
            <LineChart
              id={`gauge-votes-${gauge.address.toLowerCase()}`}
              className="mt-4"
              points={points}
              {...(optimal === null
                ? {}
                : {
                    reference: {
                      value: Number(optimal),
                      label: `Optimal ${formatCompact(optimal)}`,
                    },
                  })}
              label={`Votes over ${points.length} epochs, now ${formatCompactVotes(gauge.votes)} ${votesContext(gauge)}`}
              inspect={inspect}
              readout="figure"
              // The chart scales to its box: drawn 520 wide on a phone,
              // its line and labels come out twice the size.
              width={phone ? 520 : 1040}
              height={210}
            />
            <div
              aria-hidden="true"
              className="mt-1 flex justify-between border-t border-line pt-3 text-[13.5px] text-sec"
            >
              {data.votesHistory.map((entry, index) => (
                <span
                  key={entry.epoch}
                  className={`${index === data.votesHistory.length - 1 ? "font-semibold text-ink" : ""} ${index % 2 === 1 && index !== data.votesHistory.length - 1 ? "max-md:hidden" : ""}`}
                >
                  Epoch {entry.epoch}
                </span>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="mt-12">
        <SectionHeading>Incentives</SectionHeading>
        {data.incentivesHistory.length === 0 ? (
          <p className="mt-4 text-[15px] text-sec">No incentives</p>
        ) : (
          <ListRow.List className="mt-3">
            {data.incentivesHistory.map((entry) => (
              <ListRow.Root key={entry.epoch}>
                <ListRow.Icon>
                  <Glyph shape={shapes.gift} size={20} strokeWidth={1.8} />
                </ListRow.Icon>
                <ListRow.Text>
                  <ListRow.Title>Epoch {entry.epoch}</ListRow.Title>
                  <ListRow.Subline>
                    {entry.paid ? "Paid" : "Pays"} {formatDay(entry.paysAt)}
                  </ListRow.Subline>
                </ListRow.Text>
                <ListRow.Value>
                  <ListRow.Main>{formatUsd(entry.usd, "cents")}</ListRow.Main>
                  {entry.tokens.map((token) => (
                    <ListRow.Sub
                      key={token.symbol}
                      className="flex items-center justify-end gap-1.5"
                    >
                      <TokenIcon ticker={token.symbol} size={18} />
                      {formatToken(token.amount, token.symbol)}
                    </ListRow.Sub>
                  ))}
                </ListRow.Value>
              </ListRow.Root>
            ))}
          </ListRow.List>
        )}
      </section>
    </>
  )
}
