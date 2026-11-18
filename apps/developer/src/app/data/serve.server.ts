import { notFound } from "@tanstack/react-router"
import { setResponseStatus } from "@tanstack/react-start/server"
import { z } from "zod"
import { ApiError } from "../lib/api-client"
import { InvalidIdError } from "./ids"

/**
 * The server half of every console server function: the payload's shape is
 * checked here (zod stays out of the client bundle; the `.validator`s are
 * type-only), and read failures become what a page should show.
 */

export class BadInputError extends Error {
  constructor() {
    super("Bad request")
    this.name = "BadInputError"
  }
}

/**
 * The payload as `schema` reads it. Anything else answers a generic 400:
 * a hand-made call with a missing or wrong-shaped payload must not reach
 * the handler and fail there with its own message in a 500.
 */
export function parseInput<Schema extends z.ZodType>(
  schema: Schema,
  data: unknown,
): z.output<Schema> {
  const parsed = schema.safeParse(data)
  if (!parsed.success) {
    setResponseStatus(400)
    throw new BadInputError()
  }
  return parsed.data
}

/**
 * What a page shows for a failed read: another organization's app, a
 * missing one or a malformed id is Not found (404), as the API answered,
 * never a 500. Everything else is rethrown unchanged.
 */
export function readFailure(error: unknown): unknown {
  if (error instanceof InvalidIdError) return notFound()
  if (
    error instanceof ApiError &&
    (error.status === 403 || error.status === 404)
  ) {
    return notFound()
  }
  return error
}

/** Parses the payload, runs the reads, and maps their failures. */
export async function serve<Schema extends z.ZodType, Result>(
  schema: Schema,
  data: unknown,
  body: (input: z.output<Schema>) => Promise<Result>,
): Promise<Result> {
  const input = parseInput(schema, data)
  try {
    return await body(input)
  } catch (error) {
    throw readFailure(error)
  }
}

const id = z.string().min(1).max(64)
const range = z.enum(["24h", "7d", "30d"])

/** Every server function's payload, as the pages send it. */
export const inputs = {
  org: z.object({ orgId: id }),
  app: z.object({ appId: id }),
  usage: z.object({ orgId: id, range }),
  usagePage: z.object({
    orgId: id,
    range,
    environmentKind: z.enum(["both", "test", "live"]),
  }),
  review: z.object({ reviewId: id }),
  adminReviews: z.object({
    state: z.enum([
      "open",
      "approved",
      "changes-requested",
      "rejected",
      "withdrawn",
    ]),
  }),
  environments: z.object({ orgId: id, environmentIds: z.array(id).max(2) }),
  text: z.object({ query: z.string().max(200) }),
  environment: z.object({ environmentId: id }),
  audit: z.object({
    organizationId: id.optional(),
    appId: id.optional(),
  }),
} as const
