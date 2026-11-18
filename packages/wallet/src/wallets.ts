/**
 * The wallet drawer's lists (skate9 pattern, ported from Matchbox ID's
 * ConnectDrawer, 263a87b): Recent, Detected, More wallets, WalletConnect.
 * Pure, so it is tested without wagmi; `WalletConnector` is the part of a
 * wagmi Connector the drawer reads.
 */

export type WalletConnector = {
  /** wagmi's per-instance id. */
  uid: string
  /** EIP-6963 rdns ("io.rabby"), "injected" or "walletConnect". */
  id: string
  name: string
  type: string
  icon?: string | undefined
}

export type WalletEntry = {
  /** Stable across visits: the rdns, or the connector id. */
  key: string
  name: string
  icon: string | null
  /** Connectable now. Otherwise `downloadUrl` says where to get it. */
  installed: boolean
  /** "Installed", "Chrome extension", "App or extension". */
  detail: string
  downloadUrl: string | null
  connectorUid: string | null
}

export type WalletGroups = {
  recent: WalletEntry[]
  detected: WalletEntry[]
  more: WalletEntry[]
  walletConnect: WalletEntry | null
}

/** Wallets people use on Mezo, offered with a download link when missing. */
export const knownWallets = [
  {
    key: "io.metamask",
    name: "MetaMask",
    detail: "Extension and app",
    downloadUrl: "https://metamask.io/download",
  },
  {
    key: "io.rabby",
    name: "Rabby",
    detail: "Chrome extension",
    downloadUrl: "https://rabby.io",
  },
  {
    key: "com.okex.wallet",
    name: "OKX Wallet",
    detail: "Extension and app",
    downloadUrl: "https://www.okx.com/web3",
  },
  {
    key: "com.coinbase.wallet",
    name: "Coinbase Wallet",
    detail: "App or extension",
    downloadUrl: "https://www.coinbase.com/wallet/downloads",
  },
  {
    key: "xyz.taho",
    name: "Taho",
    detail: "Chrome extension",
    downloadUrl: "https://taho.xyz",
  },
] as const

/**
 * The wallet whose built-in browser this page is open in, read from the
 * flags wallets set on their injected provider. Their mobile browsers do
 * not always announce over EIP-6963, and then the only connector is the
 * generic one: this gives it the wallet's name instead of "Browser wallet".
 * `okx` is `window.okxwallet`, which OKX sets beside `window.ethereum`.
 */
export function injectedWalletName(
  ethereum: unknown,
  okx: unknown = undefined,
): string | null {
  const flag = (name: string): boolean =>
    typeof ethereum === "object" &&
    ethereum !== null &&
    Reflect.get(ethereum, name) === true
  if (okx !== undefined && okx !== null) return "OKX Wallet"
  if (flag("isOkxWallet") || flag("isOKExWallet")) return "OKX Wallet"
  if (flag("isRabby")) return "Rabby"
  if (flag("isCoinbaseWallet")) return "Coinbase Wallet"
  if (flag("isTrust") || flag("isTrustWallet")) return "Trust Wallet"
  if (flag("isBitKeep") || flag("isBitget")) return "Bitget Wallet"
  // Last: several wallets also set isMetaMask for compatibility.
  if (flag("isMetaMask")) return "MetaMask"
  return null
}

/**
 * True inside a wallet app's built-in browser: a phone or tablet whose page
 * has an injected provider. Mobile Safari and Chrome have none, so on a
 * touch device an injected provider means the wallet is the browser.
 */
export function inWalletBrowser(input: {
  injectedProvider: boolean
  /** `(pointer: coarse)`: a finger, not a mouse. */
  coarsePointer: boolean
}): boolean {
  return input.injectedProvider && input.coarsePointer
}

const normalize = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9]/g, "")

function sameWallet(left: string, right: string): boolean {
  const a = normalize(left)
  const b = normalize(right)
  return a === b || a.startsWith(b) || b.startsWith(a)
}

/**
 * Groups connectors for the drawer. EIP-6963 announcements are what this
 * browser has; the generic injected connector only shows when nothing
 * announced itself. Known wallets that are not installed get a download
 * link. Recent keys (newest first) pull their wallet up into Recent.
 */
export function groupWallets(
  connectors: readonly WalletConnector[],
  recentKeys: readonly string[],
  options: {
    injectedProvider: boolean
    /**
     * Inside a wallet's browser: that wallet is the only way to connect.
     * WalletConnect would hand off to another app, and the download rows
     * open a store in a new tab, which these browsers block or lose.
     */
    inWallet?: boolean
    /** The injected wallet's name, when its flags give one. */
    injectedName?: string | null
    /**
     * WalletConnect can be offered though its connector is not loaded yet:
     * its code is about 450 kB and loads when the row is tapped. The row
     * then has no `connectorUid` until `ensureWalletConnect` resolves.
     */
    walletConnectOffered?: boolean
  },
): WalletGroups {
  const detected: WalletEntry[] = []
  let walletConnect: WalletEntry | null = null
  let generic: WalletEntry | null = null
  const seen = new Set<string>()

  for (const connector of connectors) {
    if (connector.type === "walletConnect") {
      walletConnect = {
        key: "walletConnect",
        name: "WalletConnect",
        icon: connector.icon ?? null,
        installed: true,
        detail: "Scan with your phone",
        downloadUrl: null,
        connectorUid: connector.uid,
      }
      continue
    }
    if (connector.type !== "injected") continue
    const entry: WalletEntry = {
      key: connector.id,
      name: connector.name,
      icon: connector.icon ?? null,
      installed: true,
      detail: "Installed",
      downloadUrl: null,
      connectorUid: connector.uid,
    }
    if (connector.id === "injected") {
      generic = { ...entry, name: options.injectedName ?? "Browser wallet" }
      continue
    }
    if (seen.has(normalize(entry.name))) continue
    seen.add(normalize(entry.name))
    detected.push(entry)
  }
  if (detected.length === 0 && generic !== null && options.injectedProvider) {
    detected.push(generic)
  }

  if (walletConnect === null && options.walletConnectOffered === true) {
    walletConnect = {
      key: "walletConnect",
      name: "WalletConnect",
      icon: null,
      installed: true,
      detail: "Scan with your phone",
      downloadUrl: null,
      connectorUid: null,
    }
  }
  const inWallet = options.inWallet === true && detected.length > 0
  if (inWallet) walletConnect = null
  const more: WalletEntry[] = (inWallet ? [] : knownWallets)
    .filter(
      (wallet) =>
        !detected.some(
          (entry) =>
            entry.key === wallet.key || sameWallet(entry.name, wallet.name),
        ),
    )
    .map((wallet) => ({
      key: wallet.key,
      name: wallet.name,
      icon: null,
      installed: false,
      detail: wallet.detail,
      downloadUrl: wallet.downloadUrl,
      connectorUid: null,
    }))

  const available = [...detected, ...(walletConnect ? [walletConnect] : [])]
  const recent = recentKeys.flatMap((key) => {
    const entry = available.find((candidate) => candidate.key === key)
    return entry === undefined ? [] : [entry]
  })
  const recentSet = new Set(recent.map((entry) => entry.key))
  return {
    recent,
    detected: detected.filter((entry) => !recentSet.has(entry.key)),
    more,
    walletConnect:
      walletConnect !== null && !recentSet.has(walletConnect.key)
        ? walletConnect
        : null,
  }
}

export const recentStorageKey = "mbx-wallet-recent"
const maxRecent = 3

/** Reads the recent wallet keys, newest first, tolerating bad storage. */
export function readRecent(storage: Pick<Storage, "getItem"> | null): string[] {
  if (storage === null) return []
  try {
    const raw = storage.getItem(recentStorageKey)
    if (raw === null) return []
    return raw
      .split(",")
      .filter((key) => /^[\w.-]{1,80}$/.test(key))
      .slice(0, maxRecent)
  } catch {
    return []
  }
}

export function rememberRecent(
  storage: Pick<Storage, "getItem" | "setItem"> | null,
  key: string,
): void {
  if (storage === null) return
  const next = [key, ...readRecent(storage).filter((entry) => entry !== key)]
  try {
    storage.setItem(recentStorageKey, next.slice(0, maxRecent).join(","))
  } catch {
    // Private windows refuse storage; Recent just stays empty.
  }
}

/** A short reason a connection did not happen. */
export function connectError(error: unknown): string {
  if (isUserRejection(error)) return "Declined in wallet"
  const text = errorText(error)
  if (/already pending|already processing/.test(text)) {
    return "Request already open in wallet"
  }
  if (/not found|not installed/.test(text)) return "Wallet not found"
  return "Connection failed"
}

function errorText(error: unknown): string {
  if (typeof error !== "object" || error === null) {
    return String(error).toLowerCase()
  }
  const short: unknown = Reflect.get(error, "shortMessage")
  const message: unknown = Reflect.get(error, "message")
  return String(
    typeof short === "string" ? short : (message ?? error),
  ).toLowerCase()
}

/** True when a wallet error, or anything in its cause chain, is a rejection. */
export function isUserRejection(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; depth < 8; depth++) {
    if (typeof current !== "object" || current === null) return false
    if (
      Reflect.get(current, "name") === "UserRejectedRequestError" ||
      Reflect.get(current, "code") === 4001
    ) {
      return true
    }
    current = Reflect.get(current, "cause")
  }
  return false
}
