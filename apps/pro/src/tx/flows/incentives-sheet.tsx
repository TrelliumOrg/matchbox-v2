import { MUSD_CONTRACTS } from "@matchbox/chain"
import * as GaugeCard from "@matchbox/ui/gauge-card"
import { Glyph, shapes } from "@matchbox/ui/icons"
import * as SegmentedControl from "@matchbox/ui/segmented-control"
import { type ReactNode, useState } from "react"
import { type Address, getAddress } from "viem"
import {
  formatCompactVotes,
  formatDay,
  formatUsd,
  shortAddress,
} from "../../lib/format"
import { gaugeName } from "../../lib/gauge-name"
import { useLive } from "../../live/live-context"
import { amountLabel, parseAmount, usdValue } from "../amounts"
import { incentivesPlan } from "../plans"
import { incentiveState, lockToken } from "../reads"
import { type PrepareContext, type Review, TxSheet } from "../tx-sheet"
import type { TxRequest } from "../tx-store"
import { perThousandVotes } from "./incentive-estimate"
import { AmountField, useChainRead } from "./parts"

type IncentivesRequest = Extract<TxRequest, { flow: "incentives" }>

/** Incentive tokens offered in the form; the voter's whitelist decides. */
const incentiveTokens: readonly {
  symbol: string
  address: Address
  decimals: number
}[] = [
  {
    symbol: "MUSD",
    address: getAddress(MUSD_CONTRACTS.mainnet.musd),
    decimals: 18,
  },
  { symbol: "MEZO", address: lockToken.vemezo.address, decimals: 18 },
  { symbol: "BTC", address: lockToken.vebtc.address, decimals: 18 },
]

const voterLabel = {
  boost: "veBTC gauge",
  "third-party": "MEZO gauge",
  validators: "Validator gauge",
  pools: "Pool gauge",
} as const

/**
 * Add incentives (`SbjosHTBXd`): pick a token and an amount for a gauge's
 * voters. BoostVoter, ValidatorsVoter and ThirdPartyVoter take them through
 * `addBribes`; a pool gauge's bribe contract takes them directly. Deposits
 * pay this epoch's voters when the epoch closes and cannot be withdrawn.
 */
export function IncentivesSheet({
  request,
  config,
  account,
}: PrepareContext & { request: IncentivesRequest }): ReactNode {
  const { gauge } = request
  const { market } = useLive()
  const [symbol, setSymbol] = useState(incentiveTokens[0]?.symbol ?? "MUSD")
  const [input, setInput] = useState("")
  const token =
    incentiveTokens.find((entry) => entry.symbol === symbol) ??
    incentiveTokens[0]
  const read = useChainRead(`${gauge.address}-${symbol}-${account}`, () =>
    incentiveState(config, {
      voter: gauge.voter,
      gauge: gauge.address,
      token: token?.address ?? lockToken.vemezo.address,
      owner: account,
    }),
  )
  const decimals = token?.decimals ?? 18
  const amount = parseAmount(input, decimals)
  const balance = read.data?.token.balance ?? null
  const error =
    read.data !== null && !read.data.whitelisted
      ? `${symbol} not accepted on this gauge`
      : amount !== null && balance !== null && amount > balance
        ? "More than your balance"
        : null
  const price =
    symbol === "MUSD"
      ? "1"
      : symbol === "BTC"
        ? (market.prices.btc?.usd ?? null)
        : (market.prices.mezo?.usd ?? null)
  const usd = amount === null ? null : usdValue(amount, decimals, price)
  const label = amount === null ? "0" : amountLabel(amount, decimals, symbol)
  const perThousand = usd === null ? null : perThousandVotes(usd, gauge.votes)
  const rows = [
    {
      label: `Epoch ${market.epoch.number}`,
      value: formatUsd(gauge.incentivesUsd, "cents"),
    },
    ...(usd === null
      ? []
      : [{ label: "You add", value: formatUsd(usd, "cents") }]),
    ...(perThousand === null
      ? []
      : [{ label: "Per 1k votes", value: perThousand }]),
    { label: "Paid", value: formatDay(market.epoch.endsAt) },
    { label: "Withdrawable", value: "No" },
  ]

  async function prepare(context: PrepareContext): Promise<Review> {
    if (amount === null || token === undefined) throw new Error("No amount")
    const state = await incentiveState(context.config, {
      voter: gauge.voter,
      gauge: gauge.address,
      token: token.address,
      owner: context.account,
    })
    return {
      headline: {
        label: `Add to ${gaugeName(gauge)}`,
        figure: `${label} ${symbol}`,
        sub: usd === null ? undefined : formatUsd(usd, "cents"),
      },
      rows: [
        { label: "Gauge", value: voterLabel[gauge.voter] },
        // The form's rows without the gauge's total and "You add", which
        // the headline says.
        ...rows.filter(
          (row) => row.label !== "You add" && !row.label.startsWith("Epoch "),
        ),
      ],
      signRows: 1,
      steps: incentivesPlan({
        voter: gauge.voter,
        gauge: getAddress(gauge.address),
        bribe: state.bribe,
        token: token.address,
        symbol,
        amount,
        amountLabel: label,
        allowance: state.token.allowance,
      }),
      blocked: !state.whitelisted
        ? `${symbol} not accepted on this gauge`
        : amount > state.token.balance
          ? "More than your balance"
          : null,
      done: {
        sub: `${label} ${symbol} for ${gaugeName(gauge)}`,
        rows: [{ label: "Paid", value: formatDay(market.epoch.endsAt) }],
      },
    }
  }

  return (
    <TxSheet
      config={config}
      account={account}
      titles={{
        form: "Add incentives",
        review: "Review",
        sign: "Sign",
        done: "Incentives added",
      }}
      form={{
        cta: "Review",
        ready: amount !== null && error === null && balance !== null,
        content: (
          <ol className="flex flex-col gap-5">
            <li className="flex items-center gap-4">
              <GaugeCard.Picture picture={gauge.picture} size={48} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-semibold">
                  {gaugeName(gauge)}
                </p>
                <p className="text-[14.5px] text-sec">
                  {shortAddress(gauge.address)}
                </p>
              </div>
              <div className="text-right tabular-nums">
                <p className="text-base font-semibold">
                  {formatCompactVotes(gauge.votes)} {gauge.votesUnit}
                </p>
                <p className="text-[14.5px] text-sec">
                  {formatUsd(gauge.incentivesUsd, "cents")}
                </p>
              </div>
            </li>
            <li>
              <SegmentedControl.Root
                surface="sheet"
                size="sm"
                value={symbol}
                aria-label="Incentive token"
                onValueChange={(value) => {
                  setSymbol(value)
                  setInput("")
                }}
              >
                {incentiveTokens.map((entry) => (
                  <SegmentedControl.Item
                    key={entry.symbol}
                    value={entry.symbol}
                  >
                    {entry.symbol}
                  </SegmentedControl.Item>
                ))}
              </SegmentedControl.Root>
            </li>
            <li>
              <AmountField
                label="You add"
                symbol={symbol}
                value={input}
                onValueChange={setInput}
                balance={balance}
                decimals={decimals}
                usd={null}
                error={error}
              />
            </li>
            <li className="flex items-center gap-4">
              <span className="grid size-11 flex-none place-items-center rounded-full bg-soft text-ink2 dark:bg-soft2">
                <Glyph
                  shape={shapes.calendarDays}
                  size={20}
                  strokeWidth={1.8}
                />
              </span>
              <div>
                <p className="text-base font-semibold">
                  Epoch {market.epoch.number}
                </p>
                <p className="text-[14.5px] text-sec">
                  Closes {formatDay(market.epoch.endsAt)}
                </p>
              </div>
            </li>
            <li>
              <dl className="flex flex-col tabular-nums">
                {rows.map((row) => (
                  <div
                    key={row.label}
                    className="flex items-center justify-between gap-4 py-2 text-[15.5px]"
                  >
                    <dt className="text-sec">{row.label}</dt>
                    <dd className="font-semibold">{row.value}</dd>
                  </div>
                ))}
              </dl>
            </li>
          </ol>
        ),
      }}
      prepare={prepare}
      reviewCta="Add incentives"
      success={{
        toast: "Incentives added",
        refresh: ["gauges", "gauge", "home", "activity"],
      }}
    />
  )
}
