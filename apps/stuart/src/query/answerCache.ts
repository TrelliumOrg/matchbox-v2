import {
  type ParsedStuartRequest,
  type StuartResponse,
  stuartResponseSchema,
} from "@matchbox/stuart-ui/contract"
import { canonicalJson, sha256Hex } from "./crypto"

// Per-block answer cache for questions the router answers without the model.
// The key covers everything the answer depends on: the normalized question,
// the wallet and its mode, the chain, a picked clarification option, the
// pinned page entity and the snapshot block. Answers with proposals are
// never cached (their refresh tokens expire).

export type AnswerCache = {
  get: (key: string) => Promise<StuartResponse | null>
  put: (key: string, response: StuartResponse) => Promise<void>
}

// A block is a few seconds; the key already moves with it, so the TTL only
// bounds how long an entry lingers.
export const ANSWER_CACHE_TTL_SECONDS = 120

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ")
}

export async function answerCacheKey(input: {
  request: ParsedStuartRequest
  snapshotBlock: bigint
}): Promise<string> {
  const { request } = input
  return sha256Hex(
    canonicalJson({
      query: normalizeQuery(request.query),
      wallet: request.wallet?.address.toLowerCase() ?? null,
      mode: request.wallet?.mode ?? null,
      chainId: request.chainId,
      clarification: request.context.clarification ?? null,
      entity: request.context.page?.entity ?? null,
      block: input.snapshotBlock.toString(),
    }),
  )
}

export function isCacheable(response: StuartResponse): boolean {
  return response.proposedActions.length === 0
}

const CACHE_ORIGIN = "https://stuart-answers.matchbox.internal"

/** The Workers Cache API (`caches.default`). */
export function cacheApiAnswerCache(cache: Cache): AnswerCache {
  function request(key: string): Request {
    return new Request(`${CACHE_ORIGIN}/${key}`)
  }
  return {
    async get(key) {
      const hit = await cache.match(request(key))
      if (hit === undefined) return null
      const parsed = stuartResponseSchema.safeParse(await hit.json())
      return parsed.success ? parsed.data : null
    },
    async put(key, response) {
      await cache.put(
        request(key),
        new Response(JSON.stringify(response), {
          headers: {
            "content-type": "application/json",
            "cache-control": `max-age=${ANSWER_CACHE_TTL_SECONDS}`,
          },
        }),
      )
    },
  }
}

/** In memory, for tests and local dev. */
export function memoryAnswerCache(): AnswerCache & { size: () => number } {
  const entries = new Map<string, StuartResponse>()
  return {
    async get(key) {
      return entries.get(key) ?? null
    },
    async put(key, response) {
      entries.set(key, response)
    },
    size: () => entries.size,
  }
}
