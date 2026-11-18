/** Basis points as a percent with two decimals: 256 to "2.56%". */
export function formatApy(bps: number): string {
  const sign = bps < 0 ? "-" : ""
  const abs = Math.abs(Math.trunc(bps))
  return `${sign}${Math.floor(abs / 100)}.${(abs % 100).toString().padStart(2, "0")}%`
}

/** Share basis points as a whole percent: 7000 to "70%". */
export function formatShare(bps: number): string {
  return `${Math.round(bps / 100)}%`
}

/** 24h change from basis points, one decimal: 180 to "+1.8%". */
export function formatChange(bps: number): string {
  const sign = bps < 0 ? "-" : "+"
  const tenths = Math.round(Math.abs(bps) / 10)
  return `${sign}${Math.floor(tenths / 10)}.${tenths % 10}%`
}
