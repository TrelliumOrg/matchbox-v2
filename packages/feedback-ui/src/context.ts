import {
  type FeedbackContext,
  type FeedbackSurface,
  feedbackLimits,
  type WalletBrowser,
} from "@matchbox/contracts/feedback"

/**
 * The context attached to a report, read from the page when the panel
 * opens and listed for the user before sending. Only these fields: no
 * cookies, no storage, no console, no field values.
 */

/**
 * The page path from a URL, without its query string or fragment: a
 * wallet address in `?address=` or a token in a hash never leaves the page.
 */
export function routeOf(href: string): string {
  let path: string
  try {
    path = new URL(href, "https://page.invalid").pathname
  } catch {
    path = href.split(/[?#]/, 1)[0] ?? "/"
  }
  const clean = path.startsWith("/") ? path : `/${path}`
  return clean.replace(/\s/g, "").slice(0, feedbackLimits.routeMax)
}

/**
 * The route with the connected wallet's own address replaced by `:wallet`
 * (Pro's wallet pages carry it in the path): the address goes only in the
 * Wallet field, when the user ticks the box.
 */
export function withoutAddress(route: string, address: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return route
  return route.replace(new RegExp(address, "gi"), ":wallet")
}

/**
 * Wallets' own browsers name themselves in the user agent. A desktop
 * extension does not change it, so a page in Chrome with OKX's extension
 * reads as Chrome.
 */
const walletBrowsers: ReadonlyArray<{ id: WalletBrowser; pattern: RegExp }> = [
  { id: "okx", pattern: /OKApp|OKEx|OKXWallet/i },
  { id: "metamask", pattern: /MetaMaskMobile/i },
  { id: "coinbase", pattern: /CoinbaseWallet|CoinbaseBrowser/i },
  { id: "trust", pattern: /TrustWallet|\bTrust\//i },
  { id: "binance", pattern: /BNC\/|BinanceWallet/i },
  { id: "bitget", pattern: /BitKeep|Bitget/i },
  { id: "phantom", pattern: /Phantom/i },
  { id: "rabby", pattern: /Rabby/i },
  { id: "imtoken", pattern: /imToken/i },
  { id: "tokenpocket", pattern: /TokenPocket/i },
]

export function walletBrowserOf(userAgent: string): WalletBrowser | null {
  return (
    walletBrowsers.find((browser) => browser.pattern.test(userAgent))?.id ??
    null
  )
}

/** The theme as the page resolved it: data-theme and its color-scheme. */
export function themeOf(root: HTMLElement): FeedbackContext["theme"] {
  const preset = root.dataset.theme ?? null
  const scheme = getComputedStyle(root).colorScheme
  return {
    mode: /dark/.test(scheme) && !/light/.test(scheme) ? "dark" : "light",
    preset: preset !== null && /^[a-z0-9-]{1,32}$/.test(preset) ? preset : null,
  }
}

/**
 * The build this page runs: the hash in its entry chunk's file name, so it
 * needs no build-time variable on any surface.
 */
export function buildOf(doc: Document): string | null {
  const sources = [
    ...doc.querySelectorAll<HTMLScriptElement>("script[type=module][src]"),
  ].map((script) => script.src)
  for (const source of sources) {
    const hash = /\/assets\/[^/]*?-([A-Za-z0-9_-]{6,})\.js(?:$|\?)/.exec(
      source,
    )?.[1]
    if (hash !== undefined) return hash.slice(0, feedbackLimits.buildMax)
  }
  return null
}

export function collectContext(input: {
  surface: FeedbackSurface
  chainId: number | null
}): FeedbackContext {
  const userAgent = navigator.userAgent.slice(0, feedbackLimits.userAgentMax)
  return {
    surface: input.surface,
    route: routeOf(window.location.href),
    build: buildOf(document),
    viewport: {
      width: Math.round(window.innerWidth),
      height: Math.round(window.innerHeight),
    },
    theme: themeOf(document.documentElement),
    userAgent,
    walletBrowser: walletBrowserOf(userAgent),
    chainId:
      input.chainId !== null && Number.isSafeInteger(input.chainId)
        ? input.chainId
        : null,
  }
}

/** 0x5Dc2…71aF */
export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}
