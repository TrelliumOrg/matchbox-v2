import type SafeAppsSDK from "@safe-global/safe-apps-sdk"
import type { Hex } from "viem"
import type { PreparedCall } from "../tx/plans"
import { safeWebOrigin } from "./urls"

/**
 * Path 1: Pro running inside Safe{Wallet} as a Safe App. The Apps SDK loads
 * on first use (only inside the Safe iframe) and proposes the whole batch
 * with one `sdk.txs.send`, which Safe{Wallet} turns into one MultiSend
 * transaction for the owners. The owner signs in Safe{Wallet}, not here.
 */

export const safeAppDomains = [
  new RegExp(`^${safeWebOrigin.replaceAll(".", "\\.")}$`),
]

let sdk: Promise<SafeAppsSDK> | null = null

export function safeAppsSdk(): Promise<SafeAppsSDK> {
  sdk ??= import("@safe-global/safe-apps-sdk").then(
    ({ default: SDK }) => new SDK({ allowedDomains: safeAppDomains }),
  )
  return sdk
}

export async function sendFromSafeApp(
  calls: readonly PreparedCall[],
): Promise<Hex> {
  const client = await safeAppsSdk()
  const { safeTxHash } = await client.txs.send({
    txs: calls.map((call) => ({
      to: call.to,
      value: (call.value ?? 0n).toString(),
      data: call.data,
    })),
  })
  if (!/^0x[0-9a-fA-F]{64}$/.test(safeTxHash)) {
    throw new Error("Safe returned no transaction")
  }
  return `0x${safeTxHash.slice(2)}`
}
