import type { ApiRequestCacheStatus } from "@matchbox/contracts/api-request-log"
import type { ApiKeyKind } from "@matchbox/contracts/credentials"
import type { EnvironmentKind } from "@matchbox/contracts/network"
import type { Context, MiddlewareHandler } from "hono"
import type { RequestAuth } from "./auth"

/**
 * Who may read a response cross-origin, decided as soon as the key's
 * identity is known (before per-request checks), so error responses follow
 * the same rule as successful ones.
 */
export type CorsPolicy =
  | { kind: "anonymous" }
  | { kind: "public" }
  | { kind: "key"; keyKind: ApiKeyKind; origins: readonly string[] }

/** Identity for the request log, set once the key hash verifies. */
export type LogIdentity = {
  keyId: string
  environmentId: string
  environmentKind: EnvironmentKind
}

export type ApiVariables = {
  auth: RequestAuth | undefined
  cors: CorsPolicy | undefined
  identity: LogIdentity | undefined
  routeTemplate: string | undefined
  cacheStatus: ApiRequestCacheStatus | undefined
  /** Set when a response is an earlier answer (the request log's blob11). */
  servedFrom: "last-good" | undefined
}

export type ApiEnv = { Variables: ApiVariables }

export type ApiContext = Context<ApiEnv>

export type ApiMiddleware = MiddlewareHandler<ApiEnv>
