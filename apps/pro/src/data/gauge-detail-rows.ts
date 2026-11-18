import type { GaugeDetails } from "@matchbox/contracts/read-models"
import {
  formatDay,
  formatDecimal,
  formatTokenWithSymbol,
  formatUsd,
  formatVeBtc,
  shortAddress,
} from "../lib/format"

/**
 * The gauge profile's "Details": the facts of the gauge's kind that the
 * API reads for it (`details`), as label and value rows. A fact the API
 * could not read (null) has no row, so the list never shows a dash.
 */

export type DetailRow = { label: string; value: string }

const lockState = {
  active: "Active",
  "auto-max": "Auto max",
  expired: "Expired",
  withdrawn: "Withdrawn",
} as const

const poolKindLabel: Record<string, string> = {
  cl: "Concentrated",
  stable: "Stable",
  volatile: "Volatile",
  vault: "Vault",
}

const percent = (value: string): string => `${formatDecimal(value, 2)}%`

function rows(list: readonly (DetailRow | null)[]): DetailRow[] {
  return list.filter((row) => row !== null)
}

const row = (label: string, value: string | null): DetailRow | null =>
  value === null || value === "" ? null : { label, value }

export function gaugeDetailRows(
  details: GaugeDetails | null | undefined,
): DetailRow[] {
  if (details === null || details === undefined) return []
  switch (details.kind) {
    case "vebtc": {
      const lock = details.lock
      return rows([
        row("Lock", `veBTC #${details.tokenId}`),
        row(
          "Locked",
          details.locked === null
            ? null
            : details.locked.usd === null
              ? formatTokenWithSymbol(details.locked.amount, "BTC")
              : `${formatTokenWithSymbol(details.locked.amount, "BTC")}, ${formatUsd(details.locked.usd)}`,
        ),
        row(
          "Lock state",
          lock === null
            ? null
            : lock.state === "active" && lock.unlocksAt !== null
              ? `Unlocks ${formatDay(lock.unlocksAt)}`
              : lockState[lock.state],
        ),
        row(
          "Voting power",
          details.vebtcWeight === null
            ? null
            : formatVeBtc(details.vebtcWeight),
        ),
        row(
          "Boost",
          details.boost === null ? null : `${formatDecimal(details.boost, 2)}×`,
        ),
        row(
          "Votes for 5×",
          details.optimalVotes === null
            ? null
            : `${formatDecimal(details.optimalVotes, 0)} veMEZO`,
        ),
        row(
          "Beneficiary",
          details.beneficiary === null || details.beneficiary === details.owner
            ? null
            : shortAddress(details.beneficiary),
        ),
      ])
    }
    case "validator":
      return rows([
        row("Validator", details.moniker),
        row("Status", details.status === "active" ? "Active" : "Left the set"),
        row(
          "Operator",
          details.operator === null ? null : shortAddress(details.operator),
        ),
        row(
          "Beneficiary",
          details.beneficiary === null ||
            details.beneficiary === details.operator
            ? null
            : shortAddress(details.beneficiary),
        ),
        row(
          "Voting power",
          details.votingPower === null
            ? null
            : formatDecimal(details.votingPower, 0),
        ),
        row(
          "Commission",
          details.commission === null ? null : percent(details.commission),
        ),
      ])
    case "pool":
      return rows([
        row(
          "Pool",
          details.tokens.map((token) => token.symbol).join("/") || null,
        ),
        row(
          "Type",
          details.poolKind === null
            ? null
            : details.tickSpacing === null
              ? (poolKindLabel[details.poolKind] ?? details.poolKind)
              : `${poolKindLabel[details.poolKind] ?? details.poolKind}, tick spacing ${details.tickSpacing}`,
        ),
        row(
          "Swap fee",
          details.feePercent === null ? null : percent(details.feePercent),
        ),
        row(
          "Liquidity",
          details.tvlUsd === null ? null : formatUsd(details.tvlUsd),
        ),
        row(
          "Reserves",
          details.reserves
            .map((reserve) =>
              formatTokenWithSymbol(reserve.amount, reserve.token.symbol),
            )
            .join(", ") || null,
        ),
        row(
          "Staked in gauge",
          details.stakedPercent === null
            ? null
            : percent(details.stakedPercent),
        ),
        row(
          "Emissions",
          details.emissionApr === null
            ? null
            : `${percent(details.emissionApr)} APR`,
        ),
        row(
          "Savings rate",
          details.savingsApr === null
            ? null
            : `${percent(details.savingsApr)} APR`,
        ),
        row("Contract", shortAddress(details.pool)),
      ])
    case "mezo":
      return rows([
        row("Chain", details.chain),
        row("Protocol", details.protocol),
        row("Funds", details.destination),
        row("Bridge", details.bridge),
        row(
          "Recipient",
          details.recipient === null ? null : shortAddress(details.recipient),
        ),
        row(
          "Allocator",
          details.allocator === null ? null : shortAddress(details.allocator),
        ),
      ])
  }
}
