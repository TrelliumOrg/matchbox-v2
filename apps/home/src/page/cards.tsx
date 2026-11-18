import { TokenIcon } from "@matchbox/token-icons"
import { Icon, type IconName } from "@matchbox/ui/icons"
import * as Inspect from "@matchbox/ui/inspect"
import * as Lockup from "@matchbox/ui/lockup"
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react"
import {
  asOfAt,
  asOfText,
  cardGroups,
  compactAmount,
  epochView,
  type NumberFormat,
  numeric,
  oneDecimal,
  type ProGauge,
  type Series,
  type SeriesDays,
  sparkPaths,
  sparkPoint,
  twoPlaces,
  txnsUnit,
  usdFormat,
  votesFormat,
  wholeNumber,
} from "../data/figures"
import { BlockGlyph } from "./glyphs"
import { links } from "./links"
import { LiveNumber, LiveText, Slot, useFigures } from "./live"

/**
 * The two equal cards (frames `hf-pro` and `hf-scan`): Matchbox Pro's
 * epoch, incentives and the three gauges with the most incentives, and
 * Matchscan's search, borrowed, veBTC locked and latest blocks.
 */

/** U+00A0, written so it can be seen. */
const noBreak = String.fromCharCode(0xa0)

/** The browser's clock, ticking on the minute, after the server's at first. */
function useMinuteClock(renderedAt: number): number {
  const [now, setNow] = useState(renderedAt)
  useEffect(() => {
    setNow(Date.now())
    let timer: ReturnType<typeof setTimeout>
    const tick = (): void => {
      timer = setTimeout(
        () => {
          setNow(Date.now())
          tick()
        },
        60_000 - (Date.now() % 60_000),
      )
    }
    tick()
    return () => clearTimeout(timer)
  }, [])
  return now
}

const noGrouping: NumberFormat = { useGrouping: false }

/**
 * The card's "As of" note: the oldest of its figures that is past its
 * threshold (figures.ts, `staleAfterMs`), once the first fresh request
 * has had its chance. The last time shown stays in the text while the
 * note fades out, so the fade never shows an empty row changing.
 */
function AsOf({
  card,
  now,
  label,
}: {
  card: keyof typeof cardGroups
  now: number
  label: string
}): ReactNode {
  const { figures, waiting } = useFigures()
  // The visitor's time zone is the browser's: the text is written only
  // once hydrated, in space the row always keeps.
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => setHydrated(true), [])
  const since = hydrated
    ? asOfAt(figures.at, cardGroups[card], now, waiting)
    : null
  const lastShown = useRef<number | null>(null)
  if (since !== null) lastShown.current = since
  const text = lastShown.current
  return (
    <span
      className="asof"
      data-live={label}
      data-shown={since === null ? "false" : "true"}
      aria-hidden={since === null}
    >
      {text === null ? "" : asOfText(text, now)}
    </span>
  )
}

function Usd({ value }: { value: string }): ReactNode {
  const decimal = numeric(value)
  if (decimal === null) return <span className="na">Not available</span>
  return <LiveNumber value={decimal} format={usdFormat(value)} />
}

const kindIcon: Record<ProGauge["kind"], { icon: IconName; label: string }> = {
  pool: { icon: "droplets", label: "Pool gauge" },
  vebtc: { icon: "lock", label: "veBTC gauge" },
  validator: { icon: "server", label: "Validator gauge" },
  mezo: { icon: "globe", label: "MEZO gauge" },
}

function GaugePicture({ gauge }: { gauge: ProGauge }): ReactNode {
  const picture = gauge.picture
  if (picture.type === "pair") {
    return (
      <span className="pic pair swap-in" key={gauge.address}>
        <TokenIcon ticker={picture.tokens[0].symbol} size={27} />
        <TokenIcon ticker={picture.tokens[1].symbol} size={27} />
      </span>
    )
  }
  if (picture.type === "image") {
    return (
      <span className="pic one swap-in" key={gauge.address}>
        <img src={picture.url} alt="" width={40} height={40} loading="lazy" />
      </span>
    )
  }
  return (
    <span className="pic one swap-in" key={gauge.address}>
      <span className="initials">{picture.text}</span>
    </span>
  )
}

function GaugeRow({
  gauge,
  rank,
}: {
  gauge: ProGauge
  rank: number
}): ReactNode {
  const kind = kindIcon[gauge.kind]
  const votes = numeric(gauge.votes)
  return (
    <div className="gr">
      <GaugePicture gauge={gauge} />
      <div style={{ minWidth: 0 }}>
        <div className="nm" data-live={`pro.gauge${rank}.name`}>
          <LiveText>{gauge.name}</LiveText>
        </div>
        <div className="ss">
          <span title={kind.label}>
            <span className="sr-only">{kind.label}</span>
            <Icon
              name={kind.icon}
              size={15}
              strokeWidth={1.75}
              className="ic"
            />
          </span>
          <span data-live={`pro.gauge${rank}.votes`}>
            {votes === null ? (
              "Not available"
            ) : (
              <LiveNumber
                value={votes}
                format={votesFormat(gauge.votes, gauge.votesUnit)}
              />
            )}{" "}
            {gauge.votesUnit}
          </span>
        </div>
      </div>
      <div className="iv">
        <span className="cs swap-in" key={gauge.tokens.join(",")}>
          {gauge.tokens.map((symbol) => (
            <TokenIcon key={symbol} ticker={symbol} size={20} />
          ))}
        </span>
        <span data-live={`pro.gauge${rank}.incentives`}>
          <Usd value={gauge.incentivesUsd} />
        </span>
      </div>
    </div>
  )
}

export function ProCard({ renderedAt }: { renderedAt: number }): ReactNode {
  const { figures } = useFigures()
  const now = useMinuteClock(renderedAt)
  const epoch = epochView(now)
  const { incentivesUsd, gauges } = figures.pro
  return (
    <article className="hc" aria-labelledby="pro-title">
      <div className="strip s-pro" />
      <div className="bd">
        <h2 id="pro-title" className="sr-only">
          Matchbox Pro
        </h2>
        <Lockup.Pro height={32} aria-hidden="true" />
        <p className="line">Lock, vote on gauges and claim rewards.</p>
        <div className="act">
          <a className="pill p1" href={links.pro}>
            Open Pro
          </a>
        </div>
      </div>
      <section
        className="scr"
        aria-label="This epoch on Matchbox Pro: incentives and the gauges with the most incentives"
      >
        <div className="ep">
          <div className="rt">
            <span>
              <TokenIcon ticker="MEZO" size={22} className="coin" />
              <b>
                Epoch{" "}
                <span data-computed="epoch.number">
                  <LiveNumber value={epoch.number} format={noGrouping} />
                </span>
              </b>
            </span>
            <span className="cd">
              Closes in{" "}
              <b data-computed="epoch.countdown">
                <LiveText>{epoch.countdown}</LiveText>
              </b>
            </span>
          </div>
          <div className="rb">
            <div className="k">Incentives this epoch</div>
            <div className="bf" data-live="pro.incentivesTotal">
              <Slot has={incentivesUsd !== null}>
                {() => <Usd value={incentivesUsd ?? ""} />}
              </Slot>
            </div>
            <div className="lh">
              <span>Most incentives</span>
              <AsOf card="pro" now={now} label="pro.asOf" />
            </div>
            {gauges === null || gauges.length === 0 ? (
              <div className="gr">
                <span className="na" style={{ gridColumn: "1 / -1" }}>
                  Not available
                </span>
              </div>
            ) : (
              gauges.map((gauge, index) => (
                // Rows never reorder: each slot takes its new gauge in place.
                // biome-ignore lint/suspicious/noArrayIndexKey: the slot is the row
                <GaugeRow key={index} gauge={gauge} rank={index + 1} />
              ))
            )}
          </div>
        </div>
      </section>
    </article>
  )
}

/**
 * A stat's 30 days. With each day's text (`days`), hovering, touching or
 * focusing it reads the day into the stat's figure and subline, and the
 * arrow keys move between days (`@matchbox/ui/inspect`).
 */
function Sparkline({
  series,
  days,
  shape,
  tone,
  label,
  name,
}: {
  series: Series | null
  days: SeriesDays | null
  shape: "step" | "line"
  tone: "ink" | "acc"
  label: string
  /** The chart's accessible name: "Borrowed, last 30 days". */
  name: string
}): ReactNode {
  Inspect.useInspect(
    series !== null &&
      days !== null &&
      days.length === series.length &&
      days.filter((day) => day !== null).length > 1,
  )
  if (series === null) return null
  const paths = sparkPaths(series, shape)
  const coords: [number, number][] = []
  const read: Inspect.InspectPoint[] = []
  const numbers: number[] = []
  series.forEach((value, index) => {
    const day = days?.[index]
    if (value === null || day === null || day === undefined) return
    coords.push(sparkPoint(index, series.length, value))
    read.push({ label: day.label, value: day.text })
    numbers.push(value)
  })
  const live = days !== null && days.length === series.length && read.length > 1
  return (
    <svg
      className="sp"
      viewBox="0 0 300 44"
      preserveAspectRatio="none"
      role="img"
      aria-label={name}
      aria-hidden={live ? undefined : true}
      data-live={label}
      {...(live ? { tabIndex: 0, ...Inspect.root("x", "figure", false) } : {})}
    >
      <path d={paths.area} className={`fill-${tone}`} />
      <path
        d={paths.line}
        className={`line-${tone}`}
        fill="none"
        strokeWidth={1.8}
        vectorEffect="non-scaling-stroke"
      />
      {live ? (
        <Inspect.LinePoints
          coords={coords}
          points={read}
          values={numbers}
          top={0}
          bottom={44}
          dot={false}
        />
      ) : null}
    </svg>
  )
}

/** The widest day a stat's sparkline can read into its figure. */
function widestDay(days: SeriesDays | null): string | undefined {
  if (days === null) return undefined
  return Inspect.widest(days.map((day) => day?.text ?? ""))
}

/** "/" focuses the search field, as on Matchscan, unless typing elsewhere. */
function useSlashFocus(): RefObject<HTMLInputElement | null> {
  const ref = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) {
        return
      }
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      ) {
        return
      }
      event.preventDefault()
      ref.current?.focus()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [])
  return ref
}

export function ScanCard({ renderedAt }: { renderedAt: number }): ReactNode {
  const { figures } = useFigures()
  const searchRef = useSlashFocus()
  const now = useMinuteClock(renderedAt)
  const scan = figures.scan
  const borrowed =
    scan.borrowedMusd === null ? null : compactAmount(scan.borrowedMusd)
  return (
    <article className="hc" aria-labelledby="scan-title">
      <div className="strip s-scan" />
      <div className="bd">
        <h2 id="scan-title" className="sr-only">
          Matchscan
        </h2>
        <Lockup.Root product="scan" height={32} aria-hidden="true" />
        <p className="line">Every block, lock and loan on Mezo.</p>
        <div className="act">
          <search>
            <form className="sf" action={links.scanSearch} method="get">
              <Icon name="search" size={20} strokeWidth={2} className="ic" />
              <input
                ref={searchRef}
                type="search"
                name="q"
                placeholder="Address or transaction"
                aria-label="Search Matchscan"
                autoComplete="off"
                spellCheck={false}
              />
              <kbd title="Press / to search">/</kbd>
            </form>
          </search>
          <a className="pill p1 open" href={links.scan}>
            Open Matchscan
          </a>
        </div>
      </div>
      <section
        className="scr ms"
        aria-label="Mezo now on Matchscan: borrowed, veBTC locked and the latest blocks"
      >
        <div className="sts">
          <div className="st st-borrowed" {...Inspect.scope}>
            <div className="h">
              <TokenIcon
                ticker="MUSD"
                size={32}
                // 30 on the phone (styles.css): the icon sizes itself inline.
                style={{
                  width: "var(--stat-icon)",
                  height: "var(--stat-icon)",
                }}
              />
              Borrowed
            </div>
            <div className="v" data-live="scan.borrowed">
              <Inspect.Value reserve={widestDay(scan.borrowedDays)}>
                <Slot has={borrowed !== null}>
                  {() =>
                    borrowed === null ? null : (
                      // In MUSD, not dollars: nothing prices MUSD (README).
                      <>
                        <LiveNumber
                          value={borrowed.value}
                          format={borrowed.format}
                          suffix={borrowed.suffix}
                        />
                        &nbsp;MUSD
                      </>
                    )
                  }
                </Slot>
              </Inspect.Value>
            </div>
            <div className="s">
              <Inspect.Note>
                {borrowed === null || scan.borrowedEnclaves === null ? null : (
                  <>
                    <span data-live="scan.borrowedEnclaves">
                      <LiveNumber
                        value={numeric(scan.borrowedEnclaves) ?? 0}
                        format={oneDecimal}
                      />
                      %
                    </span>{" "}
                    in Enclaves
                  </>
                )}
              </Inspect.Note>
            </div>
            <Sparkline
              series={borrowed === null ? null : scan.borrowedSeries}
              days={scan.borrowedDays}
              shape="step"
              tone="ink"
              label="scan.borrowedSeries"
              name="Borrowed, last 30 days"
            />
          </div>
          <div className="st" {...Inspect.scope}>
            <div className="h">
              <span>
                <Icon name="lock" size={16} strokeWidth={1.9} className="ic" />
              </span>
              veBTC locked
            </div>
            <div className="v" data-live="scan.vebtcLocked">
              <Inspect.Value reserve={widestDay(scan.vebtcDays)}>
                <Slot has={scan.vebtcLocked !== null}>
                  {() => (
                    <>
                      <LiveNumber
                        value={numeric(scan.vebtcLocked ?? "") ?? 0}
                        format={twoPlaces}
                      />
                      &nbsp;BTC
                    </>
                  )}
                </Slot>
              </Inspect.Value>
            </div>
            <div className="s" data-live="scan.vebtcLockedUsd">
              <Inspect.Note>
                {scan.vebtcLockedUsd === null ? null : (
                  <Usd value={scan.vebtcLockedUsd} />
                )}
              </Inspect.Note>
            </div>
            <Sparkline
              series={scan.vebtcSeries}
              days={scan.vebtcDays}
              shape="line"
              tone="acc"
              label="scan.vebtcSeries"
              name="veBTC locked, last 30 days"
            />
          </div>
        </div>
        <div className="blk">
          <div className="lh">
            <span>Latest blocks</span>
            <AsOf card="scan" now={now} label="scan.asOf" />
          </div>
          {scan.blocks === null || scan.blocks.length === 0 ? (
            <div className="br">
              <span className="na" style={{ gridColumn: "1 / -1" }}>
                Not available
              </span>
            </div>
          ) : (
            scan.blocks.map((block, index) => (
              // Rows never insert or slide: each slot takes its new block.
              // biome-ignore lint/suspicious/noArrayIndexKey: the slot is the row
              <div className="br" key={index}>
                <span className="bi">
                  <BlockGlyph />
                </span>
                <div style={{ minWidth: 0 }}>
                  <div
                    className="n"
                    data-live={`scan.block${index + 1}.number`}
                  >
                    <LiveNumber value={block.number} format={wholeNumber} />
                  </div>
                  {/*
                   * The validator's name, else its short address. A long
                   * name ends in an ellipsis on one line (styles.css), in
                   * full on hover. No-break spaces keep the morph's
                   * pieces letters, so it cuts where the plain text did.
                   */}
                  <div
                    className="s"
                    data-live={`scan.block${index + 1}.validator`}
                    title={block.proposer}
                  >
                    <LiveText>
                      {block.proposer.replaceAll(" ", noBreak)}
                    </LiveText>
                  </div>
                </div>
                <div className="a" data-live={`scan.block${index + 1}.txns`}>
                  {/* As wide as three digits, so 9 to 10 moves nothing. */}
                  <span className="tc">
                    <LiveNumber
                      value={block.transactions}
                      format={wholeNumber}
                    />
                  </span>{" "}
                  {/*
                   * Both words are always there, in one cell as wide as
                   * "txns"; only which one is visible changes. Changing the
                   * text of a right-aligned word moves where it starts,
                   * which counts as a layout shift.
                   */}
                  <span className="tu">
                    {(["txn", "txns"] as const).map((unit) => (
                      <span
                        key={unit}
                        aria-hidden={txnsUnit(block.transactions) !== unit}
                      >
                        {unit}
                      </span>
                    ))}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </article>
  )
}
