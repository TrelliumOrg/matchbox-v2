/// <reference path="./svg-url.d.ts" />

/**
 * Mezo's official token icons, bundled. Same files in light and dark. Never
 * redraw them. Source: Mezo dapp `apps/dapp/src/assets/tokens`, BTC from
 * Matchbox Classic.
 */

import btc from "./icons/btc.svg?url&no-inline"
import mezo from "./icons/mezo.svg?url&no-inline"
import musd from "./icons/musd.svg?url&no-inline"
import solvbtc from "./icons/solvbtc.svg?url&no-inline"
import usdc from "./icons/usdc.svg?url&no-inline"
import usdt from "./icons/usdt.svg?url&no-inline"
import xsolvbtc from "./icons/xsolvbtc.svg?url&no-inline"

export type KnownTicker =
  | "BTC"
  | "MEZO"
  | "MUSD"
  | "mUSDC"
  | "mUSDT"
  | "SolvBTC"
  | "xSolvBTC"

export type KnownToken = {
  ticker: KnownTicker
  /** CoinGecko name. */
  name: string
  src: string
}

// Static `?url` imports: Vite emits each coin as its own cacheable file
// (`no-inline` keeps it from inlining small SVGs as data URIs) and both the
// client and the SSR build on Workers resolve the same `/assets/*.svg` path.
// Resolving against the module's own URL had no base inside workerd.
export const tokenIcons: Record<KnownTicker, KnownToken> = {
  BTC: { ticker: "BTC", name: "Bitcoin", src: btc },
  MEZO: { ticker: "MEZO", name: "Mezo", src: mezo },
  MUSD: { ticker: "MUSD", name: "Mezo USD", src: musd },
  mUSDC: { ticker: "mUSDC", name: "USDC", src: usdc },
  mUSDT: { ticker: "mUSDT", name: "USDT", src: usdt },
  SolvBTC: {
    ticker: "SolvBTC",
    name: "Solv Protocol solvBTC",
    src: solvbtc,
  },
  xSolvBTC: {
    ticker: "xSolvBTC",
    name: "Solv Protocol Staked BTC",
    src: xsolvbtc,
  },
}

const knownTickers = Object.keys(tokenIcons)

export function isKnownTicker(ticker: string): ticker is KnownTicker {
  return knownTickers.includes(ticker)
}

/** The bundled icon for a ticker, or null when Mezo has no official art. */
export function bundledTokenIcon(ticker: string): string | null {
  return isKnownTicker(ticker) ? tokenIcons[ticker].src : null
}
