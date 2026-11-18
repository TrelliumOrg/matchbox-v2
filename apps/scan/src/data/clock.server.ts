import { env } from "cloudflare:workers"
import { dataModeFrom } from "@matchbox/app-kit/read-model"
import { fixtureNow } from "./scan/fixtures/shared"

/**
 * The server's "now" in unix seconds. In fixtures mode it is the fixture
 * world's own now (the recorded Blockscout head, Mon 9 Nov 2026, Epoch
 * 47), so on any real date the shell's epoch, the pages' ages and epochs
 * and the fixture data agree. In api mode it is the clock.
 */
export function nowSeconds(): number {
  return dataModeFrom(env.SCAN_DATA) === "fixtures"
    ? fixtureNow
    : Math.floor(Date.now() / 1000)
}
