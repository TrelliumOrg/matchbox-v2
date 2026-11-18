import {
  type ScanLockEscrow,
  scanAprHistorySchema,
  scanEpochSourcesSchema,
  scanGaugeAprHistorySchema,
  scanGaugeEmissionsSchema,
  scanLockDistributionDocumentSchema,
} from "@matchbox/contracts/scan"
import { canonicalQuery } from "../caller.server"
import { readScan } from "./read.server"

/**
 * The governance summary routes (apps/api README "Governance"). Each read
 * is one subrequest; a route the API does not serve yet answers 404,
 * which the page shows as its panel's "not available", never a crash.
 */

export function readEpochSources(epochs: number) {
  return readScan(
    "epoch-sources",
    canonicalQuery({ epochs }),
    scanEpochSourcesSchema,
  )
}

export function readEpochEmissions(start: number, source: string) {
  return readScan(
    `epoch-emissions/${start}`,
    canonicalQuery({ source }),
    scanGaugeEmissionsSchema,
  )
}

export function readGaugeEmissions(gauge: string, limit: number) {
  return readScan(
    `gauges/${gauge}/emissions`,
    canonicalQuery({ limit }),
    scanGaugeEmissionsSchema,
  )
}

export function readVotingApr(epochs: number) {
  return readScan("apr", canonicalQuery({ epochs }), scanAprHistorySchema)
}

export function readGaugeApr(gauge: string, limit: number) {
  return readScan(
    `gauges/${gauge}/apr`,
    canonicalQuery({ limit }),
    scanGaugeAprHistorySchema,
  )
}

export function readLockDistribution(escrow: ScanLockEscrow) {
  return readScan(
    "lock-distribution",
    canonicalQuery({ escrow }),
    scanLockDistributionDocumentSchema,
  )
}
