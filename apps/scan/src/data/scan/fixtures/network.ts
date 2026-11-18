import { demoPrices } from "@matchbox/contracts/read-models/fixtures"
import type { ScanTokenListItem } from "@matchbox/contracts/scan"
import { unitsToDecimal } from "@matchbox/domain/format"
import { usdValue } from "../network-views"
import { scanSchemas } from "../schemas"
import { listedTokens } from "../token-list"
import { knownTokens } from "../tokens"
import {
  aggregateMeta,
  badRequest,
  type FixtureRoute,
  type FixtureScenario,
  fixtureNow,
  ok,
} from "./shared"
import { votingFixtures } from "./voting"

/**
 * The Network and Tokens pages' own /internal/scan fixture: `/tokens`, the
 * token list in one read. Its latest supply and holders are the `/series`
 * fixture's closes for the same tokens (so the list agrees with the token
 * pages), and its prices are the demo prices the header and the `/prices`
 * fixture end on. Like the API, it lists the registered tokens (a few of
 * apps/api's token registry, with its names, decimals and pricing) and the
 * tokens the jobs Worker keeps a supply for; a token with no series row
 * has null figures, never zero.
 */

type Registered = {
  symbol: string | null
  name: string | null
  decimals: number | null
  pricedAs: ScanTokenListItem["priced_as"]
}

/** apps/api's token registry for the listed tokens, plus two without rows. */
const registry: Readonly<Record<string, Registered>> = {
  "0x7b7c000000000000000000000000000000000000": {
    symbol: "BTC",
    name: "Bitcoin",
    decimals: 18,
    pricedAs: "btc",
  },
  "0x7b7c000000000000000000000000000000000001": {
    symbol: "MEZO",
    name: "Mezo",
    decimals: 18,
    pricedAs: "mezo",
  },
  "0xdd468a1ddc392dcdbef6db6e34e89aa338f9f186": {
    symbol: "MUSD",
    name: "Mezo USD",
    decimals: 18,
    pricedAs: "usd",
  },
  "0x04671c72aab5ac02a03c1098314b1bb6b560c197": {
    symbol: "mUSDC",
    name: "Mezo Circle USDC",
    decimals: 6,
    pricedAs: "usd",
  },
  "0xeb5a5d39de4ea42c2aa6a57eca2894376683bb8e": {
    symbol: "mUSDT",
    name: "Mezo Tether USD",
    decimals: 6,
    pricedAs: "usd",
  },
  "0xb4d498029af77680cd1ef828b967f010d06c51cc": {
    symbol: "sMUSD",
    name: "MUSD Savings Rate",
    decimals: 18,
    pricedAs: null,
  },
  "0xa10ad2570ea7b93d19fdae6bd7189ff4929bc747": {
    symbol: "mSolvBTC",
    name: "Mezo Solv BTC",
    decimals: 18,
    pricedAs: "btc",
  },
  "0xdf708431162ba247ddae362d2c919e0fbafcf9de": {
    symbol: "mxSolvBTC",
    name: "Mezo xSolvBTC",
    decimals: 18,
    pricedAs: "btc",
  },
  "0x6a7cd8e1384d49f502b4a4ce9ac9eb320835c5d7": {
    symbol: "mcbBTC",
    name: "Mezo Coinbase Wrapped BTC",
    decimals: 8,
    pricedAs: "btc",
  },
}

/** Tokens the jobs Worker keeps series for: the token list's own rows. */
const withSeries = new Set(listedTokens.map((token) => token.address))

const unregistered: Registered = {
  symbol: null,
  name: null,
  decimals: null,
  pricedAs: null,
}

const day = (seconds: number) =>
  new Date(seconds * 1000).toISOString().slice(0, 10)

const seriesRoute = votingFixtures.find(
  (route) => route.pattern.source === "^series$",
)

/** The `/series` fixture's latest close of a token metric, or null. */
function latestClose(
  metric: "token.total_supply" | "token.holders",
  token: string,
): { value: string; day: string; partial: boolean; decimals: number } | null {
  const match = /^series$/.exec("series")
  if (seriesRoute === undefined || match === null) return null
  const answer = seriesRoute.answer(
    match,
    new URLSearchParams({
      metric,
      dimension: token,
      from: day(fixtureNow - 14 * 86_400),
      to: day(fixtureNow),
    }),
    "normal",
  )
  if (answer === null || answer.status !== 200) return null
  const series = scanSchemas.series.parse(answer.body).data
  const last = series.points.at(-1)
  if (last === undefined) return null
  // The series fixture scales amounts by the decimals it knows (else 18).
  const decimals =
    metric === "token.holders" ? 0 : (knownTokens[token]?.decimals ?? 18)
  return { ...last, decimals }
}

function priceOf(pricedAs: ScanTokenListItem["priced_as"]): string | null {
  if (pricedAs === "usd") return "1"
  if (pricedAs === "btc") return demoPrices.btc?.usd ?? null
  if (pricedAs === "mezo") return demoPrices.mezo?.usd ?? null
  return null
}

function tokenRow(address: string): ScanTokenListItem {
  const registered = registry[address] ?? unregistered
  const price = priceOf(registered.pricedAs)
  const supplyClose = withSeries.has(address)
    ? latestClose("token.total_supply", address)
    : null
  const holdersClose = withSeries.has(address)
    ? latestClose("token.holders", address)
    : null
  // The same whole units the series show, in the registry's decimals.
  const whole =
    supplyClose === null
      ? null
      : unitsToDecimal(supplyClose.value, supplyClose.decimals)
  const supplyValue =
    whole === null || registered.decimals === null
      ? (supplyClose?.value ?? null)
      : (
          BigInt(whole.split(".")[0] ?? "0") *
          10n ** BigInt(registered.decimals)
        ).toString()
  return {
    address,
    symbol: registered.symbol,
    name: registered.name,
    decimals: registered.decimals,
    priced_as: registered.pricedAs,
    price_usd: price,
    price_source:
      price === null
        ? null
        : registered.pricedAs === "usd"
          ? "registry"
          : registered.pricedAs === "btc"
            ? (demoPrices.btc?.source ?? null)
            : (demoPrices.mezo?.source ?? null),
    supply:
      supplyClose === null || supplyValue === null
        ? null
        : {
            value: supplyValue,
            day: supplyClose.day,
            partial: supplyClose.partial,
          },
    supply_usd:
      whole === null || price === null || registered.decimals === null
        ? null
        : usdValue(whole.split(".")[0] ?? "0", price),
    holders:
      holdersClose === null
        ? null
        : {
            value: holdersClose.value,
            day: holdersClose.day,
            partial: holdersClose.partial,
          },
  }
}

function tokenList(scenario: FixtureScenario) {
  const addresses = [
    ...Object.keys(registry),
    ...[...withSeries].filter((address) => registry[address] === undefined),
  ]
  const data = addresses.map(tokenRow)
  return ok({
    data,
    prices: {
      btc_usd: demoPrices.btc?.usd ?? null,
      mezo_usd: demoPrices.mezo?.usd ?? null,
    },
    meta: aggregateMeta(
      scenario,
      data.every(
        (row) => row.supply?.partial !== true && row.holders?.partial !== true,
      ),
    ),
  })
}

/** The network pages' /internal/scan fixtures. */
export const networkFixtures: FixtureRoute[] = [
  {
    pattern: /^tokens$/,
    answer: (_match, query, scenario) =>
      // It takes no query, as the API's route.
      [...query.keys()].length > 0 ? badRequest : tokenList(scenario),
  },
]
