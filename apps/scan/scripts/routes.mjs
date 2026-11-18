import { borrowLighthouseRoutes, borrowRoutes } from "./routes-borrow.mjs"
import { networkLighthouseRoutes, networkRoutes } from "./routes-network.mjs"
import { poolsLighthouseRoutes, poolsRoutes } from "./routes-pools.mjs"
import {
  validatorsLighthouseRoutes,
  validatorsRoutes,
} from "./routes-validators.mjs"
import { votingLighthouseRoutes, votingRoutes } from "./routes-voting.mjs"

// The Scan routes every performance gate measures: each nav section, the
// network lists and one of each entity page, on ids the recorded Blockscout
// fixtures hold (src/data/blockscout/fixtures.ts).
export const fixtureTx =
  "0x45e0962d6c0fa8ae9d30ba18cf7351ac0fcf3c0487fd231107510ebb0db66988"
export const fixtureBlock = "13118064"
export const fixtureAddress = "0x2ba614a598cffa5a19d683cdca97bac3a49313d1"
/** The recorded transaction's sender: the fixtures' voter and borrower. */
export const fixtureWallet = "0x4582a89e307387293c7f93c11a095a8dd3d3f901"

export const scanRoutes = [
  "/",
  "/network/transactions",
  "/network/blocks",
  "/borrow",
  "/gauges",
  "/validators",
  "/locks",
  "/epochs",
  "/tokens",
  `/tx/${fixtureTx}`,
  `/block/${fixtureBlock}`,
  `/address/${fixtureAddress}`,
  `/address/${fixtureAddress}/transfers`,
  `/address/${fixtureWallet}`,
  `/address/${fixtureWallet}/votes`,
  `/address/${fixtureWallet}/rewards`,
  `/address/${fixtureWallet}/activity`,
  `/address/${fixtureWallet}/loans`,
  ...votingRoutes,
  ...borrowRoutes,
  ...networkRoutes,
  ...validatorsRoutes,
  ...poolsRoutes,
]

// Lighthouse runs each page several times, so it takes the ones that read
// the proxy (and Home's LCP) rather than every nav section.
export const lighthouseRoutes = [
  "/",
  "/network/transactions",
  "/network/blocks",
  `/tx/${fixtureTx}`,
  `/block/${fixtureBlock}`,
  `/address/${fixtureAddress}`,
  `/address/${fixtureWallet}`,
  "/gauges",
  ...votingLighthouseRoutes,
  ...borrowLighthouseRoutes,
  ...networkLighthouseRoutes,
  ...validatorsLighthouseRoutes,
  ...poolsLighthouseRoutes,
]
