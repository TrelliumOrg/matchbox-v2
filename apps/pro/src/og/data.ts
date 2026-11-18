import {
  chainHeadSchema,
  gaugeProfileResponseSchema,
  pricesResponseSchema,
  protocolEpochResponseSchema,
  protocolResponseSchema,
} from "@matchbox/contracts/read-models"
import { z } from "zod"
import type { EpochReference } from "../data/adapters"
import * as adapt from "../data/adapters"
import type { Market, Protocol } from "../data/view-models"
import {
  type DefaultCard,
  defaultCard,
  type GaugeCard,
  gaugeCard,
  type ProtocolCard,
  protocolCard,
} from "./model"

/**
 * Loads each card's figures from the API Worker's read models, through the
 * same schemas and adapters as the screens. The reader is passed in (the
 * Pro Worker's `readModel`, or fixtures in tests) so this module has no
 * Worker bindings.
 */

/** Reads one `/internal/pro/*` path; null on 404. Throws on other failures. */
export type Reader = <T>(
  path: string,
  schema: z.ZodType<T>,
) => Promise<T | null>

export type Sources = {
  read: Reader
  reference: EpochReference | null
  nowSeconds: number
}

const headResponse = z.object({ data: chainHeadSchema })

/** Null when the read model is missing or failed: cards fall back, never fail. */
async function quietly<T>(work: () => Promise<T | null>): Promise<T | null> {
  try {
    return await work()
  } catch {
    return null
  }
}

async function market(sources: Sources): Promise<Market | null> {
  const [head, prices] = await Promise.all([
    sources.read("/internal/pro/head", headResponse),
    sources.read("/internal/pro/prices", pricesResponseSchema),
  ])
  if (head === null || prices === null) return null
  return adapt.market(head.data, prices.data, sources.reference)
}

async function currentProtocol(sources: Sources): Promise<Protocol | null> {
  const found = await sources.read(
    "/internal/pro/protocol",
    protocolResponseSchema,
  )
  return found === null ? null : adapt.protocol(found.data)
}

/** The epoch the clock is in, without a read (cards number from it on failure). */
export function clockEpoch(
  sources: Pick<Sources, "reference" | "nowSeconds">,
): number {
  return adapt.epochFor(sources.nowSeconds, sources.reference).number
}

export async function loadDefault(sources: Sources): Promise<DefaultCard> {
  const [found, protocol] = await Promise.all([
    quietly(() => market(sources)),
    quietly(() => currentProtocol(sources)),
  ])
  return defaultCard(found, protocol, clockEpoch(sources), sources.nowSeconds)
}

/** Null when no gauge has this address. Throws when the API failed. */
export async function loadGauge(
  sources: Sources,
  address: string,
): Promise<GaugeCard | null> {
  const [profile, found] = await Promise.all([
    sources.read(
      `/internal/pro/gauges/${address.toLowerCase()}`,
      gaugeProfileResponseSchema,
    ),
    quietly(() => market(sources)),
  ])
  if (profile === null) return null
  return gaugeCard(
    adapt.gaugeProfile(profile.data),
    found?.epoch.number ?? clockEpoch(sources),
  )
}

/**
 * Protocol for `epoch` (null for the current one), or null when the epoch
 * is not in the chart. Throws when the API failed.
 */
export async function loadProtocol(
  sources: Sources,
  epoch: number | null,
): Promise<ProtocolCard | null> {
  const found = await sources.read(
    "/internal/pro/protocol",
    protocolResponseSchema,
  )
  if (found === null) return null
  const current = found.data.epoch.number
  if (epoch === null || epoch === current) {
    return protocolCard(adapt.protocol(found.data))
  }
  const snapshot = await quietly(() =>
    sources.read(
      `/internal/pro/protocol/epochs/${epoch}`,
      protocolEpochResponseSchema,
    ),
  )
  const view = adapt.protocol(found.data, {
    epoch,
    snapshot: snapshot?.data ?? null,
  })
  // An epoch outside the chart falls back to the current one in the view.
  return view.epoch === epoch ? protocolCard(view) : null
}
