import { CHAIN_ID, MEZO_MAINNET } from "@matchbox/chain"
import {
  type Config,
  type Connector,
  type CreateConnectorFn,
  connect,
  createConfig,
  createStorage,
  custom,
  disconnect,
  getAccount,
  getConnectors,
  http,
  injected,
  reconnect,
  signMessage as signWithWallet,
  switchChain,
  watchAccount,
  watchConnectors,
} from "@wagmi/core"
import { connectedFlag, setWallet } from "./wallet-store"
import {
  isUserRejection,
  readRecent,
  rememberRecent,
  type WalletConnector,
} from "./wallets"

/**
 * wagmi on Mezo mainnet, created once per tab. Loaded only behind the
 * wallet drawer. Reads go to the RPC the Worker names (`MEZO_RPC_URL`, an
 * Anvil fork in end-to-end tests); the wallet signs.
 *
 * Never a forwarder, EIP-712 relay or meta-transaction: Mezo turned them off
 * after the 5 Oct 2026 veBTC exploit. Every write is a plain transaction
 * from the connected account.
 */

export type WalletOptions = {
  /** WalletConnect metadata: "Matchscan", "Mezo's explorer". */
  app: { name: string; description: string }
  /** The app's WalletConnect project. Under 32 characters hides the row. */
  walletConnectProjectId: string
  /** Extra connectors, loaded once (Pro's Safe connector inside a frame). */
  extraConnectors?: () => Promise<CreateConnectorFn[]>
  /** Runs after the reconnect (Pro connects as the Safe inside a frame). */
  afterReconnect?: (config: Config) => Promise<unknown>
  /**
   * The RPC for reads and simulations, picked per request so a settings
   * change applies without reloading. Defaults to Matchbox's.
   */
  readRpc?: (matchboxRpc: string) => string
  /**
   * Which Mezo the wallet connects to. Defaults to mainnet; "testnet" is
   * Mezo Testnet (chain 31611), for the Developer console's testnet apps.
   */
  network?: "mainnet" | "testnet"
}

/** Mezo Testnet as a viem chain (the URLs the repo already reads). */
export const MEZO_TESTNET = {
  id: CHAIN_ID.testnet,
  name: "Mezo Testnet",
  nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.test.mezo.org"] } },
  blockExplorers: {
    default: { name: "Mezo Explorer", url: "https://explorer.test.mezo.org" },
  },
  contracts: {
    multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" },
  },
  testnet: true,
} as const

/** The chain a network option names. */
export function chainFor(network: WalletOptions["network"]) {
  return network === "testnet" ? MEZO_TESTNET : MEZO_MAINNET
}

export function hasWalletConnect(options: WalletOptions): boolean {
  return options.walletConnectProjectId.length >= 32
}

export const mezoChainId = MEZO_MAINNET.id

let config: Config | null = null
/** The chain the wallet config was made for (mainnet unless asked). */
let activeChainId: number = mezoChainId

function storage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/**
 * WalletConnect's code is about 450 kB. It used to load with the config,
 * so the first Connect tap paid for it (3.6 to 4.6 s on slow 4G) even
 * inside a wallet that only needs the injected provider. Now the config
 * carries its connector only for a browser that last connected through
 * WalletConnect, which needs it to reconnect; everyone else loads it when
 * its row is tapped (`ensureWalletConnect`).
 */
function lastUsedWalletConnect(): boolean {
  try {
    // wagmi's own record, under the config's storage key.
    return (storage()?.getItem("mbx.recentConnectorId") ?? "").includes(
      "walletConnect",
    )
  } catch {
    return false
  }
}

let loadingWalletConnect: Promise<string> | null = null
let walletOptions: WalletOptions | null = null

/** Whether the drawer may offer WalletConnect at all. */
export function walletConnectOffered(): boolean {
  return walletOptions !== null && hasWalletConnect(walletOptions)
}

/**
 * The WalletConnect connector's uid, loading its code and adding it to the
 * config on first use. Rejects when the app has no WalletConnect project.
 */
export function ensureWalletConnect(target: Config): Promise<string> {
  const existing = getConnectors(target).find(
    (connector) => connector.type === "walletConnect",
  )
  if (existing !== undefined) return Promise.resolve(existing.uid)
  const options = walletOptions
  if (options === null || !hasWalletConnect(options)) {
    return Promise.reject(new Error("Wallet not found"))
  }
  loadingWalletConnect ??= walletConnectConnector(options)
    .then((create) => {
      const connector = target._internal.connectors.setup(create)
      target._internal.connectors.setState((current) => [...current, connector])
      return connector.uid
    })
    .catch((error: unknown) => {
      // A failed download can be tried again.
      loadingWalletConnect = null
      throw error
    })
  return loadingWalletConnect
}

async function walletConnectConnector(options: WalletOptions) {
  const { walletConnect } = await import("@wagmi/connectors/walletConnect")
  return walletConnect({
    projectId: options.walletConnectProjectId,
    showQrModal: true,
    metadata: {
      name: options.app.name,
      description: options.app.description,
      url: window.location.origin,
      icons: [`${window.location.origin}/favicon.svg`],
    },
  })
}

/**
 * Reads and simulations through `readRpc`: the custom RPC when one is
 * saved, else Matchbox's. Picked per request. Signing always goes through
 * the wallet.
 */
function settingsTransport(
  matchboxRpc: string,
  readRpc: (matchboxRpc: string) => string,
) {
  const byUrl = new Map<string, ReturnType<ReturnType<typeof http>>>()
  return custom(
    {
      async request({ method, params }) {
        const url = readRpc(matchboxRpc)
        let transport = byUrl.get(url)
        if (transport === undefined) {
          transport = http(url, { batch: { batchSize: 20 } })({
            chain: undefined,
            retryCount: 0,
          })
          byUrl.set(url, transport)
        }
        return transport.request({ method, params })
      },
    },
    { key: "settings-rpc", name: "Settings RPC" },
  )
}

function sameRpc(matchboxRpc: string): string {
  return matchboxRpc
}

/** The wagmi config. `rpcUrl` comes from the Worker's seed. */
export async function walletConfig(
  rpcUrl: string,
  options: WalletOptions,
): Promise<Config> {
  if (config !== null) return config
  walletOptions = options
  const chain = {
    ...chainFor(options.network),
    rpcUrls: { default: { http: [rpcUrl] } },
  } as const
  activeChainId = chain.id
  const transport = settingsTransport(rpcUrl, options.readRpc ?? sameRpc)
  const connectors = [
    injected({ shimDisconnect: true }),
    ...(hasWalletConnect(options) && lastUsedWalletConnect()
      ? [await walletConnectConnector(options)]
      : []),
    ...((await options.extraConnectors?.()) ?? []),
  ]
  const created = createConfig({
    chains: [chain],
    connectors,
    // One chain is configured; the map names both ids only so its type
    // covers either network.
    transports: {
      [MEZO_MAINNET.id]: transport,
      [MEZO_TESTNET.id]: transport,
    },
    multiInjectedProviderDiscovery: true,
    storage: createStorage({ storage: storage() ?? undefined, key: "mbx" }),
    ssr: false,
  })
  config = created
  watchAccount(created, {
    onChange(account) {
      // However the wallet connected (the drawer, a reconnect the drawer
      // caught, the Safe app), the next load reconnects before a sheet opens.
      if (account.status === "connected") rememberConnected()
      setWallet({
        account:
          account.status === "connected"
            ? { address: account.address, chainId: account.chainId }
            : null,
      })
    },
  })
  await reconnect(created).catch(() => undefined)
  await options.afterReconnect?.(created)
  const account = getAccount(created)
  setWallet({
    phase: "ready",
    account:
      account.status === "connected"
        ? { address: account.address, chainId: account.chainId }
        : null,
  })
  return created
}

/** Marks this browser as connected (see `reconnectIfRemembered`). */
function rememberConnected(): void {
  try {
    storage()?.setItem(connectedFlag, "1")
  } catch {
    // Without storage the wallet reconnects on the next intent instead.
  }
}

export function requireConfig(): Config {
  if (config === null) throw new Error("Wallet is not loaded")
  return config
}

export function walletConnectors(target: Config): WalletConnector[] {
  return getConnectors(target).map(toWalletConnector)
}

export function watchWalletConnectors(
  target: Config,
  onChange: (connectors: WalletConnector[]) => void,
): () => void {
  return watchConnectors(target, {
    onChange: (connectors) => onChange(connectors.map(toWalletConnector)),
  })
}

function toWalletConnector(connector: Connector): WalletConnector {
  return {
    uid: connector.uid,
    id: connector.id,
    name: connector.name,
    type: connector.type,
    icon: connector.icon,
  }
}

export function recentWallets(): string[] {
  return readRecent(storage())
}

/** Connects and lands on Mezo. Resolves to the account address. */
export async function connectWallet(
  target: Config,
  connectorUid: string,
): Promise<string> {
  const connector = getConnectors(target).find(
    (candidate) => candidate.uid === connectorUid,
  )
  if (connector === undefined) throw new Error("Wallet not found")
  const result = await connect(target, { connector, chainId: activeChainId })
  const address = result.accounts[0]
  if (address === undefined) throw new Error("Connection failed")
  rememberRecent(storage(), connector.id)
  rememberConnected()
  if (result.chainId !== activeChainId) await switchToMezo(target)
  return address
}

/** Asks the wallet for Mezo; adds the chain first when the wallet lacks it. */
export async function switchToMezo(target: Config): Promise<void> {
  try {
    await switchChain(target, { chainId: activeChainId })
  } catch (error) {
    if (isUserRejection(error)) throw error
    throw new Error("Switch to Mezo in your wallet")
  }
}

/** The connected wallet's name ("MetaMask"), for the Disconnect row. */
export function connectedWalletName(target: Config): string | null {
  return getAccount(target).connector?.name ?? null
}

export async function disconnectWallet(target: Config): Promise<void> {
  await disconnect(target)
  try {
    storage()?.removeItem(connectedFlag)
  } catch {
    // Nothing to clear.
  }
}

/**
 * Asks the connected wallet to sign `message` (personal_sign, EIP-191):
 * proof of an address, never a transaction. Rejection throws the wallet's
 * error (see `isUserRejection`).
 */
export async function signMessage(
  target: Config,
  message: string,
): Promise<`0x${string}`> {
  const account = getAccount(target)
  if (account.status !== "connected") throw new Error("Wallet is not connected")
  return signWithWallet(target, { account: account.address, message })
}
