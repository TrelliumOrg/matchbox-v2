import {
  blockscoutClientSchema,
  blockscoutEndUserSchema,
} from "@matchbox/contracts/blockscout"
import { describe, expect, it } from "vitest"
import { endUserKey, ipPrefix, saltUsable, scanClientName } from "./callers"

describe("Blockscout callers", () => {
  it("names this Worker in the form the proxy accepts", () => {
    expect(blockscoutClientSchema.safeParse(scanClientName).success).toBe(true)
  })

  it("keeps the IPv4 /24 and IPv6 /48", () => {
    expect(ipPrefix("203.0.113.7")).toBe("203.0.113")
    expect(ipPrefix("2001:db8:85a3::8a2e:370:7334")).toBe("2001:db8:85a3")
    expect(ipPrefix("2001:0db8:0000:0042::1")).toBe("2001:db8:0")
    expect(ipPrefix("::1")).toBe("0:0:0")
    expect(ipPrefix("999.0.0.1")).toBeNull()
    expect(ipPrefix("not an ip")).toBeNull()
    expect(ipPrefix("1:2:3:4:5:6:7:8:9")).toBeNull()
  })

  const salt = "s".repeat(32)
  const pepper = "p".repeat(32)

  it("hashes the prefix with the salt into a key the proxy accepts", async () => {
    const key = await endUserKey("203.0.113.7", salt)
    expect(key).not.toBeNull()
    expect(blockscoutEndUserSchema.safeParse(key).success).toBe(true)
    // Same /24, same key; another /24 or salt, another key.
    expect(await endUserKey("203.0.113.200", salt)).toBe(key)
    expect(await endUserKey("203.0.114.7", salt)).not.toBe(key)
    expect(await endUserKey("203.0.113.7", pepper)).not.toBe(key)
    // Never the raw address.
    expect(key).not.toContain("203")
  })

  it("sends no key without an IP or a salt", async () => {
    expect(await endUserKey(null, salt)).toBeNull()
    expect(await endUserKey("203.0.113.7", undefined)).toBeNull()
    expect(await endUserKey("203.0.113.7", "")).toBeNull()
  })

  it("fails closed on a salt under 32 bytes, never hashing without one", async () => {
    expect(saltUsable("s".repeat(31))).toBe(false)
    expect(saltUsable(salt)).toBe(true)
    expect(await endUserKey("203.0.113.7", "s".repeat(31))).toBeNull()
  })
})
