---
title: Changelog
description: Releases of the Matchbox API, the SDK and Matchbox Developer.
updated: 2026-11-10
---

Releases of the Matchbox API, the SDK and Matchbox Developer, newest first.

## Version 2.1.0 {#v2-1-0}

Gauges, incentives and epochs, 26 Oct 2026.

- Every API key reads both `mezo` and `mezo-testnet`.
- Gauges: `/v1/gauges`, each gauge's epoch history and the veBTC lookup.
- Incentives: `/v1/incentives` with USD values and APR per gauge.
- Epochs: `/v1/epochs/current`.
- The SDK on npm as `@matchbox-dev/sdk`.

## Version 2.0.0 {#v2-0-0}

Developer platform v2, 30 Sep 2026.

- Sign in to the console with Google. Staff domains are operators.
- Test and live environments per app, on Mezo Testnet and Mezo.
- Publishable and secret API keys, with an overlap when rotating.
- Sign in with Matchbox: OpenID Connect with PKCE S256 and pairwise subjects.
- Gauge Profile API v1 with cursor pagination and ETags.
- Usage, request lookup and CSV export.
