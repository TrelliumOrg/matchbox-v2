import { useEffect, useState } from "react"

/**
 * TanStack Query, kept off the first paint. Routes server-render from loader
 * data; once the page is idle the query runtime (`./query-runtime`, built on
 * `@tanstack/query-core`) loads, takes over every query on screen with the
 * loader data as its seed, refetches block-tied queries as blocks land and
 * serves later navigations from its cache. Until then a query is just its
 * seed, which is exactly what the server rendered.
 */

export type LiveQuery<T> = {
  queryKey: readonly unknown[]
  queryFn: () => Promise<T>
  staleTime: number
  /** Refetched as new blocks land. */
  meta: { block: boolean }
}

export function liveQuery<T>(query: LiveQuery<T>): LiveQuery<T> {
  return query
}

type Runtime = typeof import("./query-runtime")

let runtime: Runtime | null = null
let loading: Promise<Runtime> | null = null
const waiting = new Set<(loaded: Runtime) => void>()

export function loadQueryRuntime(): Promise<Runtime> {
  loading ??= import("./query-runtime").then((loaded) => {
    runtime = loaded
    for (const resolve of waiting) resolve(loaded)
    waiting.clear()
    return loaded
  })
  return loading
}

/** Runs `run` once the runtime is loaded, without loading it early. */
export function whenRuntime(run: (loaded: Runtime) => void): () => void {
  if (runtime !== null) {
    run(runtime)
    return () => {}
  }
  waiting.add(run)
  return () => waiting.delete(run)
}

const idlePreloads = new Set<() => Promise<unknown>>()

/**
 * Also loads `load` when the runtime loads on idle: an app's server function
 * stubs and seroval, so the first refetch does not wait for them. Pro
 * registers `() => import("./pro-api")`.
 */
export function preloadWithRuntime(load: () => Promise<unknown>): void {
  idlePreloads.add(load)
}

/** Loads the runtime when the browser is idle after hydration. */
export function loadQueryRuntimeWhenIdle(): void {
  if (typeof window === "undefined" || loading !== null) return
  const load = (): void => {
    void loadQueryRuntime()
    // The server function stubs and seroval, before the first refetch.
    for (const preload of idlePreloads) void preload()
  }
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(load, { timeout: 2500 })
  } else {
    setTimeout(load, 1200)
  }
}

/** For route loaders: the query cache when it is up, else a direct fetch. */
export function fetchLive<T>(query: LiveQuery<T>): Promise<T> {
  if (runtime !== null) return runtime.ensure(query)
  return query.queryFn()
}

/**
 * A query's data on screen, starting from the loader's `seed`. Changing the
 * key (another address, filter or epoch) follows the new seed.
 */
export function useLiveQuery<T>(query: LiveQuery<T>, seed: T): T {
  const [state, setState] = useState({ seed, data: seed })
  const data = state.seed === seed ? state.data : seed
  if (state.seed !== seed) setState({ seed, data: seed })
  const key = JSON.stringify(query.queryKey)

  // biome-ignore lint/correctness/useExhaustiveDependencies: the key identifies the query
  useEffect(() => {
    let unsubscribe: () => void = () => {}
    const cancel = whenRuntime((loaded) => {
      unsubscribe = loaded.observe(query, seed, (next) =>
        setState((current) =>
          current.seed === seed ? { seed, data: next } : current,
        ),
      )
    })
    loadQueryRuntimeWhenIdle()
    return () => {
      cancel()
      unsubscribe()
    }
  }, [key, seed])

  return data
}
