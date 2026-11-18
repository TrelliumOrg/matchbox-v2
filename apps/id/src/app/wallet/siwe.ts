import type { Config } from "@wagmi/core"
import { signInMessage } from "../../shared/siwe-message"
import { api } from "../lib/api"
import { signWith } from "./wallet-runtime"

/**
 * EIP-4361 sign-in, ported from the old SPA's `useSiweSignIn`: nonce, then
 * the exact message the server accepts (`signInMessage`), then a gasless
 * wallet signature, then `/api/siwe/verify`, which sets the session cookie.
 * The message is prepared before the click so signing opens the wallet at
 * once, and re-issued well before its five minute expiry.
 */

/** The prepared message is re-issued after four minutes. */
export const previewLifetimeMs = 4 * 60_000

export type SiwePreview = {
  message: string
  issuedAt: Date
  address: `0x${string}`
  chainId: number
}

export function isFresh(
  preview: SiwePreview,
  now: number = Date.now(),
): boolean {
  return now - preview.issuedAt.getTime() < previewLifetimeMs
}

/** A fresh nonce and the message naming this origin, wallet and chain. */
export async function prepareSignIn(
  address: `0x${string}`,
  chainId: number,
): Promise<SiwePreview> {
  const { nonce } = await api.siweNonce()
  const issuedAt = new Date()
  const message = signInMessage({
    host: window.location.host,
    origin: window.location.origin,
    address,
    chainId,
    nonce,
    issuedAt,
  })
  return { message, issuedAt, address, chainId }
}

/** Signs the prepared message and verifies it. The nonce is spent either way. */
export async function signIn(
  config: Config,
  preview: SiwePreview,
): Promise<void> {
  const signature = await signWith(config, preview.address, preview.message)
  await api.siweVerify({ message: preview.message, signature })
}
