import { parseJson } from "@matchbox/contracts/encoding"
import * as z from "zod/mini"
import { ApiError } from "./api-error"

/**
 * The browser's writes to the Matchbox ID `/api/*` routes. Reads come from
 * the route loaders (data/id-api.ts); writes stay in the browser so the
 * server's same-origin check and rate limits see the real request. Responses
 * are checked with zod/mini, which keeps the full zod build off the client.
 */

const errorBody = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
})

const okResponse = z.object({ ok: z.literal(true) })
const nonceResponse = z.object({
  nonce: z.string().check(z.regex(/^[0-9A-Za-z]{8,64}$/)),
})
const verifyResponse = z.object({
  account: z.object({ walletAddress: z.string() }),
})
const decisionResponse = z.object({ redirectTo: z.url() })

function parseBody(text: string): unknown {
  const json = parseJson(text)
  return json.ok ? json.value : null
}

async function call<Output>(
  path: string,
  schema: z.ZodMiniType<Output>,
  method: "POST" | "DELETE",
  body?: unknown,
): Promise<Output> {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const value = parseBody(await response.text())
  if (!response.ok) {
    const error = errorBody.safeParse(value)
    throw error.success
      ? new ApiError(
          response.status,
          error.data.error.code,
          error.data.error.message,
        )
      : new ApiError(response.status, "internal_error", "Something went wrong")
  }
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    throw new ApiError(response.status, "internal_error", "Unexpected response")
  }
  return parsed.data
}

function idPath(prefix: string, id: string): string {
  return `${prefix}/${encodeURIComponent(id)}`
}

export const api = {
  signOut: () => call("/api/session/sign-out", okResponse, "POST"),
  siweNonce: () => call("/api/siwe/nonce", nonceResponse, "POST"),
  siweVerify: (body: { message: string; signature: string }) =>
    call("/api/siwe/verify", verifyResponse, "POST", body),
  decide: (
    id: string,
    body:
      | { decision: "approve"; declinedScopes?: string[] }
      | { decision: "deny" },
  ) =>
    call(
      `${idPath("/api/authorization-requests", id)}/decision`,
      decisionResponse,
      "POST",
      body,
    ),
  revokeGrant: (id: string) =>
    call(idPath("/api/grants", id), okResponse, "DELETE"),
  revokeSession: (id: string) =>
    call(idPath("/api/sessions", id), okResponse, "DELETE"),
}
