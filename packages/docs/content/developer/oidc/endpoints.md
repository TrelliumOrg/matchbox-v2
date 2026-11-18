---
title: Endpoints
nav: Endpoints
description: The Matchbox ID OpenID Connect endpoints and what the discovery document advertises.
updated: 2026-11-10
---

Matchbox ID is the issuer for Sign in with Matchbox. Read the discovery document rather than hard-coding these URLs.

::oidc-endpoints-table

## Discovery {#discovery}

The discovery document advertises the code flow only, with PKCE S256 and pairwise subjects. ID tokens are signed with ES256 and the keys are published at the JWKS URL.

| Setting             | Value                                               |
| ------------------- | --------------------------------------------------- |
| Response types      | `code`                                              |
| Grant types         | `authorization_code`, `refresh_token`               |
| Token endpoint auth | `client_secret_basic`, `client_secret_post`, `none` |
| Code challenge      | `S256`                                              |
| Subject type        | `pairwise`                                          |
| ID token signing    | `ES256`                                             |
| Prompt values       | `none`, `login`, `consent`                          |

## Clients {#clients}

Confidential clients authenticate at the token endpoint with their secret. Public clients use `none` and rely on PKCE, and never ship a secret to a browser.
