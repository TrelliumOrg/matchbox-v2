# Matchbox ID (`id.matchbox.markets`)

OIDC provider with SIWE (EIP-4361) wallet sign-in, consent, connected apps and
session management. Worker `matchbox-id`, custom domain `id.matchbox.markets`,
issuer `https://id.matchbox.markets`.

The Hono OIDC server (`src/worker`) is ported from `apps/matchbox-id` in
`MallardLabs/Matchbox` at `origin/main` 5c657b5 (6 Nov 2026), which includes
every 29 Oct audit fix. Behaviour is unchanged; only imports moved to
`@matchbox/contracts`, `@matchbox/server` and `@matchbox/logger`.

## Layout

- `src/worker`: the Hono OIDC server, unchanged from the live Worker.
- `src/server.ts`: the Worker entry. `/api/*`, `/oauth/*` and
  `/.well-known/*` go to the OIDC server; everything else is a TanStack Start
  page with a fresh CSP nonce on every inline script (`src/shared/csp.ts`).
- `src/routes`, `src/app`: the pages (sign in, consent, account with
  connected apps, sessions and appearance, error). Loaders read the OIDC
  server's GET routes in-process through server functions
  (`src/app/data`), so pages render with their data and zod stays on the
  server. Every write (SIWE, consent decisions, revokes, sign out) is sent
  by the browser to `/api/*`, so the same-origin and rate-limit checks see
  the real request.
- Wallet code (wagmi, connectors) loads behind the wallet drawer on first
  intent (`src/app/wallet`, the Pro pattern).

## Commands

```sh
pnpm --filter @matchbox/id dev             # vite dev, http://localhost:5180
pnpm --filter @matchbox/id build
pnpm --filter @matchbox/id preview         # the built Worker in workerd
pnpm --filter @matchbox/id test
pnpm --filter @matchbox/id typecheck       # pages and Worker, two programs
pnpm --filter @matchbox/id keys:generate   # prints a fresh OIDC_SIGNING_KEYS value
```

This app has answered id.matchbox.markets since 13 Nov 2026 (it replaced Classic's Worker of the
same name). Build without `CLOUDFLARE_ENV` for production, check
`dist/server/wrangler.json`, then `wrangler deploy` from the app's folder.

## Environments are fixed at build time

The Cloudflare Vite plugin writes the Worker's config into
`dist/server/wrangler.json` when it builds, with the vars of the
environment named by `CLOUDFLARE_ENV` at that moment; `wrangler deploy`
ships that file whatever `--env` says later. Build each environment on its
own:

```sh
pnpm --filter @matchbox/id build                         # production
CLOUDFLARE_ENV=staging pnpm --filter @matchbox/id build  # staging
```

`pnpm build` ends with `scripts/check-build-env.mjs`, which fails when the
built Worker's name or `ISSUER` are not the ones `wrangler.jsonc` gives the
requested environment.

## Local development

```sh
cp .dev.vars.example .dev.vars
pnpm --filter @matchbox/id --silent keys:generate   # paste into OIDC_SIGNING_KEYS
pnpm --filter @matchbox/id dev
```

`.dev.vars.example` sets `PLATFORM_STORE=memory`, both flags on and
`ISSUER=http://localhost:5180`. Memory mode is refused when
`ENVIRONMENT=production`. Seed (`src/worker/store/memory-store.ts`):

- Test client `mbx_test_ExampleTestClient0000001` (public; redirects
  `http://localhost:5174/callback`, `http://127.0.0.1:5174/callback`).
- Live client `mbx_live_ExampleLiveClient0000001` (confidential; redirect
  `https://localhost:5174/callback`; dev secret in the seed file; Discord
  scopes optional).
- Wallet `0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266` (Hardhat account #0)
  with a linked Discord (joined Mezo Discord 2025-03-04). No dev sign-in:
  SIWE needs a wallet signature.

## Configuration

Vars (`wrangler.jsonc`): `ENVIRONMENT`, `ISSUER`, `MATCHBOX_ID_ENABLED`,
`DISCORD_CLAIMS_ENABLED` (both `"true"` in the checked-in config).

- `MATCHBOX_ID_ENABLED=false`: `/api/*`, `/oauth/*`, `/.well-known/*` return
  503 `service_disabled`; config is not validated.
- `DISCORD_CLAIMS_ENABLED=false`: `discord:*` scopes are dropped from
  discovery and omitted from tokens and userinfo; at authorize, optional
  ones are ignored and required ones fail with `invalid_scope`.

Secrets (`wrangler secret put`): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`SESSION_PEPPER`, `CLIENT_SECRET_PEPPER` (same value as the developer
console), `OIDC_SIGNING_KEYS` (JSON array of private ES256 JWKs with `kid`;
index 0 signs, all are published), optional `MEZO_MAINNET_RPC_URL` /
`MEZO_TESTNET_RPC_URL` and comma-separated
`MEZO_MAINNET_CONFIRMING_RPC_URLS` / `MEZO_TESTNET_CONFIRMING_RPC_URLS`
(defaults in `src/worker/config.ts`).

Build-time client vars: `VITE_WALLET_CONNECT_PROJECT_ID` (32+ characters)
turns on the WalletConnect row in the wallet drawer; without it only browser
wallets are offered, so phone wallets and Safe cannot sign in. Unlike Pro
and Scan there is no committed default: production must be built with the
project id, and the project must allow `id.matchbox.markets` in
WalletConnect Cloud. `VITE_BITCOIN_WALLET_NOTICE=true` shows the
Bitcoin-wallet notice on the sign-in page (see Not supported); off by
default.

Bindings: Durable Object `RATE_LIMITER` (`RateLimiter`, migration tag `v1`),
`ASSETS` (the built client).
Cron `17 * * * *` purges expired rows (`mbx_id_purge_expired`).

## Scopes and consent

| Scope                | Claims                                                           |
| -------------------- | ---------------------------------------------------------------- |
| `openid`             | `sub` (pairwise)                                                 |
| `wallet`             | `wallet_address`, `wallet_network`                               |
| `discord:id`         | `discord_id`                                                     |
| `discord:profile`    | `discord_username`, `discord_display_name`, `discord_avatar_url` |
| `discord:membership` | `discord_joined_at` (ISO 8601 UTC or `null`)                     |

Discord claims come from `discord_wallet_links` (`discord_user_id`,
`discord_username`, `discord_global_name`, `discord_avatar`,
`discord_joined_at`) and need an approved review.

- Unknown `scope` values are ignored (OIDC Core §3.1.2.1); `openid` is
  required. A known scope the environment is not approved for fails with
  `invalid_scope` when it is required and is ignored when it is optional, so
  an app can request its final scopes while a review is open.
- Each environment marks some requested scopes optional
  (`optionalScopes`, developer console; `openid` is always required). The
  consent screen shows a switch for each optional scope; declining one still
  signs the user in.
- A grant stores the granted scopes and the declined optional ones. Codes,
  tokens (`scope`), the ID token and userinfo carry granted scopes only.
  Declined scopes are not asked for again until the app sends
  `prompt=consent`; a scope the grant has never decided (a new one) brings
  the consent screen back with a "New" chip. An optional scope that cannot be
  granted right now (Discord not linked) is neither granted nor declined, so
  it is asked for once it becomes available.
- `POST /api/authorization-requests/{id}/decision` takes `declinedScopes`
  (omitted: keep the grant's earlier choices). Declining a required scope, or
  a required scope being unavailable, answers the client with
  `access_denied` (`required-scope-declined`, `discord-not-linked` or
  `scope-unavailable`).
- `GET /api/authorization-requests/{id}/summary` (no session) gives the app
  name and logo for "Continue to <app>" on the sign-in page.

## SIWE

SIWE signatures that ecrecover to the wallet are verified locally. Only
other signatures (ERC-1271 / ERC-6492 contract accounts) go to the RPCs:
with more than one RPC host configured for the network, two must confirm
and none may deny. A failed, rate-limited or timed-out `eth_call` is no
answer, not a denial. A wallet that has ever signed in with its key never
takes the contract path. Mainnet confirms with Boar and Validation Cloud by
default; testnet has no second RPC unless one is configured. The message URI
must be this origin exactly.

## Supported wallets

Every sign-in is SIWE (EIP-4361) from an EVM address on Mezo:

- Browser wallets, injected or announced over EIP-6963 (MetaMask, Rabby,
  OKX Wallet's EVM account, Taho, Coinbase Wallet and others): signatures
  that ecrecover to the address, verified locally.
- WalletConnect (phone wallets), when the build sets
  `VITE_WALLET_CONNECT_PROJECT_ID`.
- Smart-contract wallets such as Safe, reached through WalletConnect: the
  client sends whatever signature the wallet returns, and the server
  verifies it as Classic did (ERC-1271, or ERC-6492 for an account not yet
  deployed) over the configured RPCs. A Safe that needs several owners must
  collect them within the five-minute SIWE nonce.

## Not supported: Bitcoin wallets (Mezo Passport)

Classic's sign-in had a Bitcoin group: Unisat, OKX and Xverse through Mezo
Passport (`@mezo-org/passport` 0.17 on wagmi 2), mainnet only. Passport
gives a Bitcoin wallet a Mezo smart account (OrangeKit) whose address is
derived from the Bitcoin key; Classic signed SIWE as that account, and the
server verified the signature with ERC-1271 or ERC-6492, so those accounts
are stored like any other contract wallet (`mbx_id_accounts.wallet_address`
is the smart-account address; their sessions have `signer_kind =
'contract'`).

This Matchbox ID does not offer it (owner decision, November 2026): no
Passport release supports wagmi 3 and React 19, which this app is built on,
and the flow needed confirmation from Mezo that undeployed Passport
accounts verify through ERC-6492 on every confirming RPC, plus testing with
real Bitcoin wallets. People who signed in with a Bitcoin wallet cannot
sign in to that account after cutover. Signing in with an EVM wallet works
but creates a different Matchbox ID (accounts are keyed by address and
cannot be linked or merged), so connected apps see a new user and ask for
consent again. Developer console accounts are separate (Google sign-in) and
are not affected.

Building it later would need: a Passport release on wagmi 3 (or a
wagmi-free module that drives the OrangeKit connector), loaded only behind
the wallet drawer so the account pages stay under budget; Mezo's
confirmation for undeployed accounts; and end-to-end runs with Unisat, OKX
and Xverse on mainnet. The server would not change: it already verifies
contract signatures exactly as Classic did.

`src/app/account/bitcoin-wallet-notice.tsx` holds the sign-in-page notice
for people arriving with a Bitcoin wallet, off unless the build sets
`VITE_BITCOIN_WALLET_NOTICE=true`.
