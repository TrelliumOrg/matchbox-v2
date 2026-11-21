import { borrowFixtures } from "./borrow"
import { crossChainFixtures } from "./crosschain"
import { entityFixtures } from "./entities"
import { governanceFixtures } from "./governance"
import { marketFixtures, rollupSeriesFixtures } from "./markets"
import { mezoIdFixtures } from "./mezo-ids"
import { networkFixtures } from "./network"
import { searchFixtures } from "./search"
import type { FixtureAnswer, FixtureRoute, FixtureScenario } from "./shared"
import { statusFixtures } from "./status"
import { uptimeFixtures } from "./uptime"
import { validatorsFixtures } from "./validators"
import { votingFixtures } from "./voting"

/**
 * Fixtures mode for `/internal/scan/*`: answers built to the route
 * contracts in `@matchbox/contracts/scan` (each one is parsed with its
 * schema in fixtures.test.ts), around the recorded Blockscout fixtures'
 * transaction, block and address. The database is not bound anywhere yet,
 * so nothing could be recorded from a live route.
 *
 * A request may ask for a scenario with `x-scan-fixture` (fixtures mode
 * only; such pages bypass the page cache): `disabled` answers 503 as the
 * API does without its database, `limited` answers 429, `filling` answers
 * aggregates as not computed yet, `delayed` has the copy step halt tables
 * (`/status`), `partial` has the cross-chain pools on Mezo with no daily
 * row (GeckoTerminal answering 429 for Mezo's pools), `refill` has a re-fill of
 * the copy due (`/status`) with nothing behind.
 */

export type { FixtureScenario }

export function fixtureScenario(header: string | null): FixtureScenario {
  return header === "disabled" ||
    header === "limited" ||
    header === "filling" ||
    header === "delayed" ||
    header === "partial" ||
    header === "refill"
    ? header
    : "normal"
}

const routes: readonly FixtureRoute[] = [
  ...entityFixtures,
  ...searchFixtures,
  ...mezoIdFixtures,
  ...rollupSeriesFixtures,
  ...votingFixtures,
  ...borrowFixtures,
  ...networkFixtures,
  ...validatorsFixtures,
  ...uptimeFixtures,
  ...statusFixtures,
  ...crossChainFixtures,
  ...marketFixtures,
  ...governanceFixtures,
]

const notFound: FixtureAnswer = {
  status: 404,
  body: { error: { code: "not_found", message: "Not found" } },
}

export function scanFixture(
  path: string,
  query: URLSearchParams,
  scenario: FixtureScenario = "normal",
): FixtureAnswer {
  // Without SCAN_DB the composed documents still answer 200, their own
  // parts unavailable (reason disabled), and Mezo IDs need no database;
  // every other route answers 503.
  if (
    scenario === "disabled" &&
    !path.toLowerCase().startsWith("entities/") &&
    !path.toLowerCase().startsWith("mezo-ids")
  ) {
    return {
      status: 503,
      body: { error: { code: "service_disabled", message: "Disabled" } },
    }
  }
  if (scenario === "limited") {
    return {
      status: 429,
      body: { error: { code: "rate_limited", message: "Rate limited" } },
    }
  }
  const lower = path.toLowerCase()
  for (const route of routes) {
    const match = route.pattern.exec(route.exact === true ? path : lower)
    if (match !== null) {
      return route.answer(match, query, scenario) ?? notFound
    }
  }
  return notFound
}
