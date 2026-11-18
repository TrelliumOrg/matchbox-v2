import { parseJson } from "@matchbox/contracts/encoding"
import { errorBodySchema } from "@matchbox/contracts/errors"
import { ApiError } from "./api-error"

export {
  ApiError,
  type ApiErrorCode,
  errorMessage,
  isApiError,
} from "./api-error"

import type { z } from "zod"

export type QueryValue = string | number | boolean | null | undefined

export type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
  query?: Record<string, QueryValue>
  body?: unknown
  signal?: AbortSignal
  /**
   * Sends the request instead of `fetch`: server functions read the
   * console server in-process with it (app/data/reads.server.ts).
   */
  transport?: FetchLike
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>

let fetchImpl: FetchLike = (input, init) => fetch(input, init)

/** Test seam: swap the transport. Returns a restore function. */
export function setFetch(next: FetchLike): () => void {
  const previous = fetchImpl
  fetchImpl = next
  return () => {
    fetchImpl = previous
  }
}

export function buildUrl(
  path: string,
  query?: Record<string, QueryValue>,
): string {
  if (query === undefined) return path
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue
    params.set(key, String(value))
  }
  const search = params.toString()
  return search === "" ? path : `${path}?${search}`
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text === "") return null
  const parsed = parseJson(text)
  return parsed.ok ? parsed.value : undefined
}

/**
 * Calls a console `/api/*` route and validates the response with `schema`.
 * Non-2xx bodies are parsed with the shared `errorBodySchema`.
 */
export async function apiRequest<Schema extends z.ZodType>(
  schema: Schema,
  path: string,
  options: RequestOptions = {},
): Promise<z.output<Schema>> {
  const method = options.method ?? "GET"
  const init: RequestInit = {
    method,
    credentials: "same-origin",
    headers:
      options.body === undefined
        ? { Accept: "application/json" }
        : { Accept: "application/json", "Content-Type": "application/json" },
  }
  if (options.body !== undefined) init.body = JSON.stringify(options.body)
  if (options.signal !== undefined) init.signal = options.signal

  let response: Response
  try {
    const send = options.transport ?? fetchImpl
    response = await send(buildUrl(path, options.query), init)
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error
    }
    throw new ApiError({
      status: 0,
      code: "network_error",
      message: "Network error. Check your connection.",
      requestId: null,
    })
  }

  const requestId = response.headers.get("X-Request-Id")
  const body = await readJson(response)

  if (!response.ok) {
    const parsed = errorBodySchema.safeParse(body)
    if (parsed.success) {
      const { error } = parsed.data
      throw new ApiError({
        status: response.status,
        code: error.code,
        message: error.message,
        requestId: error.requestId,
        ...(error.issues === undefined ? {} : { issues: error.issues }),
      })
    }
    throw new ApiError({
      status: response.status,
      code: response.status >= 500 ? "internal_error" : "invalid_response",
      message: `Request failed (${response.status}).`,
      requestId,
    })
  }

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    throw new ApiError({
      status: response.status,
      code: "invalid_response",
      message: "Unexpected response from the server.",
      requestId,
    })
  }
  return parsed.data
}
