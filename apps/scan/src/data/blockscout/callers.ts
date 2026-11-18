/**
 * Who the Blockscout proxy is reading for (`@matchbox/contracts/blockscout`
 * callers.ts): this Worker's name, and an opaque key for the visitor, the
 * IPv4 /24 or IPv6 /48 prefix of their address hashed with a salt only this
 * Worker holds. Never a raw IP or wallet address.
 */

/** This Worker's name (wrangler.jsonc), sent as `X-Matchbox-Client`. */
export const scanClientName = "matchscan-v2"

// The key derivation is shared with Pro: @matchbox/contracts/blockscout.
export {
  endUserKey,
  ipPrefix,
  minSaltBytes,
  saltUsable,
} from "@matchbox/contracts/blockscout"
