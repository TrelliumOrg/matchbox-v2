import { gaugesAfter, walletAfter } from "../tx/fresh-after"
import { liveQuery } from "./live-query"
import type { ActivityFilter } from "./view-models"

/**
 * Query options for every read model. `meta.block` marks queries tied to the
 * chain head: they refetch as new blocks land (see `LiveProvider`). The
 * server function stubs load on the first fetch: first paint renders from
 * loader data and never calls them.
 *
 * For a few minutes after a transaction sent from this tab, the reads it
 * changed name its block (`tx/fresh-after`), so the API answers past its
 * caches.
 */

let api: Promise<typeof import("./pro-api")> | null = null

export function loadProApi(): Promise<typeof import("./pro-api")> {
  api ??= import("./pro-api")
  return api
}

const block = { block: true } as const

export const marketQuery = liveQuery({
  queryKey: ["market"],
  queryFn: async () => (await loadProApi()).getMarket(),
  meta: block,
  staleTime: 15_000,
})

export const homeQuery = liveQuery({
  queryKey: ["home"],
  queryFn: async () => (await loadProApi()).getHome(),
  meta: block,
  staleTime: 60_000,
})

export const gaugesQuery = liveQuery({
  queryKey: ["gauges"],
  queryFn: async () =>
    (await loadProApi()).getGauges({ data: { after: gaugesAfter() } }),
  meta: block,
  staleTime: 60_000,
})

export function gaugeQuery(address: string) {
  return liveQuery({
    queryKey: ["gauge", address.toLowerCase()],
    queryFn: async () =>
      (await loadProApi()).getGauge({
        data: { address, after: gaugesAfter() },
      }),
    meta: block,
    staleTime: 60_000,
  })
}

export function overviewQuery(address: string) {
  return liveQuery({
    queryKey: ["overview", address.toLowerCase()],
    queryFn: async () =>
      (await loadProApi()).getOverview({
        data: { address, after: walletAfter(address) },
      }),
    meta: block,
    staleTime: 60_000,
  })
}

export function voterQuery(address: string) {
  return liveQuery({
    queryKey: ["voter", address.toLowerCase()],
    queryFn: async () =>
      (await loadProApi()).getVoter({
        data: { address, after: walletAfter(address) },
      }),
    meta: block,
    staleTime: 60_000,
  })
}

export function rewardsQuery(address: string) {
  return liveQuery({
    queryKey: ["rewards", address.toLowerCase()],
    queryFn: async () =>
      (await loadProApi()).getRewards({
        data: { address, after: walletAfter(address) },
      }),
    meta: block,
    staleTime: 60_000,
  })
}

export function activityQuery(address: string, filter: ActivityFilter) {
  return liveQuery({
    queryKey: ["activity", address.toLowerCase(), filter],
    queryFn: async () =>
      (await loadProApi()).getActivity({ data: { address, filter } }),
    meta: block,
    staleTime: 60_000,
  })
}

/**
 * A wallet's Mezo ID (or a Mezo ID's wallet), for display. Not tied to
 * blocks. Unavailable rejects, so it is never kept as an answer.
 */
export function identityQuery(key: string) {
  return liveQuery({
    queryKey: ["identity", key.trim().toLowerCase()],
    queryFn: async () => {
      const lookup = await (await loadProApi()).getIdentity({
        data: { key: key.trim() },
      })
      if (lookup.status === "unavailable") {
        throw new Error("Mezo ID lookup unavailable")
      }
      return lookup
    },
    meta: { block: false },
    staleTime: 3_600_000,
  })
}

export function protocolQuery(epoch: number | null) {
  return liveQuery({
    queryKey: ["protocol", epoch],
    queryFn: async () => (await loadProApi()).getProtocol({ data: { epoch } }),
    meta: block,
    staleTime: 60_000,
  })
}
