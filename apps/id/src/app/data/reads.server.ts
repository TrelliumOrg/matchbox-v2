import { parseJson } from "@matchbox/contracts/encoding"
import { errorBodySchema } from "@matchbox/contracts/errors"
import {
  type AuthorizationRequestSummary,
  type AuthorizationRequestView,
  authorizationRequestIdSchema,
  authorizationRequestSummarySchema,
  authorizationRequestViewSchema,
  type SessionListResponse,
  sessionListResponseSchema,
} from "@matchbox/contracts/identity"
import { logger } from "@matchbox/logger"
import type { z } from "zod"
import {
  type GrantListViewResponse,
  grantListViewResponseSchema,
  type IdentityAccountView,
  sessionViewResponseSchema,
} from "../../shared/contracts"
import { readInternal } from "./internal.server"

type Read<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: string | null }

async function read<Schema extends z.ZodType>(
  path: string,
  schema: Schema,
): Promise<Read<z.output<Schema>>> {
  const response = await readInternal(path)
  const json = parseJson(await response.text())
  const value = json.ok ? json.value : null
  if (!response.ok) {
    const error = errorBodySchema.safeParse(value)
    return {
      ok: false,
      status: response.status,
      code: error.success ? error.data.error.code : null,
    }
  }
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    logger.error({ message: "Unexpected Matchbox ID response", path })
    return { ok: false, status: 500, code: "internal_error" }
  }
  return { ok: true, data: parsed.data }
}

/** The signed-in account, or null. Throws when the server cannot answer. */
export async function readSession(): Promise<IdentityAccountView | null> {
  const result = await read("/api/session", sessionViewResponseSchema)
  if (!result.ok) throw new Error(`Session read failed (${result.status})`)
  return result.data.account
}

/** Null when the session is gone (401). */
export async function readGrants(): Promise<GrantListViewResponse | null> {
  const result = await read("/api/grants", grantListViewResponseSchema)
  if (result.ok) return result.data
  if (result.status === 401) return null
  throw new Error(`Grants read failed (${result.status})`)
}

/** Null when the session is gone (401). */
export async function readSessions(): Promise<SessionListResponse | null> {
  const result = await read("/api/sessions", sessionListResponseSchema)
  if (result.ok) return result.data
  if (result.status === 401) return null
  throw new Error(`Sessions read failed (${result.status})`)
}

export async function readAuthorization(id: string): Promise<
  | { kind: "ready"; request: AuthorizationRequestView }
  | { kind: "signed-out" }
  | {
      kind: "error"
      code: "invalid_request" | "request_expired" | "server_error"
    }
> {
  const parsed = authorizationRequestIdSchema.safeParse(id)
  if (!parsed.success) return { kind: "error", code: "invalid_request" }
  const result = await read(
    `/api/authorization-requests/${encodeURIComponent(parsed.data)}`,
    authorizationRequestViewSchema,
  )
  if (result.ok) return { kind: "ready", request: result.data }
  if (result.status === 401) return { kind: "signed-out" }
  return {
    kind: "error",
    code: result.code === "not_found" ? "request_expired" : "server_error",
  }
}

/** The app behind a request for "Continue to <app>"; null when unknown. */
export async function readSummary(
  id: string,
): Promise<AuthorizationRequestSummary | null> {
  const parsed = authorizationRequestIdSchema.safeParse(id)
  if (!parsed.success) return null
  const result = await read(
    `/api/authorization-requests/${encodeURIComponent(parsed.data)}/summary`,
    authorizationRequestSummarySchema,
  )
  return result.ok ? result.data : null
}
