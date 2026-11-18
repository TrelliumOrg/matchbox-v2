---
title: Quickstart
description: Install the SDK and make a first Matchbox API request.
updated: 2026-11-10
topics:
  - developer.quickstart.install#install
---

The Matchbox API serves Mezo Earn data: gauges, incentives, epochs and gauge profiles. Every key reads both Mezo networks.

:::facts

- **Base URL** `https://api.matchbox.markets`
- **Version** `/v1`
- **Networks** `mezo, mezo-testnet`
- **SDK** `@matchbox-dev/sdk`

:::

## Install {#install}

The SDK is typed from the published OpenAPI document. It runs in browsers, Cloudflare Workers, Deno, Bun and Node 18 or later.

:::code-group

```bash title="pnpm"
pnpm add @matchbox-dev/sdk
```

```bash title="npm"
npm install @matchbox-dev/sdk
```

:::

## Create a key {#create-a-key}

Create an app in [Matchbox Developer](https://developer.matchbox.markets) and copy a secret key. Keep secret keys on your server.

## Read gauge profiles {#read-gauge-profiles}

:::code-group

```ts title="TypeScript"
import { createMatchboxClient } from "@matchbox-dev/sdk"

const matchbox = createMatchboxClient({
  apiKey: process.env.MATCHBOX_API_KEY ?? "", // mbx_sk_test_…
})

const page = await matchbox.gaugeProfiles.list({
  network: "mezo",
  limit: 20,
})

for (const profile of page.data) {
  console.log(profile.gaugeAddress, profile.displayName)
}
```

```bash title="curl"
curl "https://api.matchbox.markets/v1/gauge-profiles?network=mezo&limit=20" \
  -H "Authorization: Bearer $MATCHBOX_API_KEY"
```

:::

## Next {#next}

:::links

- [Authentication and keys](/developer/auth) Secret and publishable keys, rotation
- [Sign in with Matchbox](/developer/oidc) Let people sign in with Matchbox ID
- [API reference](/developer/reference) Every operation, generated from `openapi.json`
- [Errors](/developer/errors) Every error code and its status

:::
