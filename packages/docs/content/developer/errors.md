---
title: Errors
description: Every API error carries a stable code, a message and the request id.
updated: 2026-11-10
topics:
  - developer.errors.codes#codes
---

Errors return JSON with a stable `code` and the request id. Validation failures add `issues`.

```json title="ErrorBody"
{
  "error": {
    "code": "invalid_request",
    "message": "The request is invalid.",
    "requestId": "req_…",
    "docsUrl": "https://docs.matchbox.markets/developer/errors#invalid_request",
    "issues": [{ "path": "network", "message": "Invalid option" }]
  }
}
```

## Codes {#codes}

Each code has its own anchor on this page. The `docsUrl` in every error body links to it.

::errors-table

## Sign in with Matchbox errors {#oauth-errors}

The OpenID Connect endpoints answer with the OAuth error codes instead. The SDK throws them as `OidcError`.

::oauth-errors-table

## Support {#support}

Include the `X-Request-Id` header when you contact support. Matchbox Developer can look a request up by that id.
