import { env } from "cloudflare:workers"
import { createServerFn } from "@tanstack/react-start"
import {
  type EpochStats,
  type Gauge,
  parseGaugeId,
  queryEpochStats,
  queryGauge,
  queryGauges,
} from "./gauge-queries.server"

export type { EpochStats, Gauge }

export const listGauges = createServerFn({ method: "GET" }).handler(
  function listGaugesHandler(): Promise<Gauge[]> {
    return queryGauges(env.DB)
  },
)

export const getGauge = createServerFn({ method: "GET" })
  // The validator also runs in the browser, so it stays a type-only identity
  // and zod validation happens in the handler, keeping zod off the client.
  .validator(function gaugeInput(input: { id: number }) {
    return input
  })
  .handler(function getGaugeHandler({ data }): Promise<Gauge | null> {
    return queryGauge(env.DB, parseGaugeId(data).id)
  })

export const getEpochStats = createServerFn({ method: "GET" }).handler(
  async function getEpochStatsHandler(): Promise<EpochStats> {
    await new Promise((resolve) => setTimeout(resolve, 400))
    return queryEpochStats(env.DB)
  },
)
