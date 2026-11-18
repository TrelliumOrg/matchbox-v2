import { z } from "zod"

/**
 * Where the browser's head comes from: a simulated head in fixtures mode,
 * else the BlockHub socket with an optional RPC to poll while it is down.
 * The Worker decides and passes it to the page in the root loader's data.
 */
export type LiveConfig =
  | { mode: "simulated" }
  | { mode: "blockhub"; rpcUrl: string | null }

/** Mezo mainnet's public RPC, for the wallet's reads and simulations. */
export const publicMezoRpc = "https://mainnet.mezo.public.validationcloud.io"

/**
 * The RPC the browser's wallet runtime reads and simulates through:
 * `MEZO_RPC_URL` when set (an Anvil fork in end-to-end tests), else the
 * public one. In every data mode, so fixtures can still sign.
 */
export function walletRpcUrl(mezoRpcUrl: string | undefined): string {
  const rpc = z.url().safeParse(mezoRpcUrl)
  return rpc.success ? rpc.data : publicMezoRpc
}

/** `fixtures` simulates heads; otherwise BlockHub with `MEZO_RPC_URL`. */
export function liveConfig(
  fixtures: boolean,
  mezoRpcUrl: string | undefined,
): LiveConfig {
  if (fixtures) return { mode: "simulated" }
  const rpc = z.url().safeParse(mezoRpcUrl)
  return { mode: "blockhub", rpcUrl: rpc.success ? rpc.data : null }
}
