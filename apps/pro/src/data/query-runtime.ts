import { QueryClient, QueryObserver } from "@tanstack/query-core"
import type { LiveQuery } from "./live-query"

/**
 * The client-side TanStack Query cache, loaded after hydration (see
 * `live-query.ts`). One QueryClient for the tab.
 */

export const client = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, gcTime: 5 * 60_000 },
  },
})

client.mount()

export function ensure<T>(query: LiveQuery<T>): Promise<T> {
  return client.ensureQueryData({
    queryKey: query.queryKey,
    queryFn: query.queryFn,
    staleTime: query.staleTime,
    meta: query.meta,
  })
}

/** Follows one query, seeding the cache with the server-rendered data. */
export function observe<T>(
  query: LiveQuery<T>,
  seed: T,
  onData: (data: T) => void,
): () => void {
  if (client.getQueryData(query.queryKey) === undefined) {
    client.setQueryData(query.queryKey, seed)
  }
  const observer = new QueryObserver<T, Error, T, T, readonly unknown[]>(
    client,
    {
      queryKey: query.queryKey,
      queryFn: query.queryFn,
      staleTime: query.staleTime,
      meta: query.meta,
    },
  )
  return observer.subscribe((result) => {
    if (result.data !== undefined) onData(result.data)
  })
}

/** Refetches every query tied to the chain head. */
export function refreshBlockQueries(): Promise<void> {
  return client.invalidateQueries({
    predicate: (query) => query.meta?.block === true,
  })
}

/**
 * Refetches the queries a transaction changed: every query whose key starts
 * with one of `roots` and, for wallet queries, names `address`.
 */
export function refreshQueries(
  roots: readonly string[],
  address: string | null,
): Promise<void> {
  const wallet = address?.toLowerCase() ?? null
  return client.invalidateQueries({
    predicate: (query) => {
      const [root, owner] = query.queryKey
      if (typeof root !== "string" || !roots.includes(root)) return false
      return wallet === null || typeof owner !== "string" || owner === wallet
    },
  })
}
