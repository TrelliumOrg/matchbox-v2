/** zod 4's UUID pattern: what the console server's id params accept. */
const uuidPattern =
  /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/

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
  if (typeof value !== "string" || !uuidPattern.test(value)) {
    throw new InvalidIdError()
  }
  return value
}
