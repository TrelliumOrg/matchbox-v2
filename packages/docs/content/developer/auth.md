---
title: Authentication and keys
description: Every v1 request sends an API key as a bearer token.
updated: 2026-11-10
---

Every `/v1` request sends an API key as a bearer token. Keys belong to one environment, and every key reads both `mezo` and `mezo-testnet`.

```http title="Header"
Authorization: Bearer mbx_sk_test_…
```

## Key types {#key-types}

| Type        | Prefix                       | Use                                                  |
| ----------- | ---------------------------- | ---------------------------------------------------- |
| Secret      | `mbx_sk_test`, `mbx_sk_live` | Servers only, with an optional CIDR allowlist        |
| Publishable | `mbx_pk_test`, `mbx_pk_live` | Browsers, from origins registered on the environment |

Requests with a secret key and an `Origin` header are rejected. A publishable key's request must come from a registered origin.

## Rotation {#rotation}

Rotating issues a new key and keeps the old one working for the overlap you choose. The overlap is up to 7 days, 1 day by default.

Revoking a key takes effect within 15 seconds.

## Scope {#scope}

API keys carry `gauge-profiles:read`, which covers every `/v1` read: gauges, incentives, epochs and gauge profiles. Live keys work once the live environment is approved and the app is active.

:::note[Placeholders]
Samples use placeholders such as `mbx_sk_test_…`. Copy your own key from Matchbox Developer.
:::
