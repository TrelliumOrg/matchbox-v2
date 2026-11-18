import { MEZO_MAINNET } from "@matchbox/chain"
import {
  type Config,
  type Connector,
  connect,
  createConfig,
  createStorage,
  getAccount,
  getConnectors,
  http,
  injected,
  reconnect,
  signMessage,
  switchChain,
  watchAccount,
  watchConnectors,
} from "@wagmi/core"
import type { Chain } from "viem"
import { connectedFlag, setWallet, type WalletAccount } from "./wallet-store"
import {
  isUserRejection,
  readRecent,
  rememberRecent,
  type WalletConnector,
} from "./wallets"

/**
 * wagmi for sign-in, created once per tab and loaded only behind the wallet
 * drawer. Mezo mainnet first; Mezo Testnet for contract accounts that must
 * sign in on a test app's network (`/sign-in?chain=31611`). The wallet only
 * signs a message here: no transaction is ever sent.
 */

// Matchbox's WalletConnect project (public: it ships in every dapp bundle).
const defaultWalletConnectProjectId = "0bb73069e0eb41e3044476c5338cd586"
const envWalletConnectProjectId: string =
  import.meta.env.VITE_WALLET_CONNECT_PROJECT_ID ?? ""
const walletConnectProjectId =
  envWalletConnectProjectId === ""
    ? defaultWalletConnectProjectId
    : envWalletConnectProjectId

export const hasWalletConnect = walletConnectProjectId.length >= 32

const mainnetRpc = "https://rpc-internal.mezo.org"
const testnetRpc = "https://rpc.test.mezo.org"

const mezoMainnet = {
  ...MEZO_MAINNET,
  rpcUrls: { default: { http: [mainnetRpc] } },
} as const satisfies Chain

const mezoTestnet = {
  id: 31611,
  name: "Mezo Testnet",
  nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
  rpcUrls: { default: { http: [testnetRpc] } },
  blockExplorers: {
    default: { name: "Mezo Explorer", url: "https://explorer.test.mezo.org" },
  },
} as const satisfies Chain

let config: Config | null = null

function storage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

async function walletConnectConnector() {
  const { walletConnect } = await import("@wagmi/connectors/walletConnect")
  return walletConnect({
    projectId: walletConnectProjectId,
    showQrModal: true,
    metadata: {
      name: "Matchbox ID",
      description: "Sign in with your wallet",
      url: window.location.origin,
      icons: [`${window.location.origin}/favicon-light.png`],
    },
  })
}

function snapshotOf(target: Config): WalletAccount | null {
  const account = getAccount(target)
  return account.status === "connected"
    ? {
        address: account.address,
        chainId: account.chainId,
        walletName: account.connector?.name ?? null,
      }
    : null
}

function rememberConnected(): void {
  try {
    storage()?.setItem(connectedFlag, "1")
  } catch {
    // Without storage the wallet reconnects on the next intent instead.
  }
}

export async function walletConfig(): Promise<Config> {
  if (config !== null) return config
  const created = createConfig({
    chains: [mezoMainnet, mezoTestnet],
    connectors: [
      injected({ shimDisconnect: true }),
      ...(hasWalletConnect ? [await walletConnectConnector()] : []),
    ],
    transports: {
      [mezoMainnet.id]: http(mainnetRpc),
      [mezoTestnet.id]: http(testnetRpc),
    },
    multiInjectedProviderDiscovery: true,
    storage: createStorage({ storage: storage() ?? undefined, key: "mbx-id" }),
    ssr: false,
  })
  config = created
  watchAccount(created, {
    onChange(account) {
      if (account.status === "connected") rememberConnected()
      setWallet({ account: snapshotOf(created) })
    },
  })
  await reconnect(created).catch(() => undefined)
  setWallet({ phase: "ready", account: snapshotOf(created) })
  return created
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

/** Connects on `chainId`. Resolves to the account address. */
export async function connectWallet(
  target: Config,
  connectorUid: string,
  chainId: number,
): Promise<string> {
  const connector = getConnectors(target).find(
    (candidate) => candidate.uid === connectorUid,
  )
  if (connector === undefined) throw new Error("Wallet not found")
  const result = await connect(target, { connector, chainId })
  const address = result.accounts[0]
  if (address === undefined) throw new Error("Connection failed")
  rememberRecent(storage(), connector.id)
  rememberConnected()
  if (result.chainId !== chainId) await switchTo(target, chainId)
  return address
}

/** Asks the wallet for `chainId`; adds the chain first when it lacks it. */
export async function switchTo(target: Config, chainId: number): Promise<void> {
  try {
    await switchChain(target, {
      chainId: chainId === mezoTestnet.id ? mezoTestnet.id : mezoMainnet.id,
    })
  } catch (error) {
    if (isUserRejection(error)) throw error
    throw new Error("Switch network in your wallet")
  }
}

/** EIP-191 personal_sign of the exact sign-in message. */
export function signWith(
  target: Config,
  account: `0x${string}`,
  message: string,
): Promise<`0x${string}`> {
  return signMessage(target, { account, message })
}
