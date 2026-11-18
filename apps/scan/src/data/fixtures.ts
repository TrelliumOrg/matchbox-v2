import {
  demoMeta,
  demoPrices,
  demoWalletOverview,
  demoWalletRewards,
} from "@matchbox/contracts/read-models/fixtures"
import { fixtureHead } from "./blockscout/fixtures"
import { wallet } from "./scan/fixtures/world"

/**
 * Fixtures mode (`SCAN_DATA=fixtures`): the shared demo prices and, as the
 * head, the newest block in the recorded Blockscout fixtures, so the shell
 * and the pages agree; the fixture wallet's rewards and overview are the
 * demo wallet's (Epoch 47 in both worlds). Answers by full path, like the
 * API Worker.
 */
export function fixtureResponse(path: string): {
  status: number
  body: unknown
} {
  if (path === "/internal/pro/head") {
    return { status: 200, body: { data: fixtureHead } }
  }
  if (path === "/internal/pro/prices") {
    return { status: 200, body: { data: demoPrices } }
  }
  if (path === `/internal/pro/wallets/${wallet}/rewards`) {
    return {
      status: 200,
      body: {
        data: {
          ...demoWalletRewards,
          address: wallet,
          // What the history adds up to, as the jobs write it (the shared
          // demo's figure covers epochs its history does not hold).
          earned: { usd: "2457.40", fromEpoch: 42, toEpoch: 45 },
        },
        meta: demoMeta,
      },
    }
  }
  if (path === `/internal/pro/wallets/${wallet}/overview`) {
    return {
      status: 200,
      body: {
        data: { ...demoWalletOverview, address: wallet },
        meta: demoMeta,
      },
    }
  }
  return { status: 404, body: { error: "not_found" } }
}
