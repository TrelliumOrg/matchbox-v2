import { setResponseStatus } from "@tanstack/react-start/server"

export class BadInputError extends Error {
  constructor() {
    super("Bad request")
    this.name = "BadInputError"
  }
}

/**
 * The `request` id of a server function's payload. The `.validator`s are
 * type-only, so a hand-made call can send anything: any other shape answers
 * a generic 400 instead of reaching the reads.
 */
export function requestInput(data: unknown): string {
  if (
    typeof data === "object" &&
    data !== null &&
    "request" in data &&
    typeof data.request === "string" &&
    data.request.length > 0 &&
    data.request.length <= 200 &&
    Object.keys(data).length === 1
  ) {
    return data.request
  }
  setResponseStatus(400)
  throw new BadInputError()
}
