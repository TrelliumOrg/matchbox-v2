import type { Hono } from "hono"
import type { ApiEnv } from "../context"
import { registerScanBorrow } from "./borrow"
import { registerScanBorrowTotals } from "./borrow-totals"
import { ScanContext, type ScanRouteDeps } from "./context"
import { registerScanCrossChain } from "./crosschain"
import { registerScanEnclaves } from "./enclaves"
import { registerScanEntities } from "./entities"
import { registerScanGovernance } from "./governance"
import { registerScanLists } from "./lists"
import { registerScanLookups } from "./lookups"
import { registerScanMarkets } from "./markets"
import { registerScanMezoIds } from "./mezo-ids"
import { registerScanUptime } from "./uptime"
import { registerScanValidators } from "./validators"

// /internal/scan: Matchscan's read routes (README, "Scan read routes").
// Behind the /internal gate like every internal route; Workers call it, so
// it sends no CORS headers.

export type { ScanRouteDeps }

export default function registerScanRoutes(
  app: Hono<ApiEnv>,
  deps: ScanRouteDeps,
): void {
  const scan = new ScanContext(deps)
  app.use("/internal/scan/*", async function scanNoCors(c, next) {
    c.set("cors", { kind: "anonymous" })
    await next()
    c.set("cors", { kind: "anonymous" })
  })
  registerScanLists(app, scan)
  registerScanBorrow(app, scan)
  registerScanBorrowTotals(app, scan)
  registerScanEnclaves(app, scan)
  registerScanLookups(app, scan)
  registerScanMarkets(app, scan)
  registerScanMezoIds(app, scan)
  registerScanEntities(app, scan)
  registerScanValidators(app, scan)
  registerScanCrossChain(app, scan)
  registerScanUptime(app, scan)
  registerScanGovernance(app, scan)
}
