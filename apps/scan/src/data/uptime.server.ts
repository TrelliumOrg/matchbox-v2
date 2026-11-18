import {
  scanUptimeSchema,
  scanValidatorUptimeSchema,
} from "@matchbox/contracts/scan"
import { nowSeconds } from "./clock.server"
import type { Section } from "./explorer"
import { readScan } from "./scan/read.server"
import { scanSection } from "./scan/voting-views"
import {
  overviewOf,
  type UptimeFreshness,
  type UptimeOverview,
  type ValidatorUptimeView,
  validatorUptimeOf,
} from "./uptime-views"

/**
 * Reads of the API's validator uptime routes for the pages (views in
 * uptime-views). Each read is its own section: a failed uptime read never
 * takes the rest of a page with it.
 */

export function readUptimeOverview(): Promise<Section<UptimeOverview>> {
  const now = nowSeconds()
  return readScan("uptime", new URLSearchParams(), scanUptimeSchema).then(
    (read) => scanSection(read, (body) => overviewOf(body, now)),
  )
}

export function readValidatorUptime(
  address: string,
): Promise<Section<ValidatorUptimeView>> {
  const now = nowSeconds()
  return readScan(
    `validators/${address.toLowerCase()}/uptime`,
    new URLSearchParams(),
    scanValidatorUptimeSchema,
  ).then((read) => scanSection(read, (body) => validatorUptimeOf(body, now)))
}

/** The blocks page's "20 of 21 signing", with its freshness. */
export type SigningNote = {
  freshness: UptimeFreshness
  /** "20 of 21 signing"; null before the first count or when paused. */
  signing: string | null
  height: number | null
}

export async function signingNote(): Promise<Section<SigningNote>> {
  const overview = await readUptimeOverview()
  if (overview.status !== "ok") return overview
  const { freshness, signing } = overview.data
  return {
    status: "ok",
    data: {
      freshness,
      signing:
        signing === null || !freshness.live
          ? null
          : `${signing.signing} of ${signing.of} signing`,
      height: signing?.height ?? null,
    },
  }
}
