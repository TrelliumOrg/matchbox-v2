import type { ErrorCode, ErrorIssue } from "@matchbox/contracts/errors"

/**
 * The console API's error, without zod: pages import it for messages and
 * the step-up check, while the client that parses responses
 * (api-client.ts) loads only with the actions that call the API.
 */

/** Platform codes plus two client-side failures. */
export type ApiErrorCode = ErrorCode | "network_error" | "invalid_response"

export class ApiError extends Error {
  readonly status: number
  readonly code: ApiErrorCode
  readonly requestId: string | null
  readonly issues: ErrorIssue[]

  constructor(input: {
    status: number
    code: ApiErrorCode
    message: string
    requestId: string | null
    issues?: ErrorIssue[]
  }) {
    super(input.message)
    this.name = "ApiError"
    this.status = input.status
    this.code = input.code
    this.requestId = input.requestId
    this.issues = input.issues ?? []
  }

  /** Message for a specific field path (validation `issues`). */
  issueFor(path: string): string | null {
    return this.issues.find((issue) => issue.path === path)?.message ?? null
  }
}

export function isApiError(error: unknown, code?: ApiErrorCode): boolean {
  return (
    error instanceof ApiError && (code === undefined || error.code === code)
  )
}

/** Readable message for any thrown value. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return "Something went wrong."
}
