-- Matchbox ID accounts that may have signed in with a Bitcoin wallet
-- (Mezo Passport) in Classic, and what they hold. Read-only: run each query
-- as a human, in a read-only transaction, against the production database.
-- Nothing here writes, and the results carry no wallet address, email or
-- name: only internal ids, dates and counts.
--
-- How the accounts are found. Classic signed a Bitcoin wallet in as its
-- Passport smart account on Mezo mainnet (chain 31612), and verified the
-- signature as a contract signature (ERC-1271 / ERC-6492), so its sessions
-- have signer_kind = 'contract' and siwe_chain_id = 31612. The database
-- does not record which wallet app signed, so Safe and other smart-contract
-- wallets on mainnet are in the same set: treat the counts as an upper
-- bound. Sessions from before signer_kind existed (NULL) say nothing and
-- are counted apart (query 4).

BEGIN TRANSACTION READ ONLY;

-- 1. How many, and what they still have.
WITH candidates AS (
  SELECT session.account_id
  FROM public.mbx_id_sessions AS session
  WHERE session.signer_kind IS NOT NULL
  GROUP BY session.account_id
  HAVING bool_or(session.signer_kind = 'contract' AND session.siwe_chain_id = 31612)
     AND NOT bool_or(session.signer_kind = 'eoa')
)
SELECT
  count(*) AS accounts,
  count(*) FILTER (WHERE account.disabled_at IS NULL) AS not_disabled,
  count(*) FILTER (
    WHERE EXISTS (
      SELECT 1 FROM public.mbx_id_sessions AS session
      WHERE session.account_id = candidates.account_id
        AND session.revoked_at IS NULL
        AND session.expires_at > now()
    )
  ) AS with_active_session,
  count(*) FILTER (
    WHERE EXISTS (
      SELECT 1 FROM public.mbx_id_grants AS grant_row
      WHERE grant_row.account_id = candidates.account_id
        AND grant_row.revoked_at IS NULL
    )
  ) AS with_connected_app
FROM candidates
JOIN public.mbx_id_accounts AS account ON account.id = candidates.account_id;

-- 2. One row per account, without personal data.
WITH candidates AS (
  SELECT session.account_id
  FROM public.mbx_id_sessions AS session
  WHERE session.signer_kind IS NOT NULL
  GROUP BY session.account_id
  HAVING bool_or(session.signer_kind = 'contract' AND session.siwe_chain_id = 31612)
     AND NOT bool_or(session.signer_kind = 'eoa')
)
SELECT
  account.id AS account_id,
  account.created_at::date AS created_on,
  account.last_sign_in_at::date AS last_sign_in_on,
  account.disabled_at IS NOT NULL AS disabled,
  (
    SELECT count(*) FROM public.mbx_id_sessions AS session
    WHERE session.account_id = account.id
      AND session.revoked_at IS NULL
      AND session.expires_at > now()
  ) AS active_sessions,
  (
    SELECT count(DISTINCT grant_row.app_id) FROM public.mbx_id_grants AS grant_row
    WHERE grant_row.account_id = account.id
      AND grant_row.revoked_at IS NULL
  ) AS connected_apps
FROM candidates
JOIN public.mbx_id_accounts AS account ON account.id = candidates.account_id
ORDER BY account.last_sign_in_at DESC NULLS LAST;

-- 3. Their connected apps, per app (to tell those apps' developers).
WITH candidates AS (
  SELECT session.account_id
  FROM public.mbx_id_sessions AS session
  WHERE session.signer_kind IS NOT NULL
  GROUP BY session.account_id
  HAVING bool_or(session.signer_kind = 'contract' AND session.siwe_chain_id = 31612)
     AND NOT bool_or(session.signer_kind = 'eoa')
)
SELECT
  app.id AS app_id,
  app.name AS app_name,
  count(DISTINCT grant_row.account_id) AS affected_accounts
FROM public.mbx_id_grants AS grant_row
JOIN candidates ON candidates.account_id = grant_row.account_id
JOIN public.mbx_dev_apps AS app ON app.id = grant_row.app_id
WHERE grant_row.revoked_at IS NULL
GROUP BY app.id, app.name
ORDER BY affected_accounts DESC;

-- 4. Accounts whose sessions all predate signer_kind: unknown wallet kind.
SELECT count(*) AS accounts_with_unknown_signer
FROM public.mbx_id_accounts AS account
WHERE NOT EXISTS (
  SELECT 1 FROM public.mbx_id_sessions AS session
  WHERE session.account_id = account.id
    AND session.signer_kind IS NOT NULL
);

-- Developer console organizations and apps are not affected: console
-- accounts (mbx_dev_accounts) sign in with Google and hold no wallet and no
-- reference to mbx_id_accounts, so nothing joins them to these accounts.

ROLLBACK;
