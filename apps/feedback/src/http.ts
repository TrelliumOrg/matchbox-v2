import type {
  FeedbackError,
  FeedbackErrorCode,
} from "@matchbox/contracts/feedback"

// The feedback routes answer the v2 surfaces' pages and nothing else that
// runs in a browser: CORS echoes only allow-listed origins, never `*`, and a
// write without an allow-listed Origin is refused before its handler runs.

export class FeedbackHttpError extends Error {
  readonly status: number
  readonly code: FeedbackErrorCode
  readonly retryAfterSeconds: number | null

  constructor(
    status: number,
    code: FeedbackErrorCode,
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

export function feedbackJson(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: BASE_HEADERS })
}

export function feedbackError(error: FeedbackHttpError): Response {
  const body: FeedbackError = {
    error: {
      code: error.code,
      message: error.message,
      retryAfterSeconds: error.retryAfterSeconds,
    },
  }
  return new Response(JSON.stringify(body), {
    status: error.status,
    headers: {
      ...BASE_HEADERS,
      ...(error.retryAfterSeconds !== null
        ? { "retry-after": String(error.retryAfterSeconds) }
        : {}),
    },
  })
}

/** The request's Origin when it is allow-listed, else null. */
export function allowedOrigin(
  request: Request,
  allowedOrigins: readonly string[],
): string | null {
  const origin = request.headers.get("origin")
  return origin !== null && allowedOrigins.includes(origin) ? origin : null
}

/**
 * Writes come only from the widget in a page: an allow-listed Origin is
 * required, so a request with none (curl, a server) or from another site
 * is refused.
 */
export function requireOrigin(
  request: Request,
  allowedOrigins: readonly string[],
): string {
  const origin = allowedOrigin(request, allowedOrigins)
  if (origin === null) {
    throw new FeedbackHttpError(403, "forbidden_origin", "Origin not allowed.")
  }
  return origin
}

function tooLarge(): FeedbackHttpError {
  return new FeedbackHttpError(
    413,
    "payload_too_large",
    "Request is too large.",
  )
}

/**
 * The body as bytes, refused once it passes `maxBytes`: first by its
 * declared length, then while reading, so a missing or false length cannot
 * make the Worker buffer more.
 */
export async function readLimitedBody(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array> {
  const declared = Number.parseInt(
    request.headers.get("content-length") ?? "",
    10,
  )
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge()
  if (request.body === null) return new Uint8Array(0)
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined)
      throw tooLarge()
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

/** A JSON body, typed unknown: every caller validates it with a schema. */
export async function readJsonBody(
  request: Request,
  maxBytes: number,
): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? ""
  if (!/^application\/json\b/i.test(contentType)) {
    throw new FeedbackHttpError(
      415,
      "unsupported_media_type",
      "Send application/json.",
    )
  }
  const text = new TextDecoder().decode(
    await readLimitedBody(request, maxBytes),
  )
  try {
    const value: unknown = JSON.parse(text)
    return value
  } catch {
    throw new FeedbackHttpError(
      400,
      "invalid_request",
      "Body is not valid JSON.",
    )
  }
}
