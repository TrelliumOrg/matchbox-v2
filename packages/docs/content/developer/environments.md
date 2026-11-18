---
title: Environments
description: Each app has a test and a live environment with its own keys, client ids and redirect URIs.
updated: 2026-11-10
---

Each app has a test and a live environment. They have separate client ids, keys, secrets, redirect URIs and origins.

::environments-table

## Networks {#networks}

API keys from either environment read both networks. The environment sets the rate limits and the network Sign in with Matchbox uses.

## Going live {#going-live}

Live access needs a review. Apps that request only `gauge-profiles:read` are approved automatically, and Discord scopes are reviewed by hand.

Mark a scope optional to request it before approval. Sign-in leaves an optional scope out until it is approved, while a required one fails with `invalid_scope`.
