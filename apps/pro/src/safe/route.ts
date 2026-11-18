import { type Config, getAccount, getCapabilities } from "@wagmi/core"
import { type Address, getAddress } from "viem"
import type { SigningSetting } from "../settings/settings-store"
import { mezoChainId } from "../wallet/wallet-runtime"

/**
 * How a review's primary signs, best first:
 *
 * - "propose": Multisig setting with a Safe saved and an owner's wallet
 *   connected. The batch goes to the Transaction Service as one SafeTx the
 *   owner signs off chain (path 2, the primary Safe flow).
 * - "safe-app": Pro inside Safe{Wallet}, connected as the Safe. One
 *   `sdk.txs.send` (path 1).
 * - "safe-walletconnect": Safe{Wallet} connected to Pro over WalletConnect.
 *   One `wallet_sendCalls` when the Safe supports EIP-5792, else one
 *   proposal per step.
 * - "export": Multisig with no Safe saved. The primary downloads the
 *   Transaction Builder file (path 3).
 * - "wallet": every step signed and sent from the connected wallet.
 *
 * Imports no Safe SDK: it only reads the connector and the setting.
 */

export type SigningRoute =
  | { kind: "wallet" }
  | { kind: "propose"; safe: Address }
  | { kind: "safe-app"; safe: Address }
  | { kind: "safe-walletconnect"; safe: Address; batch: boolean }
  | { kind: "export"; safe: null }

/**
 * The route from the setting alone, before the connector is read.
 * `connected` is the wallet that signs (an owner, for "propose").
 */
export function settingRoute(
  signing: SigningSetting,
  connected: Address,
): SigningRoute {
  if (signing.mode === "wallet") return { kind: "wallet" }
  if (signing.safe === null) return { kind: "export", safe: null }
  const safe = getAddress(signing.safe)
  // Connected as the Safe itself: the connector decides (see below).
  if (safe === getAddress(connected)) return { kind: "wallet" }
  return { kind: "propose", safe }
}

/** The peer a WalletConnect session is connected to, by its name. */
async function walletConnectPeer(config: Config): Promise<string | null> {
  const connector = getAccount(config).connector
  if (connector === undefined || connector.id !== "walletConnect") return null
  try {
    const provider: unknown = await connector.getProvider()
    const session: unknown =
      typeof provider === "object" && provider !== null
        ? Reflect.get(provider, "session")
        : null
    const peer: unknown =
      typeof session === "object" && session !== null
        ? Reflect.get(session, "peer")
        : null
    const metadata: unknown =
      typeof peer === "object" && peer !== null
        ? Reflect.get(peer, "metadata")
        : null
    const name: unknown =
      typeof metadata === "object" && metadata !== null
        ? Reflect.get(metadata, "name")
        : null
    return typeof name === "string" ? name : null
  } catch {
    return null
  }
}

/** Whether the wallet batches calls atomically (EIP-5792). */
async function batchesCalls(
  config: Config,
  account: Address,
): Promise<boolean> {
  try {
    const capabilities: unknown = await getCapabilities(config, {
      account,
      chainId: mezoChainId,
    })
    const atomic: unknown =
      typeof capabilities === "object" && capabilities !== null
        ? Reflect.get(capabilities, "atomic")
        : null
    const status: unknown =
      typeof atomic === "object" && atomic !== null
        ? Reflect.get(atomic, "status")
        : null
    return status === "supported" || status === "ready"
  } catch {
    return false
  }
}

export async function signingRoute(
  config: Config,
  signing: SigningSetting,
): Promise<SigningRoute> {
  const { connector, address } = getAccount(config)
  if (address === undefined) return { kind: "wallet" }
  if (connector?.id === "safe") return { kind: "safe-app", safe: address }
  const peer = await walletConnectPeer(config)
  if (peer !== null && /\bsafe\b/i.test(peer)) {
    return {
      kind: "safe-walletconnect",
      safe: address,
      batch: await batchesCalls(config, address),
    }
  }
  return settingRoute(signing, address)
}

export type SafeRoute = Extract<
  SigningRoute,
  { kind: "propose" | "safe-app" | "safe-walletconnect" }
>

export function isSafeRoute(route: SigningRoute): route is SafeRoute {
  return (
    route.kind === "propose" ||
    route.kind === "safe-app" ||
    route.kind === "safe-walletconnect"
  )
}
