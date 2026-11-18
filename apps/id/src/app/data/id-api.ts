import type {
  AuthorizationRequestSummary,
  AuthorizationRequestView,
  SessionListResponse,
} from "@matchbox/contracts/identity"
import { createServerFn } from "@tanstack/react-start"
import type {
  GrantListViewResponse,
  IdentityAccountView,
} from "../../shared/contracts"
import { requestInput as parseRequest } from "./input.server"
import {
  readAuthorization,
  readGrants,
  readSession,
  readSessions,
  readSummary,
} from "./reads.server"

/**
 * Server functions behind the route loaders. They read the OIDC server's
 * `/api/*` GET routes in-process (reads.server.ts), so pages render with
 * their data on the first response and zod stays on the server. Validators
 * are type-only identities; inputs are parsed inside the handlers
 * (input.server.ts), and a malformed payload answers 400.
 */

export type AccountData =
  | { kind: "signed-out" }
  | {
      kind: "ready"
      grants: GrantListViewResponse
      sessions: SessionListResponse
    }

export type AuthorizationData =
  | { kind: "signed-out" }
  | {
      kind: "error"
      code: "invalid_request" | "request_expired" | "server_error"
    }
  | {
      kind: "ready"
      account: IdentityAccountView
      request: AuthorizationRequestView
    }

type RequestInput = { request: string }

function requestInput(input: RequestInput): RequestInput {
  return input
}

export const getViewer = createServerFn({ method: "GET" }).handler(
  async function getViewerHandler(): Promise<{
    account: IdentityAccountView | null
  }> {
    return { account: await readSession() }
  },
)

export const getAccount = createServerFn({ method: "GET" }).handler(
  async function getAccountHandler(): Promise<AccountData> {
    // The account itself comes from the root loader; a missing session
    // answers 401 here.
    const [grants, sessions] = await Promise.all([readGrants(), readSessions()])
    if (grants === null || sessions === null) return { kind: "signed-out" }
    return { kind: "ready", grants, sessions }
  },
)

export const getAuthorization = createServerFn({ method: "GET" })
  .validator(requestInput)
  .handler(async function getAuthorizationHandler({
    data,
  }): Promise<AuthorizationData> {
    const request = parseRequest(data)
    const account = await readSession()
    if (account === null) return { kind: "signed-out" }
    const result = await readAuthorization(request)
    if (result.kind !== "ready") return result
    return { kind: "ready", account, request: result.request }
  })

export const getRequestSummary = createServerFn({ method: "GET" })
  .validator(requestInput)
  .handler(async function getRequestSummaryHandler({
    data,
  }): Promise<AuthorizationRequestSummary | null> {
    return readSummary(parseRequest(data))
  })
