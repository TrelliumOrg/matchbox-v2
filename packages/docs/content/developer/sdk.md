---
title: SDK
description: The TypeScript client for the Matchbox API and Sign in with Matchbox.
updated: 2026-11-10
---

`@matchbox-dev/sdk` is the TypeScript client for the Matchbox API and Sign in with Matchbox. It is typed from the published OpenAPI document and has no React or wallet dependencies.

:::code-group

```bash title="pnpm"
pnpm add @matchbox-dev/sdk
```

```bash title="npm"
npm install @matchbox-dev/sdk
```

:::

It runs in browsers, Cloudflare Workers, Deno, Bun and Node 18 or later. The OIDC helpers need WebCrypto, which means Node 20 or later.

## Client {#client}

```ts title="TypeScript"
import { createMatchboxClient, MatchboxApiError } from "@matchbox-dev/sdk"

const matchbox = createMatchboxClient({
  apiKey: process.env.MATCHBOX_API_KEY ?? "", // mbx_sk_live_… on servers
})

try {
  const { data, meta } = await matchbox.incentives.list({ network: "mezo" })
  console.log(data.length, meta.epoch.start, meta.blockNumber)
} catch (error) {
  if (error instanceof MatchboxApiError) {
    console.error(error.status, error.code, error.requestId)
  }
}
```

| Option            | Default                        |
| ----------------- | ------------------------------ |
| `apiKey`          | Required                       |
| `baseUrl`         | `https://api.matchbox.markets` |
| `fetch`           | The global `fetch`             |
| `maxRetries`      | 2, for `429` and `503`         |
| `maxRetryDelayMs` | 10,000                         |

Every method takes `{ signal }` for cancellation.

## Methods {#methods}

| Method                          | Operation                                                                    |
| ------------------------------- | ---------------------------------------------------------------------------- |
| `networks.list`                 | [Networks this key can read](/developer/api/networks/list-networks)          |
| `epochs.current`                | [Current and next epoch](/developer/api/epochs/get-current-epoch)            |
| `gauges.list`                   | [List gauges](/developer/api/gauges/list-gauges)                             |
| `gauges.get`                    | [Get a gauge](/developer/api/gauges/get-gauge)                               |
| `gauges.epochs`                 | [List a gauge's epochs](/developer/api/gauges/list-gauge-epochs)             |
| `gauges.byVebtc`                | [Boost gauge for a veBTC token](/developer/api/gauges/get-gauge-by-vebtc)    |
| `incentives.list`               | [List incentives](/developer/api/incentives/list-incentives)                 |
| `gaugeProfiles.list`, `iterate` | [List gauge profiles](/developer/api/gauge-profiles/list-gauge-profiles)     |
| `gaugeProfiles.get`             | [Get a gauge profile](/developer/api/gauge-profiles/get-gauge-profile)       |
| `gaugeProfiles.byVebtc`         | [Profile by veBTC](/developer/api/gauge-profiles/get-gauge-profile-by-vebtc) |

## Values {#values}

Amounts are decimal strings. `amount` and `weight` are in base units, 18 decimals for `weight`, so use a decimal library for arithmetic.

Market data is a snapshot refreshed about every 5 minutes. Read `meta.asOf` and `meta.blockNumber` to see which one you got.

## Sign in with Matchbox {#sign-in}

The OIDC helpers live in `@matchbox-dev/sdk/oidc`. See [Sign in with Matchbox](/developer/oidc) for the flow.
