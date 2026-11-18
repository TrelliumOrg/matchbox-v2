-- Curated brand colours for gauge profiles. Pro and Matchscan tint a gauge's
-- bars, rows and charts with this colour; when it is null the API derives one
-- (a pool's lead token colour, else a stable palette pick).
--
-- Additive only: a nullable column on each profile table, appended as the last
-- column of mbx_api_gauge_profiles so existing explicit-column readers keep
-- working. Applied to production 2026-11-09.

ALTER TABLE public.gauge_profiles
  ADD COLUMN IF NOT EXISTS brand_color text;

ALTER TABLE public.validator_profiles
  ADD COLUMN IF NOT EXISTS brand_color text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'gauge_profiles_brand_color_hex'
  ) THEN
    ALTER TABLE public.gauge_profiles
      ADD CONSTRAINT gauge_profiles_brand_color_hex
      CHECK (brand_color IS NULL OR brand_color ~ '^#[0-9A-F]{6}$');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'validator_profiles_brand_color_hex'
  ) THEN
    ALTER TABLE public.validator_profiles
      ADD CONSTRAINT validator_profiles_brand_color_hex
      CHECK (brand_color IS NULL OR brand_color ~ '^#[0-9A-F]{6}$');
  END IF;
END $$;

COMMENT ON COLUMN public.gauge_profiles.brand_color IS
  'Brand colour as uppercase #RRGGBB, or null to let the API derive one.';
COMMENT ON COLUMN public.validator_profiles.brand_color IS
  'Brand colour as uppercase #RRGGBB, or null to let the API derive one.';

CREATE OR REPLACE VIEW public.mbx_api_gauge_profiles
WITH (security_invoker = true) AS
SELECT
  'mezo'::text AS network,
  'boost-gauge'::text AS profile_type,
  lower(gauge.gauge_address) AS gauge_address,
  gauge.vebtc_token_id,
  NULL::text AS operator_address,
  gauge.display_name,
  gauge.description,
  gauge.profile_picture_url AS avatar_url,
  gauge.website_url,
  CASE
    WHEN jsonb_typeof(gauge.social_links) = 'object'::text
      THEN gauge.social_links
    ELSE '{}'::jsonb
  END AS social_links,
  COALESCE(gauge.tags, ARRAY[]::text[]) AS tags,
  gauge.incentive_strategy,
  gauge.voting_strategy,
  COALESCE(gauge.is_featured, false) AS is_featured,
  COALESCE(gauge.created_at, gauge.updated_at, to_timestamp(0::double precision))
    AS created_at,
  COALESCE(gauge.updated_at, gauge.created_at, to_timestamp(0::double precision))
    AS updated_at,
  lower(gauge.owner_address) AS profile_updated_by,
  ARRAY(
    SELECT DISTINCT trim(BOTH '-'::text FROM regexp_replace(
      lower(tag.tag), '[^a-z0-9]+'::text, '-'::text, 'g'::text
    ))
    FROM unnest(COALESCE(gauge.tags, ARRAY[]::text[])) tag(tag)
  ) AS tag_slugs,
  gauge.brand_color
FROM public.gauge_profiles gauge
UNION ALL
SELECT
  CASE validator.chain_id
    WHEN 31612 THEN 'mezo'::text
    ELSE 'mezo-testnet'::text
  END AS network,
  'validator-gauge'::text AS profile_type,
  lower(validator.gauge_address) AS gauge_address,
  NULL::text AS vebtc_token_id,
  lower(validator.operator_address) AS operator_address,
  validator.display_name,
  validator.description,
  validator.profile_picture_url AS avatar_url,
  validator.website_url,
  CASE
    WHEN jsonb_typeof(validator.social_links) = 'object'::text
      THEN validator.social_links
    ELSE '{}'::jsonb
  END AS social_links,
  COALESCE(validator.tags, ARRAY[]::text[]) AS tags,
  validator.incentive_strategy,
  validator.voting_strategy,
  false AS is_featured,
  validator.created_at,
  validator.updated_at,
  lower(validator.last_editor_address) AS profile_updated_by,
  ARRAY(
    SELECT DISTINCT trim(BOTH '-'::text FROM regexp_replace(
      lower(tag.tag), '[^a-z0-9]+'::text, '-'::text, 'g'::text
    ))
    FROM unnest(COALESCE(validator.tags, ARRAY[]::text[])) tag(tag)
  ) AS tag_slugs,
  validator.brand_color
FROM public.validator_profiles validator
WHERE validator.chain_id = ANY (ARRAY[31611::bigint, 31612::bigint]);
