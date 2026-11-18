import type { StuartError } from "@matchbox/stuart-ui/contract"

// Stuart's routes answer Pro (another origin) and nothing else that runs in
// a browser: CORS echoes only allowlisted origins, never `*`, and a browser
// request from any other site is refused before it reaches a handler.

export type StuartErrorCode = StuartError["error"]["code"]

export class StuartHttpError extends Error {
  readonly status: number
  readonly code: StuartErrorCode
  readonly retryAfterSeconds: number | null

  constructor(
    status: number,
    code: StuartErrorCode,
    message: string,
    retryAfterSeconds: number | null = null,
  ) {
    super(message)
    this.status = status
    this.code = code
    this.retryAfterSeconds = retryAfterSeconds
  }
}

const BASE_HEADERS = {
  "content-type": "application/json",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
} as const

export function stuartJson(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: BASE_HEADERS })
}

export function stuartErrorBody(error: StuartHttpError): StuartError {
  return {
    error: {
      code: error.code,
      message: error.message,
      retryAfterSeconds: error.retryAfterSeconds,
    },
  }
}

export function stuartError(error: StuartHttpError): Response {
  return new Response(JSON.stringify(stuartErrorBody(error)), {
    status: error.status,
    headers: {
      ...BASE_HEADERS,
      ...(error.retryAfterSeconds !== null
        ? { "retry-after": String(error.retryAfterSeconds) }
        : {}),
    },
  })
}

function hostOf(value: string): string | null {
  try {
    return new URL(value).host
  } catch {
    return null
  }
}

/**
 * True when a browser may call Stuart from `origin`: an allowlisted origin
 * or Stuart's own host. Requests without Origin (curl, server to server)
 * carry no ambient browser credentials and are allowed; a browser sending
 * cross-site fetch metadata without an Origin is refused.
 */
export function originAllowed(
  request: Request,
  allowedOrigins: readonly string[],
): boolean {
  const origin = request.headers.get("origin")
  if (origin === null) {
    const fetchSite = request.headers.get("sec-fetch-site")
    return (
      fetchSite === null || fetchSite === "same-origin" || fetchSite === "none"
    )
  }
  if (allowedOrigins.includes(origin)) return true
  const requestHost = request.headers.get("host") ?? hostOf(request.url)
  return requestHost !== null && hostOf(origin) === requestHost
}

export function assertOriginAllowed(
  request: Request,
  allowedOrigins: readonly string[],
): void {
  if (!originAllowed(request, allowedOrigins)) {
    throw new StuartHttpError(403, "forbidden_origin", "Origin not allowed.")
  }
}

export async function readJsonBody(
  request: Request,
  maxBytes: number,
): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? ""
  if (!/^application\/json\b/i.test(contentType)) {
    throw new StuartHttpError(
      415,
      "unsupported_media_type",
      "Send application/json.",
    )
  }
  const declared = Number.parseInt(
    request.headers.get("content-length") ?? "",
    10,
  )
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new StuartHttpError(413, "payload_too_large", "Request is too large.")
  }
  const text = await request.text()
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new StuartHttpError(413, "payload_too_large", "Request is too large.")
  }
  try {
    // Typed unknown: every caller validates it with the contract's schema.
    const value: unknown = JSON.parse(text)
    return value
  } catch {
    throw new StuartHttpError(400, "invalid_request", "Body is not valid JSON.")
  }
}
