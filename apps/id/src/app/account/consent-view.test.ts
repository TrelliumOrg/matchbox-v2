import type { ConsentScope } from "@matchbox/contracts/identity"
import { describe, expect, it } from "vitest"
import { declinedScopes, initiallyOff } from "./consent-view"

function scope(
  name: ConsentScope["scope"],
  overrides: Partial<ConsentScope> = {},
): ConsentScope {
  return {
    scope: name,
    label: name,
    description: name,
    claims: [],
    available: true,
    unavailableReason: null,
    previouslyGranted: false,
    ...overrides,
  }
}

describe("consent toggles", () => {
  const scopes = [
    scope("openid"),
    scope("wallet", { requirement: "required" }),
    scope("discord:id", { requirement: "optional" }),
    scope("discord:profile", {
      requirement: "optional",
      previouslyDeclined: true,
    }),
    scope("discord:membership", {
      requirement: "optional",
      available: false,
      unavailableReason: "discord-not-linked",
    }),
  ]

  it("starts optional scopes off when declined before or unavailable", () => {
    expect([...initiallyOff(scopes)].sort()).toEqual([
      "discord:membership",
      "discord:profile",
    ])
  })

  it("never treats a required scope as optional, even without a requirement", () => {
    const off = new Set(["openid", "wallet", "discord:id"])
    expect(declinedScopes(scopes, off)).toEqual(["discord:id"])
  })

  it("declines only available optional scopes", () => {
    expect(declinedScopes(scopes, initiallyOff(scopes))).toEqual([
      "discord:profile",
    ])
  })
})
