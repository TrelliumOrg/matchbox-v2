import {
  emptyGaugeProfileChainState,
  type GaugeProfile,
} from "@matchbox/contracts/gauge-profiles"
import { z } from "zod"
import { profileFromRow, profileViewRowSchema } from "./profile-rows"

// Curated gauge profiles read straight from Supabase's two public tables
// (`gauge_profiles` and `validator_profiles`, both readable with the
// project's publishable key under RLS). The preview Worker uses this for real
// names and pictures without the service-role secret the live API holds;
// the result matches what `mbx_api_gauge_profiles` serves.

export type PublicProfileSource = {
  /** `https://<ref>.supabase.co`. */
  url: string
  /** The publishable (anon) key; public by design. */
  key: string
}

export type ProfileFetch = (
  input: string,
  init: RequestInit,
) => Promise<Response>

const mainnetChainId = 31_612

const boostRowSchema = z.object({
  gauge_address: z.string(),
  vebtc_token_id: z.string().nullable(),
  display_name: z.string().nullable(),
  description: z.string().nullable(),
  profile_picture_url: z.string().nullable(),
  brand_color: z.string().nullable().optional(),
  website_url: z.string().nullable(),
  social_links: z.unknown(),
  tags: z.array(z.string()).nullable(),
  incentive_strategy: z.string().nullable(),
  voting_strategy: z.string().nullable(),
  is_featured: z.boolean().nullable(),
  created_at: z.string().nullable(),
  updated_at: z.string().nullable(),
})

const validatorRowSchema = z.object({
  gauge_address: z.string(),
  operator_address: z.string().nullable(),
  display_name: z.string().nullable(),
  description: z.string().nullable(),
  profile_picture_url: z.string().nullable(),
  brand_color: z.string().nullable().optional(),
  website_url: z.string().nullable(),
  social_links: z.unknown(),
  tags: z.array(z.string()).nullable(),
  incentive_strategy: z.string().nullable(),
  voting_strategy: z.string().nullable(),
  chain_id: z.number().int(),
  created_at: z.string().nullable(),
  updated_at: z.string().nullable(),
})

const epochIso = "1970-01-01T00:00:00+00:00"

async function select(
  source: PublicProfileSource,
  fetcher: ProfileFetch,
  path: string,
): Promise<unknown> {
  const response = await fetcher(`${source.url}/rest/v1/${path}`, {
    headers: {
      apikey: source.key,
      Authorization: `Bearer ${source.key}`,
      Accept: "application/json",
    },
  })
  if (!response.ok) {
    throw new Error(
      `Supabase ${path.split("?")[0]} answered ${response.status}`,
    )
  }
  return response.json()
}

/** Every mainnet profile, boost and validator, as `GaugeProfile`s. */
export async function readPublicProfiles(
  source: PublicProfileSource,
  fetcher: ProfileFetch = (input, init) => fetch(input, init),
): Promise<GaugeProfile[]> {
  const [boostRows, validatorRows] = await Promise.all([
    select(source, fetcher, "gauge_profiles?select=*&limit=1000"),
    select(
      source,
      fetcher,
      `validator_profiles?select=*&chain_id=eq.${mainnetChainId}&limit=1000`,
    ),
  ])
  const candidates = [
    ...z
      .array(boostRowSchema)
      .parse(boostRows)
      .map((row) => ({
        network: "mezo",
        profile_type: "boost-gauge",
        gauge_address: row.gauge_address,
        vebtc_token_id: row.vebtc_token_id,
        operator_address: null,
        display_name: row.display_name,
        description: row.description,
        avatar_url: row.profile_picture_url,
        brand_color: row.brand_color ?? null,
        website_url: row.website_url,
        social_links: row.social_links,
        tags: row.tags,
        incentive_strategy: row.incentive_strategy,
        voting_strategy: row.voting_strategy,
        is_featured: row.is_featured,
        created_at: row.created_at ?? row.updated_at ?? epochIso,
        updated_at: row.updated_at ?? row.created_at ?? epochIso,
      })),
    ...z
      .array(validatorRowSchema)
      .parse(validatorRows)
      .map((row) => ({
        network: "mezo",
        profile_type: "validator-gauge",
        gauge_address: row.gauge_address,
        vebtc_token_id: null,
        operator_address: row.operator_address,
        display_name: row.display_name,
        description: row.description,
        avatar_url: row.profile_picture_url,
        brand_color: row.brand_color ?? null,
        website_url: row.website_url,
        social_links: row.social_links,
        tags: row.tags,
        incentive_strategy: row.incentive_strategy,
        voting_strategy: row.voting_strategy,
        is_featured: false,
        created_at: row.created_at ?? row.updated_at ?? epochIso,
        updated_at: row.updated_at ?? row.created_at ?? epochIso,
      })),
  ]
  const profiles: GaugeProfile[] = []
  for (const candidate of candidates) {
    const row = profileViewRowSchema.safeParse(candidate)
    if (!row.success) continue
    const mapped = profileFromRow(row.data, emptyGaugeProfileChainState)
    if (mapped.ok) profiles.push(mapped.profile)
  }
  return profiles
}
