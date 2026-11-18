/**
 * Whether this is an app's built-in browser (a webview): a wallet app's
 * browser (OKX, MetaMask, Coinbase Wallet, Trust, Bitget), another app's
 * link browser, or any Android WebView or iOS WKWebView. Google refuses
 * sign-in there ("disallowed_useragent"), so the console says to open the
 * page in the phone's own browser instead of showing a button that fails.
 *
 * Android WebViews mark themselves `; wv)`. An iOS WKWebView sends Safari's
 * agent without the `Safari/` token, which Safari and every iOS browser
 * built on it (Chrome, Firefox, Edge, the Google app) keep.
 */

const walletApps = [
  /\bOKApp\b/,
  /\bOKWallet\b/,
  /\bMetaMaskMobile\b/,
  /\bCoinbaseWallet\b/,
  /\bTrust\/|\bTrustWallet\b/,
  /\bBitKeep\b|\bBitget/i,
]

export function isEmbeddedBrowser(userAgent: string): boolean {
  if (walletApps.some((app) => app.test(userAgent))) return true
  if (/\bAndroid\b/.test(userAgent) && /; wv\)/.test(userAgent)) return true
  if (/\b(iPhone|iPad|iPod)\b/.test(userAgent)) {
    return /AppleWebKit\//.test(userAgent) && !/\bSafari\//.test(userAgent)
  }
  return false
}
