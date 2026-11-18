import { describe, expect, it } from "vitest"
import { readPublicProfiles } from "./public-profiles"

const source = { url: "https://ref.supabase.co", key: "sb_publishable_test" }

const boostRow = {
  gauge_address: "0x0446C77E713C575B65D9BE6A519B3E2FC98E23D5",
  vebtc_token_id: "1012",
  owner_address: "0x1",
  display_name: "pykie's gauge",
  description: "A gauge",
  profile_picture_url: "https://ref.supabase.co/storage/v1/object/public/a.png",
  website_url: null,
  social_links: { x: "https://x.com/pykie" },
  tags: ["DeFi"],
  incentive_strategy: null,
  voting_strategy: null,
  is_featured: null,
  created_at: "2026-01-02T03:04:05.123456+00:00",
  updated_at: null,
}

const validatorRow = {
  gauge_address: "0x8bf9b85295b59a36cb86ff3761cdbb45b0d721ab",
  operator_address: "0x148C5B29CEA37000B8B8FE0E48382D18B1CF522C",
  display_name: "StakingCabin",
  description: null,
  profile_picture_url: null,
  website_url: "https://stakingcabin.example",
  social_links: null,
  tags: null,
  incentive_strategy: null,
  voting_strategy: null,
  chain_id: 31_612,
  created_at: "2026-02-01T00:00:00+00:00",
  updated_at: "2026-02-02T00:00:00+00:00",
}

describe("public profiles", () => {
  it("maps both public tables to gauge profiles with the publishable key", async () => {
    const requests: { url: string; apikey: string | null }[] = []
    const profiles = await readPublicProfiles(source, async (url, init) => {
      requests.push({ url, apikey: new Headers(init.headers).get("apikey") })
      const rows = url.includes("validator_profiles")
        ? [validatorRow]
        : [boostRow]
      return Response.json(rows)
    })
    expect(requests.map((request) => request.apikey)).toEqual([
      source.key,
      source.key,
    ])
    expect(requests[1]?.url).toContain("chain_id=eq.31612")
    expect(profiles).toEqual([
      expect.objectContaining({
        profileType: "boost-gauge",
        gaugeAddress: "0x0446c77e713c575b65d9be6a519b3e2fc98e23d5",
        vebtcTokenId: "1012",
        displayName: "pykie's gauge",
        avatarUrl: boostRow.profile_picture_url,
        brandColor: null,
        socialLinks: { x: "https://x.com/pykie" },
        isFeatured: false,
      }),
      expect.objectContaining({
        profileType: "validator-gauge",
        operatorAddress: "0x148c5b29cea37000b8b8fe0e48382d18b1cf522c",
        displayName: "StakingCabin",
        avatarUrl: null,
        brandColor: null,
        tags: [],
      }),
    ])
  })

  it("fails loudly when Supabase refuses", async () => {
    await expect(
      readPublicProfiles(
        source,
        async () => new Response("no", { status: 401 }),
      ),
    ).rejects.toThrow("answered 401")
  })
})
