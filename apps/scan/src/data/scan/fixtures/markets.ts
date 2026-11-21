import { crossChainPools } from "@matchbox/chain"
import {
  scanMetricDefinition,
  scanMetricNotes,
  scanSeriesMaxDays,
} from "@matchbox/contracts/scan"
import { pairOrder } from "../crosschain-views"
import { tokenBySymbol } from "../pricing"
import { knownTokens } from "../tokens"
import {
  badRequest,
  type FixtureAnswer,
  type FixtureRoute,
  type FixtureScenario,
  fixtureNow,
  ok,
} from "./shared"
import { votingFixtures } from "./voting"

/**
 * `/series/split` in fixtures mode: every dimension of one metric over a
 * range, built from the `/series` fixture so the parts agree with each
 * pool's own series. A pool-token metric splits over Mezo's tracked
 * pools; the per-token rollups (pool.token_balance, dex.token_volume_in)
 * are those pools' series summed per token, as the jobs Worker sums them.
 */

const seriesRoute = votingFixtures.find(
  (route) => route.pattern.source === "^series$",
)

/** Mezo's tracked pools and their two tokens. */
const mezoPools = crossChainPools.flatMap((pool) => {
  if (pool.chain !== "mezo" || pool.venue !== "tigris") return []
  const tokens = pairOrder(pool.pair)
    .split("/")
    .map((symbol) => tokenBySymbol(symbol))
  if (tokens.some((token) => token === null)) return []
  return [{ address: pool.address.toLowerCase(), tokens: tokens as string[] }]
})

/** The pool-token metric each rollup sums. */
const rollupSources: Readonly<Record<string, string>> = {
  "pool.token_balance": "pool.balance",
  "dex.token_volume_in": "dex.volume_in",
}

type Point = { day: string; value: string; partial: boolean }

function seriesPoints(
  metric: string,
  dimension: string,
  from: string,
  to: string,
  scenario: FixtureScenario,
): Point[] {
  const match = /^series$/.exec("series")
  if (seriesRoute === undefined || match === null) return []
  const answer = seriesRoute.answer(
    match,
    new URLSearchParams({ metric, dimension, from, to }),
    scenario,
  )
  if (answer === null || answer.status !== 200) return []
  // The /series fixture's own body (fixtures.test.ts parses it with its
  // schema): read as built, so this answer costs no second validation.
  const body = answer.body
  return hasPoints(body) ? body.data.points : []
}

function hasPoints(body: unknown): body is { data: { points: Point[] } } {
  if (typeof body !== "object" || body === null || !("data" in body)) {
    return false
  }
  const data = body.data
  return (
    typeof data === "object" &&
    data !== null &&
    "points" in data &&
    Array.isArray(data.points)
  )
}

const daySeconds = (day: string) => Date.parse(`${day}T00:00:00Z`) / 1000

function splitAnswer(
  query: URLSearchParams,
  scenario: FixtureScenario,
): FixtureAnswer {
  const metric = query.get("metric") ?? ""
  const from = query.get("from")
  const to = query.get("to")
  const definition = scanMetricDefinition(metric)
  if (definition === null || from === null || to === null) return badRequest
  const days = (daySeconds(to) - daySeconds(from)) / 86_400
  const maxDays =
    definition.dimension === "token"
      ? scanSeriesMaxDays
      : definition.dimension === "pool-token"
        ? 7
        : null
  if (maxDays === null || Number.isNaN(days) || days < 0 || days > maxDays) {
    return badRequest
  }
  const series: {
    dimension: string
    token: { address: string; symbol: string | null } | null
    resolvedDecimals: number | null
    points: Point[]
  }[] = []
  const tokenOf = (address: string) => ({
    token: { address, symbol: knownTokens[address]?.symbol ?? null },
    resolvedDecimals: knownTokens[address]?.decimals ?? 18,
  })
  if (definition.dimension === "pool-token") {
    for (const pool of mezoPools) {
      for (const token of pool.tokens) {
        const dimension = `${pool.address}:${token}`
        series.push({
          dimension,
          ...tokenOf(token),
          points: seriesPoints(metric, dimension, from, to, scenario),
        })
      }
    }
  } else {
    const source = rollupSources[metric]
    const sums = new Map<string, Map<string, Point>>()
    for (const pool of source === undefined ? [] : mezoPools) {
      for (const token of pool.tokens) {
        const points = seriesPoints(
          source ?? "",
          `${pool.address}:${token}`,
          from,
          to,
          scenario,
        )
        const byDay = sums.get(token) ?? new Map<string, Point>()
        for (const point of points) {
          const kept = byDay.get(point.day)
          byDay.set(
            point.day,
            kept === undefined
              ? { ...point }
              : {
                  day: point.day,
                  value: (BigInt(kept.value) + BigInt(point.value)).toString(),
                  partial: kept.partial || point.partial,
                },
          )
        }
        sums.set(token, byDay)
      }
    }
    for (const [token, byDay] of [...sums.entries()].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      series.push({
        dimension: token,
        ...tokenOf(token),
        points: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
      })
    }
  }
  return ok({
    data: {
      metric,
      from,
      to,
      truncated: false,
      note: scanMetricNotes[metric] ?? null,
      unit: definition.unit,
      decimals: definition.decimals,
      kind: definition.kind,
      signed: definition.signed,
      series: series.sort((a, b) => a.dimension.localeCompare(b.dimension)),
    },
  })
}

const priceRoute = votingFixtures.find(
  (route) => route.pattern.source === String.raw`^prices\/(btc|mezo)$`,
)

const dayOf = (seconds: number) =>
  new Date(seconds * 1000).toISOString().slice(0, 10)

/** `/markets?days=`: the three splits and the closes, as the API joins them. */
function marketsAnswer(
  query: URLSearchParams,
  scenario: FixtureScenario,
): FixtureAnswer {
  const days = Number(query.get("days"))
  if (!Number.isInteger(days) || days < 1 || days > scanSeriesMaxDays) {
    return badRequest
  }
  const to = dayOf(fixtureNow)
  const back = (count: number) => dayOf(fixtureNow - (count - 1) * 86_400)
  const longest = back(Math.max(days, 31))
  const split = (metric: string, from: string) => {
    const answer = splitAnswer(
      new URLSearchParams({ metric, from, to }),
      scenario,
    )
    return answer.status === 200 && hasData(answer.body)
      ? answer.body.data
      : null
  }
  const prices = (token: "btc" | "mezo") => {
    const match = /^prices\/(btc|mezo)$/.exec(`prices/${token}`)
    const answer =
      priceRoute === undefined || match === null
        ? null
        : priceRoute.answer(
            match,
            new URLSearchParams({ from: longest, to }),
            scenario,
          )
    return answer !== null && answer.status === 200 && hasData(answer.body)
      ? (answer.body.data as { points: unknown[] }).points
      : []
  }
  return ok({
    data: {
      days,
      balances: split("pool.token_balance", back(days)),
      volume: split("dex.token_volume_in", longest),
      pools: split("dex.volume_in", back(3)),
      prices: { btc: prices("btc"), mezo: prices("mezo") },
    },
  })
}

function hasData(body: unknown): body is { data: Record<string, unknown> } {
  return (
    typeof body === "object" &&
    body !== null &&
    "data" in body &&
    typeof body.data === "object" &&
    body.data !== null
  )
}

/**
 * `/series` for a per-token rollup is that token's sum over the pools, as
 * the split answers it, so "MUSD in DEX pools" agrees with each pool's
 * MUSD; every other series is the `/series` fixture's own.
 */
function rollupSeriesAnswer(
  match: RegExpExecArray,
  query: URLSearchParams,
  scenario: FixtureScenario,
): FixtureAnswer | null {
  const own = seriesRoute?.answer(match, query, scenario) ?? null
  const metric = query.get("metric") ?? ""
  const dimension = (query.get("dimension") ?? "").toLowerCase()
  const from = query.get("from")
  const to = query.get("to")
  if (
    rollupSources[metric] === undefined ||
    // A total across tokens ('') is the series fixture's own.
    dimension === "" ||
    own === null ||
    own.status !== 200 ||
    !hasData(own.body) ||
    from === null ||
    to === null
  ) {
    return own
  }
  const split = splitAnswer(new URLSearchParams({ metric, from, to }), scenario)
  if (split.status !== 200 || !hasData(split.body)) return own
  const series = split.body.data.series as {
    dimension: string
    points: Point[]
  }[]
  const points = series.find((each) => each.dimension === dimension)?.points
  return ok({ ...own.body, data: { ...own.body.data, points: points ?? [] } })
}

/** Ahead of the voting fixtures' `/series`, which answers the rest. */
export const rollupSeriesFixtures: readonly FixtureRoute[] = [
  { pattern: /^series$/, answer: rollupSeriesAnswer },
]

export const marketFixtures: readonly FixtureRoute[] = [
  {
    pattern: /^markets$/,
    answer: (_match, query, scenario) => marketsAnswer(query, scenario),
  },
  {
    pattern: /^series\/split$/,
    answer: (_match, query, scenario) => splitAnswer(query, scenario),
  },
]
