import { TokenIcon } from "@matchbox/token-icons"
import * as Switch from "@matchbox/ui/switch"
import { type ReactNode, useId, useState } from "react"
import { Usd } from "../../components/money"
import { formatToken, formatUsd, shortAddress } from "../../lib/format"
import { toDecimal, usdValue } from "../amounts"
import { addPlan, claimPlan, escrowAddress } from "../plans"
import { claimState, lockToken, tokenState } from "../reads"
import { type PrepareContext, type Review, TxSheet } from "../tx-sheet"
import type { TxRequest } from "../tx-store"

type ClaimRequest = Extract<TxRequest, { flow: "claim" }>

const escrowLabel = { vebtc: "veBTC", vemezo: "veMEZO" } as const

/** Price per whole token from the read model's ledger, when it has one. */
function unitPrice(
  tokens: ClaimRequest["tokens"],
  address: string,
): string | null {
  const entry = tokens.find(
    (token) => token.token?.toLowerCase() === address.toLowerCase(),
  )
  if (entry === undefined || entry.usd === null) return null
  const [int = "0", fraction = ""] = entry.amount.split(".")
  const amount =
    BigInt(int || "0") * 10n ** 18n +
    BigInt(fraction.padEnd(18, "0").slice(0, 18) || "0")
  if (amount === 0n) return null
  const [uInt = "0", uFraction = ""] = entry.usd.split(".")
  const usdMicro =
    BigInt(uInt || "0") * 1_000_000n +
    BigInt(uFraction.padEnd(6, "0").slice(0, 6) || "0")
  const perToken = (usdMicro * 10n ** 18n) / amount
  return `${perToken / 1_000_000n}.${(perToken % 1_000_000n).toString().padStart(6, "0")}`
}

/**
 * Review claim (`9_tP6WZRm-`): what the reward contracts report as earned
 * right now, per token, then one claim per lock and voter, plus relocking
 * the claimed MEZO into the largest veMEZO lock when asked.
 */
export function ClaimSheet({
  request,
  config,
  account,
}: PrepareContext & { request: ClaimRequest }): ReactNode {
  const [relock, setRelock] = useState(
    request.relock && request.relockInto !== null,
  )
  const switchId = useId()
  const into = request.relockInto

  async function prepare(context: PrepareContext): Promise<Review> {
    const state = await claimState(
      context.config,
      request.sources.map((source) => ({
        kind: source.lock.kind,
        tokenId: BigInt(source.lock.tokenId),
        gauges: source.gauges,
      })),
    )
    const steps = claimPlan(state.calls)
    const mezo = state.earned.find(
      (token) =>
        token.token.toLowerCase() === lockToken.vemezo.address.toLowerCase(),
    )
    const relocking =
      relock && into !== null && mezo !== undefined && mezo.amount > 0n
    if (relocking && into !== null && mezo !== undefined) {
      const allowance = await tokenState(context.config, {
        token: lockToken.vemezo.address,
        owner: context.account,
        spender: escrowAddress("vemezo"),
      })
      steps.push(
        ...addPlan({
          kind: "vemezo",
          tokenId: BigInt(into.tokenId),
          token: lockToken.vemezo.address,
          symbol: "MEZO",
          amount: mezo.amount,
          amountLabel: formatToken(toDecimal(mezo.amount, 18), "MEZO"),
          allowance: allowance.allowance,
        }).map((step) => ({ ...step, id: `relock-${step.id}` })),
      )
    }
    const tokenRows = state.earned.map((token) => {
      const amount = toDecimal(token.amount, token.decimals)
      const usd = usdValue(
        token.amount,
        token.decimals,
        unitPrice(request.tokens, token.token),
      )
      return { token, amount, usd }
    })
    return {
      headline: {
        label: "Claim",
        figure: <Usd value={request.usd} style="cents" />,
        sub: `To ${shortAddress(context.account)}`,
      },
      body: (
        <>
          <ul className="mt-6 flex flex-col gap-4">
            {tokenRows.map(({ token, amount, usd }) => (
              <li key={token.token} className="flex items-center gap-4">
                <TokenIcon ticker={token.symbol} size={48} />
                <div className="min-w-0 flex-1">
                  <p className="text-base font-semibold">{token.symbol}</p>
                  <p className="text-[14.5px] text-sec tabular-nums">
                    {formatToken(amount, token.symbol)} {token.symbol}
                  </p>
                </div>
                <p className="text-base font-semibold tabular-nums">
                  {usd === null ? null : formatUsd(usd, "cents")}
                </p>
              </li>
            ))}
          </ul>
          {into === null ? null : (
            <div className="mt-5 flex items-center gap-4 rounded-[20px] bg-soft px-5 py-4 dark:bg-soft2">
              <label htmlFor={switchId} className="min-w-0 flex-1">
                <span className="block text-base font-semibold">
                  Relock MEZO into #{into.tokenId}
                </span>
                <span className="mt-0.5 flex items-center gap-1.5 text-[14.5px] text-sec tabular-nums">
                  <TokenIcon ticker="MEZO" size={16} />
                  {mezo === undefined
                    ? "0.00"
                    : formatToken(toDecimal(mezo.amount, 18), "MEZO")}
                </span>
              </label>
              <Switch.Root
                id={switchId}
                checked={relock}
                disabled={mezo === undefined}
                onCheckedChange={setRelock}
              />
            </div>
          )}
        </>
      ),
      rows: request.sources.map((source) => ({
        label: `${escrowLabel[source.lock.kind]} #${source.lock.tokenId}`,
        value: formatUsd(source.usd, "cents"),
      })),
      signRows: 0,
      steps,
      blocked: steps.length === 0 ? "Nothing to claim" : null,
      done: {
        sub: (
          <>
            Claimed{" "}
            <b className="font-semibold text-ink">
              {formatUsd(request.usd, "cents")}
            </b>
          </>
        ),
        rows: [
          ...tokenRows.map(({ token, amount }) => ({
            label: token.symbol,
            value: formatToken(amount, token.symbol),
          })),
          ...(relocking && into !== null
            ? [{ label: "Relocked into", value: `veMEZO #${into.tokenId}` }]
            : []),
        ],
      },
    }
  }

  return (
    <TxSheet
      config={config}
      account={account}
      titles={{
        review: "Review claim",
        sign: "Sign claim",
        done: "Rewards claimed",
      }}
      prepare={prepare}
      reviewCta={relock ? "Claim and relock" : "Claim"}
      revision={relock ? "relock" : "claim"}
      success={{
        toast: relock ? "Claimed and relocked" : "Rewards claimed",
        refresh: ["rewards", "overview", "voter", "activity"],
      }}
    />
  )
}
