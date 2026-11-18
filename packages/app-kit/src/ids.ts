/**
 * zod 4's UUID pattern, so the browser does not load zod for it: what the
 * ID and Developer servers' id params accept. Lifted unchanged from their
 * return-path.ts and ids.ts.
 */
const uuidPattern =
  /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/

/** Whether `value` is a UUID as zod 4 accepts it. */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value)
}

export class InvalidIdError extends Error {
  constructor() {
    super("Not found")
    this.name = "InvalidIdError"
  }
}

/**
 * A path segment for an organization, app or environment id. Server
 * functions build internal /api paths from their inputs; anything but a
 * UUID ("..", "x/../y") could rewrite the path, so it is refused.
 */
export function idSegment(value: unknown): string {
  if (!isUuid(value)) throw new InvalidIdError()
  return value
}
