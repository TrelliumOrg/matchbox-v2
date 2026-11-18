import { AnimatedNumber } from "@matchbox/motion"
import { type ReactNode, useState } from "react"
import type {
  AllocationDiffBlock,
  BridgeRecordsBlock,
  ClaimReviewBlock,
  ClaimSourceKind,
  ClarificationCardBlock,
  Evidence,
  GaugeExplainBlock,
  GaugeRankingBlock,
  LiquidationScenarioBlock,
  LoanPositionBlock,
  MetricSummaryBlock,
  RepayReviewBlock,
  SupportReportPreviewBlock,
  TokenAmount,
  UiBlock,
  VoteComposerBlock,
  ZapRouteBlock,
} from "./contract"
import {
  formatBoost,
  formatBps,
  formatCompact,
  formatRatio,
  formatShare,
  formatToken,
  formatUsd,
  formatWhole,
  shareBps,
  usdDelta,
} from "./format"
import { CoinRow, GaugeMark } from "./gauge-mark"
import { EntityLink, useHost } from "./host"
import { Glyph } from "./icons"
import { KindIcon, kindForBranch, unitForKind } from "./kind-icon"
import { coinTickers } from "./tokens"

export { GaugeMark } from "./gauge-mark"

/**
 * Answer blocks, from trusted components only, keyed by block type. Names
 * from profiles are untrusted text: React renders them as text, never HTML.
 * Unknown block types render nothing.
 */

function Coins({ addresses }: { addresses: readonly string[] }): ReactNode {
  const tickers = coinTickers(addresses)
  if (tickers.length === 0) return null
  return <CoinRow tickers={tickers} label={tickers.join(", ")} />
}

function KeyValues({
  rows,
}: {
  rows: readonly { key: string; label: string; value: ReactNode }[]
}): ReactNode {
  return (
    <dl className="stuart-kv">
      {rows.map((row) => (
        <div key={row.key}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  )
}

const rankingCaption: Record<GaugeRankingBlock["objective"], string> = {
  best_personal_return: "Best return",
  most_incentives_deposited: "Most incentives",
  most_consistently_funded: "Most consistently funded",
  highest_apy: "Highest APY",
}

const collapsedRows = 6

/**
 * A vote amount in its escrow unit, never "votes" (matchbox-v3 Units):
 * veBTC to 4 decimals, veMEZO compact in tables ("22.15k veMEZO").
 */
export function voteAmount(raw: string, unit: "veMEZO" | "veBTC"): string {
  if (unit === "veBTC") {
    return formatToken({ raw, decimals: 18, symbol: "veBTC" }, 4)
  }
  return `${formatCompact(raw, 18)} veMEZO`
}

function GaugeRanking({ block }: { block: GaugeRankingBlock }): ReactNode {
  const [all, setAll] = useState(false)
  const optimizer = block.objective === "best_personal_return"
  const showApy = block.rows.some((row) => row.apyBps != null)
  const rows = all ? block.rows : block.rows.slice(0, collapsedRows)
  return (
    <div className="stuart-card">
      <table className="stuart-table">
        <caption className="stuart-sr">
          {rankingCaption[block.objective]}, Epoch {block.epoch.number ?? ""}
        </caption>
        <thead>
          <tr>
            <th scope="col">Gauge</th>
            {showApy ? <th scope="col">APY</th> : null}
            <th scope="col">{optimizer ? "Projected" : "Incentives"}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const money = optimizer ? row.projectedUsd : row.depositedUsd
            const kind = row.kind ?? kindForBranch(block.domain.branch)
            const unit = row.votesUnit ?? unitForKind(kind)
            return (
              <tr key={row.targetId}>
                <th scope="row">
                  <span className="stuart-gauge">
                    <GaugeMark
                      picture={row.picture}
                      address={row.targetAddress}
                      name={row.name}
                    />
                    <span className="stuart-gauge-text">
                      <span className="stuart-gauge-title">
                        <EntityLink
                          to={`/gauges/${row.targetAddress}`}
                          className="stuart-gauge-name"
                        >
                          {row.name}
                        </EntityLink>
                        <KindIcon kind={kind} />
                      </span>
                      <span className="stuart-gauge-sub">
                        {row.allocationBps != null
                          ? `Allocation ${formatShare(row.allocationBps)}`
                          : block.objective === "most_consistently_funded" &&
                              row.fundedEpochs !== null &&
                              row.observedEpochs !== null
                            ? `Funded ${row.fundedEpochs} of ${row.observedEpochs} epochs`
                            : voteAmount(row.competingWeight, unit)}
                      </span>
                    </span>
                  </span>
                </th>
                {showApy ? (
                  <td className="stuart-num stuart-strong">
                    {row.apyBps == null ? "" : formatBps(row.apyBps)}
                  </td>
                ) : null}
                <td className="stuart-num">
                  <span className="stuart-money">
                    <Coins addresses={row.incentiveTokens} />
                    {money === null ? "Unpriced" : formatUsd(money)}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {block.rows.length > collapsedRows ? (
        <button
          type="button"
          className="stuart-more"
          aria-expanded={all}
          onClick={() => setAll(!all)}
        >
          {all ? "Show fewer" : `Show all ${block.rows.length}`}
        </button>
      ) : null}
    </div>
  )
}

/** The labelled band from the gauge card: votes toward optimal, boost right. */
function Band({
  weight,
  optimal,
  boostWad,
}: {
  weight: { raw: string; decimals: number }
  optimal: { raw: string; decimals: number } | null
  boostWad: string | null
}): ReactNode {
  const fill = optimal === null ? 0 : shareBps(weight.raw, optimal.raw)
  return (
    <p className="stuart-band" data-optimal={fill >= 10_000 ? "" : undefined}>
      <span
        aria-hidden="true"
        className="stuart-band-fill"
        style={{ transform: `scaleX(${fill / 10_000})` }}
      />
      <span>
        <b>{formatWhole(weight.raw, weight.decimals)}</b>
        {optimal === null
          ? " veMEZO"
          : ` of ${formatCompact(optimal.raw, optimal.decimals)} veMEZO`}
      </span>
      {boostWad === null ? null : <b>{formatBoost(boostWad)}</b>}
    </p>
  )
}

/** The votes on a target, in its unit: "0.8000 veBTC", "42,183,879 veMEZO". */
function weightText(weight: TokenAmount): string {
  if (weight.symbol === "veBTC") return formatToken(weight, 4)
  return `${formatWhole(weight.raw, weight.decimals)} ${weight.symbol}`
}

function GaugeExplain({ block }: { block: GaugeExplainBlock }): ReactNode {
  const toGo = block.additionalVeMEZO
  const reached = toGo === null || BigInt(toGo.raw) === 0n
  const kind = block.target.kind ?? kindForBranch(block.target.branch)
  return (
    <div className="stuart-card stuart-figure-card">
      <div className="stuart-figure-head">
        <GaugeMark
          picture={block.target.picture}
          address={block.target.targetAddress}
          name={block.target.name}
          size={26}
        />
        <EntityLink
          to={`/gauges/${block.target.targetAddress}`}
          className="stuart-gauge-name"
        >
          {block.target.name}
        </EntityLink>
        <KindIcon kind={kind} />
      </div>
      <p className="stuart-figure">
        <span className="stuart-figure-label">
          {reached ? "Boost" : "To 5×"}
        </span>
        <span className="stuart-figure-value">
          {reached || toGo === null
            ? block.boostWad === null
              ? ""
              : formatBoost(block.boostWad)
            : formatCompact(toGo.raw, toGo.decimals)}
          {reached ? null : <small> veMEZO</small>}
        </span>
      </p>
      {block.target.branch === "boost" ? (
        <Band
          weight={block.weight}
          optimal={block.optimalVeMEZO}
          boostWad={block.boostWad}
        />
      ) : null}
      <KeyValues
        rows={[
          {
            key: "apy",
            label: "APY",
            value:
              block.apyBps === null ? (
                "Unpriced"
              ) : (
                <AnimatedNumber
                  value={block.apyBps / 10_000}
                  format={{
                    style: "percent",
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  }}
                />
              ),
          },
          {
            key: "incentives",
            label: "Incentives",
            value:
              block.incentivesUsd === null
                ? "Unpriced"
                : formatUsd(block.incentivesUsd),
          },
          {
            key: "weight",
            label: "Voted",
            value: weightText(block.weight),
          },
        ]}
      />
    </div>
  )
}

function MetricSummary({ block }: { block: MetricSummaryBlock }): ReactNode {
  return (
    <div className="stuart-card stuart-figure-card">
      <p className="stuart-figure">
        <span className="stuart-figure-label">{block.label}</span>
        <span className="stuart-figure-value">
          {block.primaryUsd === null ? "Unpriced" : formatUsd(block.primaryUsd)}
          {block.secondary === null ? null : (
            <small> {formatToken(block.secondary)}</small>
          )}
        </span>
      </p>
      {block.apyBps === null ? null : (
        <KeyValues
          rows={[
            {
              key: "apy",
              label: "APY",
              value: (
                <AnimatedNumber
                  value={block.apyBps / 10_000}
                  format={{
                    style: "percent",
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  }}
                />
              ),
            },
          ]}
        />
      )}
    </div>
  )
}

export const claimSource: Record<ClaimSourceKind, string> = {
  mezo_bribes: "Cross-chain rewards",
  boost_bribes: "Boost incentives",
  pool_fees_bribes: "Pool fees and incentives",
  validator_bribes: "Validator incentives",
  collateral_surplus: "Collateral surplus",
}

function ClaimReview({ block }: { block: ClaimReviewBlock }): ReactNode {
  return (
    <div className="stuart-card">
      <table className="stuart-table">
        <caption className="stuart-sr">Claimable</caption>
        <thead>
          <tr>
            <th scope="col">Source</th>
            <th scope="col">Claimable</th>
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row) => (
            <tr key={row.rowKey}>
              <th scope="row">
                <span className="stuart-gauge-text">
                  <span className="stuart-gauge-name">
                    {claimSource[row.source]}
                  </span>
                  {row.tokenId === null ? null : (
                    <span className="stuart-gauge-sub">#{row.tokenId}</span>
                  )}
                </span>
              </th>
              <td className="stuart-num">
                <span className="stuart-money">
                  <Coins
                    addresses={row.rewards.map((reward) => reward.token)}
                  />
                  {row.usd === null ? "Unpriced" : formatUsd(row.usd)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
        {block.totalUsd === null ? null : (
          <tfoot>
            <tr>
              <th scope="row">Total</th>
              <td className="stuart-num stuart-strong">
                {formatUsd(block.totalUsd)}
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}

const healthLabel: Record<LoanPositionBlock["health"], string> = {
  healthy: "Healthy",
  near_liquidation: "At risk",
  liquidatable: "Liquidatable",
  unpriced: "Unpriced",
  inactive: "Inactive",
}

function LoanPosition({ block }: { block: LoanPositionBlock }): ReactNode {
  return (
    <div className="stuart-card stuart-pad">
      <KeyValues
        rows={[
          {
            key: "collateral",
            label: "Collateral",
            value: formatToken(block.collateral),
          },
          { key: "debt", label: "Debt", value: formatToken(block.debt) },
          {
            key: "ratio",
            label: "Collateral ratio",
            value:
              block.collateralRatioBps === null
                ? "Unpriced"
                : formatRatio(block.collateralRatioBps),
          },
          {
            key: "liquidation",
            label: "Liquidation price",
            value:
              block.liquidationPriceUsd === null
                ? "Unpriced"
                : formatUsd(block.liquidationPriceUsd),
          },
          { key: "health", label: "Health", value: healthLabel[block.health] },
        ]}
      />
    </div>
  )
}

function LiquidationScenario({
  block,
}: {
  block: LiquidationScenarioBlock
}): ReactNode {
  return (
    <div className="stuart-card">
      <table className="stuart-table">
        <caption className="stuart-sr">BTC price scenarios</caption>
        <thead>
          <tr>
            <th scope="col">BTC</th>
            <th scope="col">Price</th>
            <th scope="col">Ratio</th>
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row) => (
            <tr
              key={row.shockBps}
              className={row.requested ? "stuart-strong" : undefined}
            >
              <th scope="row">{formatShare(row.shockBps)}</th>
              <td className="stuart-num">{formatUsd(row.priceUsd)}</td>
              <td
                className={`stuart-num ${row.band === "healthy" ? "" : "stuart-neg"}`}
              >
                {formatRatio(row.collateralRatioBps)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function RepayReview({ block }: { block: RepayReviewBlock }): ReactNode {
  return (
    <div className="stuart-card stuart-pad">
      <p className="stuart-card-title">{block.title}</p>
      <KeyValues
        rows={block.effects.map((effect) => ({
          key: effect.key,
          label: effect.label,
          value:
            effect.unchanged || effect.after === null
              ? effect.before
              : `${effect.before} to ${effect.after}`,
        }))}
      />
    </div>
  )
}

export function AllocationRows({
  rows,
}: {
  rows: AllocationDiffBlock["rows"]
}): ReactNode {
  return (
    <ul className="stuart-alloc">
      {rows.map((row) => (
        <li key={`${row.ballotKey}:${row.targetId}`}>
          <GaugeMark
            picture={null}
            address={row.targetId}
            name={row.name}
            size={26}
          />
          <span className="stuart-alloc-name">{row.name}</span>
          <span className="stuart-alloc-change">
            {row.beforeBps === row.afterBps ? (
              <b>{formatShare(row.afterBps)}</b>
            ) : (
              <>
                {formatShare(row.beforeBps)} to{" "}
                <b>{formatShare(row.afterBps)}</b>
              </>
            )}
          </span>
        </li>
      ))}
    </ul>
  )
}

export function ProjectedLine({
  before,
  after,
}: {
  before: string | null
  after: string | null
}): ReactNode {
  if (after === null) return null
  const delta = before === null ? null : usdDelta(after, before)
  return (
    <p className="stuart-projected">
      <span className="stuart-figure-label">Projected</span>
      <span className="stuart-projected-row">
        <b>{formatUsd(after)}</b>
        {before === null ? null : <span>was {formatUsd(before)}</span>}
        {delta === null ? null : (
          <em className={delta.startsWith("-") ? "stuart-neg" : "stuart-pos"}>
            {formatUsd(delta, { signed: true })}
          </em>
        )}
      </span>
    </p>
  )
}

function AllocationDiff({ block }: { block: AllocationDiffBlock }): ReactNode {
  return (
    <div className="stuart-card stuart-pad">
      <ProjectedLine
        before={block.beforeProjectedUsd}
        after={block.afterProjectedUsd}
      />
      <AllocationRows rows={block.rows} />
    </div>
  )
}

function VoteComposer({ block }: { block: VoteComposerBlock }): ReactNode {
  return (
    <div className="stuart-card stuart-pad">
      {block.ballots.map((ballot) => (
        <section key={ballot.ballotKey} aria-label={`#${ballot.tokenId}`}>
          <p className="stuart-card-title">
            {ballot.governanceAsset} #{ballot.tokenId}
          </p>
          <ul className="stuart-alloc">
            {ballot.allocations.map((allocation) => (
              <li key={allocation.targetId}>
                <EntityLink
                  to={`/gauges/${allocation.targetAddress}`}
                  className="stuart-alloc-name"
                >
                  {allocation.name}
                </EntityLink>
                <b className="stuart-alloc-change">
                  {formatShare(allocation.bps)}
                </b>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

function ClarificationCard({
  block,
}: {
  block: ClarificationCardBlock
}): ReactNode {
  const host = useHost()
  return (
    <fieldset className="stuart-clarify">
      <legend>{block.prompt}</legend>
      <ol className="stuart-rows">
        {block.options.map((option) => (
          <li key={option.id}>
            <button
              type="button"
              className="stuart-row"
              disabled={option.availability === "unavailable" || host.busy}
              onClick={() =>
                host.ask(option.label, {
                  clarification: { cardId: block.cardId, optionId: option.id },
                  ...(block.query === undefined ? {} : { query: block.query }),
                })
              }
            >
              <span className="stuart-row-text">
                {option.label}
                <span className="stuart-gauge-sub">{option.detail}</span>
              </span>
              <Glyph name="arrow-right" size={16} />
            </button>
          </li>
        ))}
      </ol>
    </fieldset>
  )
}

function ZapRoute({ block }: { block: ZapRouteBlock }): ReactNode {
  return (
    <div className="stuart-card stuart-pad">
      <p className="stuart-card-title">{block.destination.name}</p>
      <ol className="stuart-steps">
        {block.steps.map((step) => (
          <li key={step.index}>
            <span>{step.label}</span>
            {step.amount === null ? null : <b>{formatToken(step.amount)}</b>}
          </li>
        ))}
      </ol>
      <KeyValues
        rows={[
          ...(block.youPay === null
            ? []
            : [
                {
                  key: "pay",
                  label: "You pay",
                  value: formatToken(block.youPay),
                },
              ]),
          ...(block.minReceived === null
            ? []
            : [
                {
                  key: "min",
                  label: "Minimum received",
                  value: formatToken(block.minReceived),
                },
              ]),
          ...(block.priceImpactBps === null
            ? []
            : [
                {
                  key: "impact",
                  label: "Price impact",
                  value: formatBps(block.priceImpactBps),
                },
              ]),
        ]}
      />
    </div>
  )
}

function BridgeRecords({ block }: { block: BridgeRecordsBlock }): ReactNode {
  return (
    <div className="stuart-card">
      <table className="stuart-table">
        <caption className="stuart-sr">Bridge transfers</caption>
        <thead>
          <tr>
            <th scope="col">Transfer</th>
            <th scope="col">Amount</th>
          </tr>
        </thead>
        <tbody>
          {block.records.slice(0, 8).map((record) => (
            <tr key={record.id}>
              <th scope="row">
                <span className="stuart-gauge-text">
                  <span className="stuart-gauge-name">
                    {record.sourceChain} to {record.destinationChain}
                  </span>
                  <span className="stuart-gauge-sub">
                    {record.provider}, {record.happenedAt}
                  </span>
                </span>
              </th>
              <td className="stuart-num">{record.destinationAmount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SupportReportPreview({
  block,
}: {
  block: SupportReportPreviewBlock
}): ReactNode {
  return (
    <div className="stuart-card stuart-pad">
      <p className="stuart-card-title">{block.draft.title}</p>
      <KeyValues
        rows={block.draft.included.map((item) => ({
          key: item.itemId,
          label: item.label,
          value: item.value,
        }))}
      />
    </div>
  )
}

/** The trusted registry: one renderer per block type. */
export function Block({
  block,
}: {
  block: UiBlock
  /** Kept for callers; sources render once in the answer's summary row. */
  evidence?: readonly Evidence[]
}): ReactNode {
  switch (block.type) {
    case "gauge_ranking":
      return <GaugeRanking block={block} />
    case "gauge_explain":
      return <GaugeExplain block={block} />
    case "metric_summary":
      return <MetricSummary block={block} />
    case "claim_review":
      return <ClaimReview block={block} />
    case "loan_position":
      return <LoanPosition block={block} />
    case "liquidation_scenario":
      return <LiquidationScenario block={block} />
    case "repay_review":
      return <RepayReview block={block} />
    case "allocation_diff":
      return <AllocationDiff block={block} />
    case "vote_composer":
      return <VoteComposer block={block} />
    case "clarification_card":
      return <ClarificationCard block={block} />
    // Drawn by the answer's collapsed summary row, once.
    case "activity_trace":
    case "source_cluster":
      return null
    case "zap_route":
      return <ZapRoute block={block} />
    case "bridge_records":
      return <BridgeRecords block={block} />
    case "support_report_preview":
      return <SupportReportPreview block={block} />
    default:
      return null
  }
}

Block.displayName = "Stuart.Block"
