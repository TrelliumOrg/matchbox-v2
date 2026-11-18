import {
  buildDiscoveryDocument,
  oidcEndpointPaths,
} from "@matchbox/contracts/oidc"
import { enabledOidcScopes } from "@matchbox/contracts/scopes"
import { Hono } from "hono"
import type { AppDeps } from "../deps"

const publicCacheControl = "public, max-age=300"

export default function discoveryRoutes(deps: AppDeps): Hono {
  const app = new Hono()

  app.get(oidcEndpointPaths.discovery, (c) =>
    c.json(
      buildDiscoveryDocument({
        issuer: deps.config.issuer,
        scopes: enabledOidcScopes({
          discordClaimsEnabled: deps.flags.discordClaims,
        }),
      }),
      200,
      { "Cache-Control": publicCacheControl },
    ),
  )

  app.get(oidcEndpointPaths.jwks, (c) =>
    c.json(deps.keys.jwks, 200, { "Cache-Control": publicCacheControl }),
  )

  return app
}
