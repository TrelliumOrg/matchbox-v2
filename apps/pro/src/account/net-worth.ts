import type { Lock } from "../data/view-models"

/**
 * The Account panel's net worth: wallet tokens, locks and what is ready to
 * claim, each a USD decimal string. Summed exactly with bigint (no floats),
 * at the precision of the longest fraction.
 */

type Parsed = { negative: boolean; digits: bigint; scale: number }

const decimal = /^-?\d*(\.\d*)?$/

function parse(value: string): Parsed | null {
  const trimmed = value.trim()
  if (trimmed === "" || trimmed === "-" || !decimal.test(trimmed)) return null
  const negative = trimmed.startsWith("-")
  const body = negative ? trimmed.slice(1) : trimmed
  const [int = "", fraction = ""] = body.split(".")
  if (int === "" && fraction === "") return null
  return {
    negative,
    digits: BigInt(`${int === "" ? "0" : int}${fraction}`),
    scale: fraction.length,
  }
}

/** "412.1" + "868.40" + "3.9" = "1284.40". Unparseable values count as 0. */
export function sumUsd(values: readonly string[]): string {
  const parsed = values.map(parse).filter((value) => value !== null)
  const scale = Math.max(0, ...parsed.map((value) => value.scale))
  let total = 0n
  for (const value of parsed) {
    const scaled = value.digits * 10n ** BigInt(scale - value.scale)
    total += value.negative ? -scaled : scaled
  }
  const negative = total < 0n
  const magnitude = (negative ? -total : total)
    .toString()
    .padStart(scale + 1, "0")
  const int = magnitude.slice(0, magnitude.length - scale)
  const fraction = magnitude.slice(magnitude.length - scale)
  return `${negative ? "-" : ""}${int}${scale > 0 ? `.${fraction}` : ""}`
}

export type NetWorth = {
  total: string
  wallet: string
  locks: string
  claimable: string
}

export function netWorth(input: {
  /** Wallet token values; null ones (no price) are left out. */
  walletUsd: readonly (string | null)[]
  locks: readonly Pick<Lock, "usd">[]
  claimableUsd: string
}): NetWorth {
  const wallet = sumUsd(input.walletUsd.filter((usd) => usd !== null))
  const locks = sumUsd(input.locks.map((lock) => lock.usd))
  const claimable = sumUsd([input.claimableUsd])
  return {
    total: sumUsd([wallet, locks, claimable]),
    wallet,
    locks,
    claimable,
  }
}
