import { z } from "zod"

// Who is asking the Blockscout proxy, so one end user cannot spend the
// upstream budget every caller shares. The calling Worker sets both headers
// on its service binding request; neither is a credential (only binding
// callers reach /internal/* at all).
//
// - `X-Matchbox-Client`: the calling Worker, e.g. `scan`, `stuart`.
// - `X-Matchbox-End-User`: an opaque key for the end user the call is made
//   for. Derive it from the visitor's IP prefix (IPv4 /24, IPv6 /48) hashed
//   with a salt the caller keeps, base64url, 22 to 64 characters. Never
//   send a raw IP or wallet address.
//
// A request without them shares one small anonymous bucket per client.

export const blockscoutClientHeader = "X-Matchbox-Client"
export const blockscoutEndUserHeader = "X-Matchbox-End-User"

export const blockscoutClientSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]{1,31}$/, "Expected a lower-case Worker name")

export const blockscoutEndUserSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{22,64}$/, "Expected a base64url key")

export type BlockscoutCaller = {
  client: string | null
  endUser: string | null
}

// Deriving `X-Matchbox-End-User`, shared by every calling Worker (Scan,
// Pro): the visitor's IPv4 /24 or IPv6 /48 prefix hashed with a salt only
// that Worker holds. Never a raw IP or wallet address.

/** "203.0.113.7" to "203.0.113", "2001:db8:85a3::8a2e" to "2001:db8:85a3". */
export function ipPrefix(ip: string): string | null {
  const value = ip.trim()
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value)
  if (v4 !== null) {
    const octets = v4.slice(1, 4).map(Number)
    if (octets.some((octet) => octet > 255) || Number(v4[4]) > 255) return null
    return octets.join(".")
  }
  if (!/^[0-9a-f:]+$/i.test(value) || !value.includes(":")) return null
  const halves = value.toLowerCase().split("::")
  if (halves.length > 2) return null
  const head = halves[0] === "" ? [] : (halves[0] ?? "").split(":")
  const tail =
    halves.length === 2 && halves[1] !== "" ? (halves[1] ?? "").split(":") : []
  const missing = 8 - head.length - tail.length
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null
  const groups = [...head, ...Array<string>(missing).fill("0"), ...tail]
  if (groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null
  return groups
    .slice(0, 3)
    .map((group) => group.replace(/^0+(?=.)/, ""))
    .join(":")
}

function base64Url(bytes: ArrayBuffer): string {
  let binary = ""
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

/** The shortest salt used: 32 bytes, so the key cannot be brute forced. */
export const minSaltBytes = 32

/** Whether `salt` is long enough to key end users with. */
export function saltUsable(salt: string | undefined): salt is string {
  return (
    salt !== undefined && new TextEncoder().encode(salt).length >= minSaltBytes
  )
}

/**
 * The end-user key for `X-Matchbox-End-User`: SHA-256 of the salt and the
 * IP prefix, base64url (43 characters). Null without a usable IP or a salt
 * of at least 32 bytes: the request then shares the anonymous bucket.
 */
export async function endUserKey(
  ip: string | null,
  salt: string | undefined,
): Promise<string | null> {
  // Fails closed: without a usable salt no key is sent at all (the shared
  // anonymous bucket), never a hash of the bare IP prefix.
  if (ip === null || !saltUsable(salt)) return null
  const prefix = ipPrefix(ip)
  if (prefix === null) return null
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${salt}\n${prefix}`),
  )
  return base64Url(digest)
}
