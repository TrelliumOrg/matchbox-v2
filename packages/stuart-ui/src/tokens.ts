import type { KnownTicker } from "@matchbox/token-icons"

/**
 * Mezo mainnet token addresses with official coins in @matchbox/token-icons.
 * Answers carry addresses only; anything not listed here draws no coin, so a
 * reply can never point the page at an arbitrary image URL.
 */
const officialTokens: Readonly<Record<string, KnownTicker>> = {
  "0x7b7c000000000000000000000000000000000000": "BTC",
  "0x7b7c000000000000000000000000000000000001": "MEZO",
  "0xdd468a1ddc392dcdbef6db6e34e89aa338f9f186": "MUSD",
  "0x04671c72aab5ac02a03c1098314b1bb6b560c197": "mUSDC",
}

export function tickerForAddress(address: string): KnownTicker | null {
  return officialTokens[address.toLowerCase()] ?? null
}

/** Official tickers for a list of addresses, unknown ones dropped, no repeats. */
export function coinTickers(addresses: readonly string[]): KnownTicker[] {
  const tickers: KnownTicker[] = []
  for (const address of addresses) {
    const ticker = tickerForAddress(address)
    if (ticker !== null && !tickers.includes(ticker)) tickers.push(ticker)
  }
  return tickers
}
