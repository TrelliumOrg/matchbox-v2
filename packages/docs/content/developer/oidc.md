---
title: Sign in with Matchbox
description: Let people sign in to your app with Matchbox ID, over OpenID Connect with PKCE.
definition: OpenID Connect sign-in with Matchbox ID. Your app gets a stable user id and, with consent, the wallet.
updated: 2026-11-10
topics:
  - developer.oidc.scopes#scopes
  - developer.oidc.lifetimes#lifetimes
---

Let people sign in to your app with Matchbox ID. It is OpenID Connect with the authorization code flow and PKCE, so you get a stable user id and, when they agree, their wallet.

:::facts

- **Issuer** `https://id.matchbox.markets`
- **Flow** Code flow, PKCE S256
- **Discovery** `/.well-known/openid-configuration`
- **ID tokens** ES256, pairwise subject

:::

## How it works {#how-it-works}

::::steps

:::step[Start sign-in]{tag="Server"}
Create a PKCE pair, a state and a nonce, and keep them on your server. Then send the person to the authorize URL.

```ts title="TypeScript"
import {
  buildAuthorizeUrl,
  createNonce,
  createPkcePair,
  createState,
} from "@matchbox-dev/sdk/oidc"

const pkce = await createPkcePair()
const state = createState()
const nonce = createNonce()

const url = buildAuthorizeUrl({
  clientId: "mbx_live_…",
  redirectUri: "https://app.example.com/auth/callback",
  scopes: ["openid", "wallet"],
  state,
  nonce,
  codeChallenge: pkce.codeChallenge,
})
```

:::

:::step[The person approves]{tag="Matchbox ID"}
Matchbox ID shows your app's name, each scope in plain words and the wallet it will share. Nothing is shared until they press Allow.
:::

:::step[Handle the callback]{tag="Server"}
Check that `state` matches, exchange the code, then verify the ID token against your nonce.

```ts title="TypeScript" prelude="oidc-callback"
import { exchangeCode, verifyIdToken } from "@matchbox-dev/sdk/oidc"

const tokens = await exchangeCode({
  clientId,
  clientSecret: process.env.MATCHBOX_CLIENT_SECRET ?? "",
  code,
  redirectUri,
  codeVerifier: pkce.codeVerifier,
})
const claims = await verifyIdToken(tokens.idToken ?? "", {
  clientId,
  nonce,
})

claims.sub // stable for your app
claims.wallet_address // with the wallet scope
```

:::

:::step[Keep the session]{tag="Server"}
Use `refreshTokens` before the access token expires and `revokeToken` when they sign out.

```ts title="TypeScript" prelude="oidc-session"
import {
  refreshTokens,
  revokeToken,
  verifyIdToken,
} from "@matchbox-dev/sdk/oidc"

const next = await refreshTokens({
  clientId,
  refreshToken: tokens.refreshToken ?? "",
})
const refreshed = await verifyIdToken(next.idToken ?? "", {
  clientId,
  nonce: null,
})
await revokeToken({
  clientId,
  token: next.refreshToken ?? "",
  tokenTypeHint: "refresh_token",
})
```

:::

::::

:::note[Refresh tokens rotate]
Store the newest refresh token every time. Refreshed ID tokens carry no nonce, so verify them with `nonce: null`.
:::

## Scopes {#scopes}

Ask for the fewest scopes you need. Discord scopes need a review before live apps can use them.

::scopes-table

Discord claims are released only while the wallet's Discord link is unchanged. `discord_joined_at` is an ISO 8601 time in UTC, or `null` when unknown.

## Claims {#claims}

::claims-table

## Lifetimes {#lifetimes}

::oidc-lifetimes-table

## Errors {#errors}

Failures throw `OidcError` with `status`, `error` and `errorDescription`. The codes are listed in [Errors](/developer/errors#oauth-errors).
