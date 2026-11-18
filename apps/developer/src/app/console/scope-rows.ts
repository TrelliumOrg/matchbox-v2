import type { GlyphName } from "./glyphs"

/**
 * Every scope an environment can request, with the claims it releases and
 * whether people may decline it at consent: `scopeDefinitions` in
 * @matchbox/contracts/scopes, kept here so the page does not load zod; a
 * test pins the two together.
 */
export const scopeRows = [
  {
    scope: "openid",
    label: "Sign-in ID",
    consent: "A unique ID for this app",
    claims: ["sub"],
    optionalAllowed: false,
    glyph: "key",
  },
  {
    scope: "wallet",
    label: "Wallet",
    consent: "Wallet address and network",
    claims: ["wallet_address", "wallet_network"],
    optionalAllowed: true,
    glyph: "wallet",
  },
  {
    scope: "discord:id",
    label: "Discord ID",
    consent: "Linked Discord user ID",
    claims: ["discord_id"],
    optionalAllowed: true,
    glyph: "user-round",
  },
  {
    scope: "discord:profile",
    label: "Discord profile",
    consent: "Discord username, display name and avatar",
    claims: ["discord_username", "discord_display_name", "discord_avatar_url"],
    optionalAllowed: true,
    glyph: "user",
  },
  {
    scope: "discord:membership",
    label: "Mezo Discord membership",
    consent: "When you joined the Mezo Discord server",
    claims: ["discord_joined_at"],
    optionalAllowed: true,
    glyph: "users",
  },
  {
    scope: "gauge-profiles:read",
    label: "Gauge and market data",
    consent: "Read public gauge, incentive and epoch data",
    claims: [],
    optionalAllowed: false,
    glyph: "chart",
  },
] as const satisfies readonly {
  scope: string
  label: string
  consent: string
  claims: readonly string[]
  optionalAllowed: boolean
  glyph: GlyphName
}[]

export type ScopeName = (typeof scopeRows)[number]["scope"]
