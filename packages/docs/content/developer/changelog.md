---
title: Changelog
description: Releases of the Matchbox API, the SDK and Matchbox Developer.
updated: 2026-11-19
---

Releases of the Matchbox API, the SDK and Matchbox Developer, newest first.

## Unreleased {#unreleased}

- Incentives: `/v1/incentives` prices gauge incentives paid in the bridged
  BTC wrappers mSolvBTC, mxSolvBTC and mcbBTC at the BTC price. They were
  unpriced, so each token's `usd`, and the gauge's `totalUsd` and
  `aprPercent`, now include them for the gauges that pay them.
- Epochs already stored keep those tokens unpriced until they are rebuilt,
  so a gauge's history can show a step at the change.
- Tokens are still priced by contract address only. A token is never
  priced by its symbol, so a token named "MUSD" at another address stays
  unpriced.

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
