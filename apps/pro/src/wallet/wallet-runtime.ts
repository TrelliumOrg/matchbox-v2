import { MEZO_MAINNET } from "@matchbox/chain"
import {
  type Config,
  type Connector,
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
  switchChain,
  watchAccount,
  watchConnectors,
} from "@wagmi/core"
import { connectInsideSafe, safeConnectors } from "../safe/connector"
import { readRpc } from "../settings/settings-store"
import { reconnectLimitMs, within } from "./reconnect-limit"
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

/**
 * Pro's WalletConnect project. Public: it ships in the client bundle of
 * every WalletConnect dapp. Committed so every build (CI, previews) shows
 * the WalletConnect row; VITE_WALLET_CONNECT_PROJECT_ID overrides it.
 */
const defaultWalletConnectProjectId = "0bb73069e0eb41e3044476c5338cd586"

const envWalletConnectProjectId: string =
  import.meta.env.VITE_WALLET_CONNECT_PROJECT_ID ?? ""

const walletConnectProjectId: string =
  envWalletConnectProjectId === ""
    ? defaultWalletConnectProjectId
    : envWalletConnectProjectId

export const hasWalletConnect = walletConnectProjectId.length >= 32

export const mezoChainId = MEZO_MAINNET.id

let config: Config | null = null

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

/** Whether the drawer may offer WalletConnect at all. */
export function walletConnectOffered(): boolean {
  return hasWalletConnect
}

/**
 * The WalletConnect connector's uid, loading its code and adding it to the
 * config on first use.
 */
export function ensureWalletConnect(target: Config): Promise<string> {
  const existing = getConnectors(target).find(
    (connector) => connector.type === "walletConnect",
  )
  if (existing !== undefined) return Promise.resolve(existing.uid)
  if (!hasWalletConnect) return Promise.reject(new Error("Wallet not found"))
  loadingWalletConnect ??= walletConnectConnector()
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

async function walletConnectConnector() {
  const { walletConnect } = await import("@wagmi/connectors/walletConnect")
  return walletConnect({
    projectId: walletConnectProjectId,
    showQrModal: true,
    metadata: {
      name: "Matchbox Pro",
      description: "Vote, claim and lock on Mezo Earn.",
      url: window.location.origin,
      icons: [`${window.location.origin}/favicon.svg`],
    },
  })
}

/**
 * Reads and simulations through the Network setting: the custom RPC when one
 * is saved, else Matchbox's. Picked per request, so a change in the Account
 * panel applies without reloading. Signing always goes through the wallet.
 */
function settingsTransport(matchboxRpc: string) {
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

/** The wagmi config. `rpcUrl` comes from the Worker's market seed. */
export async function walletConfig(rpcUrl: string): Promise<Config> {
  if (config !== null) return config
  const chain = {
    ...MEZO_MAINNET,
    rpcUrls: { default: { http: [rpcUrl] } },
  } as const
  // Inside Safe{Wallet} (a Safe App) the Safe connector joins the list.
  const connectors = [
    injected({ shimDisconnect: true }),
    ...(hasWalletConnect && lastUsedWalletConnect()
      ? [await walletConnectConnector()]
      : []),
    ...(await safeConnectors()),
  ]
  const created = createConfig({
    chains: [chain],
    connectors,
    transports: { [chain.id]: settingsTransport(rpcUrl) },
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
  // A wallet that never answers would leave the screens waiting: past the
  // limit they settle without it, and `watchAccount` picks up a late answer.
  await within(
    (async () => {
      await reconnect(created).catch(() => undefined)
      await connectInsideSafe(created)
    })(),
    reconnectLimitMs,
  )
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

/** The config, or null while it loads or after its code failed to load. */
export function loadedConfig(): Config | null {
  return config
}

/** Test helper: forgets the config, as a new tab would. */
export function resetWalletConfig(): void {
  config = null
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
  const result = await connect(target, { connector, chainId: mezoChainId })
  const address = result.accounts[0]
  if (address === undefined) throw new Error("Connection failed")
  rememberRecent(storage(), connector.id)
  rememberConnected()
  if (result.chainId !== mezoChainId) await switchToMezo(target)
  return address
}

/** Asks the wallet for Mezo; adds the chain first when the wallet lacks it. */
export async function switchToMezo(target: Config): Promise<void> {
  try {
    await switchChain(target, { chainId: mezoChainId })
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
