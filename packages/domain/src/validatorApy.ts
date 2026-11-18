import { decimalToScaledBigInt } from "./money"

export function calculateValidatorApyBasisPoints(
  incentivesMicroUsd: bigint,
  veBtcWeightWei: bigint,
  btcPriceUsd: string,
): bigint | null {
  if (incentivesMicroUsd <= 0n) return null
  const btcPriceMicroUsd = decimalToScaledBigInt(btcPriceUsd, 6)
  if (btcPriceMicroUsd <= 0n) return null
  const principalMicroUsd = (veBtcWeightWei * btcPriceMicroUsd) / 10n ** 18n
  if (principalMicroUsd === 0n) return -1n
  return (incentivesMicroUsd * 52n * 10_000n) / principalMicroUsd
}

export function formatValidatorApy(value: bigint | null): string {
  if (value === null) return "—"
  if (value === -1n) return "∞"
  const whole = value / 100n
  const fraction = (value % 100n).toString().padStart(2, "0")
  if (whole >= 10_000n) return `${whole / 1_000n}k%`
  return `${whole}.${fraction}%`
}

function groupThousands(value: bigint): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")
}

/**
 * Classic's approximate USD label ("~$1,234.57", "Price unavailable"). Pro's
 * exact label is formatMicroUsd in ./money.
 */
export function formatApproxMicroUsd(value: bigint | null): string {
  if (value === null) return "Price unavailable"
  const roundedCents = (value + 5_000n) / 10_000n
  const whole = roundedCents / 100n
  const fraction = (roundedCents % 100n).toString().padStart(2, "0")
  return `~$${groupThousands(whole)}.${fraction}`
}
