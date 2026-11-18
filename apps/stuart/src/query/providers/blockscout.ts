import {
  blockscoutClientHeader,
  blockscoutEndUserHeader,
} from "@matchbox/contracts/blockscout"
import type { z } from "zod"
import type { ApiFetcher } from "./readModels"

// Blockscout through the API Worker (`/internal/blockscout/api/v2/<path>`),
// which owns the Cache API keys and rate limits. Any failure answers
// `unavailable` and tools show the record as such. With an end-user key
// (a salted hash of the visitor's IP prefix) each visitor spends their own
// bucket at the proxy; without one, every Stuart visitor shares one.

export type BlockscoutResult<T> =
  | { status: "ok"; data: T }
  | { status: "unavailable" }

export type BlockscoutReader = <T>(
  path: string,
  schema: z.ZodType<T>,
) => Promise<BlockscoutResult<T>>

const API_ORIGIN = "https://matchbox-developer-api"
const TIMEOUT_MS = 5_000

export function apiBlockscout(
  api: ApiFetcher | null,
  endUser: string | null = null,
): BlockscoutReader {
  return async function read(path, schema) {
    if (api === null) return { status: "unavailable" }
    const clean = path.replace(/^\/+/, "")
    try {
      const response = await api.fetch(
        new Request(`${API_ORIGIN}/internal/blockscout/${clean}`, {
          // Stuart's own buckets at the proxy, apart from Scan's and Pro's.
          headers: {
            accept: "application/json",
            [blockscoutClientHeader]: "stuart",
            ...(endUser === null ? {} : { [blockscoutEndUserHeader]: endUser }),
          },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        }),
      )
      if (!response.ok) return { status: "unavailable" }
      const parsed = schema.safeParse(await response.json())
      return parsed.success
        ? { status: "ok", data: parsed.data }
        : { status: "unavailable" }
    } catch {
      return { status: "unavailable" }
    }
  }
}
