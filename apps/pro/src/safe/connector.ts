import {
  type Config,
  type CreateConnectorFn,
  connect,
  getAccount,
  getConnectors,
} from "@wagmi/core"
import { insideFrame } from "./frame"
import { safeAppDomains } from "./safe-app"

export { insideFrame }

/**
 * Pro inside the Safe{Wallet} iframe connects as the Safe through wagmi's
 * `safe` connector (address and chain from the Apps SDK). Both load only
 * inside an iframe, so a normal visit never fetches them. Wallet runtime
 * calls these two (see the hook in wallet-runtime.ts).
 */

/** The extra connectors for walletConfig: the Safe one inside a frame. */
export async function safeConnectors(): Promise<CreateConnectorFn[]> {
  if (!insideFrame()) return []
  const { safe } = await import("@wagmi/connectors/safe")
  return [
    safe({
      allowedDomains: safeAppDomains,
      shimDisconnect: false,
      unstable_getInfoTimeout: 500,
    }),
  ]
}

/** Inside Safe{Wallet}, connects as the Safe without a click. */
export async function connectInsideSafe(config: Config): Promise<boolean> {
  if (!insideFrame()) return false
  if (getAccount(config).connector?.id === "safe") return true
  const connector = getConnectors(config).find((each) => each.id === "safe")
  if (connector === undefined) return false
  try {
    await connect(config, { connector })
    return true
  } catch {
    return false
  }
}
