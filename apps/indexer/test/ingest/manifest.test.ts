import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { z } from "zod"
import {
  EXPLORER_STATIC_CONTRACTS,
  WAREHOUSE_STATIC_CONTRACTS,
} from "../../src/ingest/static-contracts"
import type { ContractKind } from "../../src/ingest/store"
import { FILTER_GROUPS, HANDLED_EVENTS } from "../../src/ingest/topics"

// The explorer subgraph is the reference for what ingest must cover. These
// tests fail when its manifest and the ingest config drift apart.

// Snapshots of apps/activity-subgraph/subgraph.yaml (as JSON) and
// src/legacy-pool-rewards.ts from MallardLabs/Matchbox main (8 Nov 2026), the
// last manifest the explorer subgraph was built from.
const subgraphDir = fileURLToPath(
  new URL("../fixtures/activity-subgraph/", import.meta.url),
)

const sourceSchema = z.object({
  name: z.string(),
  source: z.object({ address: z.string().optional(), abi: z.string() }),
  mapping: z.object({
    eventHandlers: z.array(z.object({ event: z.string() })),
  }),
})

// subgraph.yaml converted to JSON, so the test needs no YAML parser.
const manifest = z
  .object({
    dataSources: z.array(sourceSchema),
    templates: z.array(sourceSchema),
  })
  .parse(
    JSON.parse(readFileSync(resolve(subgraphDir, "subgraph.json"), "utf8")),
  )

function canonical(event: string): string {
  return event.replace(/indexed\s+/g, "").replace(/\s+/g, "")
}

const TEMPLATE_KINDS: Record<string, ContractKind> = {
  Gauge: "gauge",
  BribeVotingReward: "bribeVotingReward",
  FeeVotingReward: "feeVotingReward",
  Pool: "pool",
}

describe("static contracts", () => {
  const statics = new Map(
    EXPLORER_STATIC_CONTRACTS.map((contract) => [contract.template, contract]),
  )

  it("lists every explorer data source at its address", () => {
    expect(statics.size).toBe(manifest.dataSources.length)
    for (const source of manifest.dataSources) {
      expect(statics.get(source.name)?.address).toBe(
        source.source.address?.toLowerCase(),
      )
    }
  })

  it("links each Legacy* reward contract to the pool and gauge on record", () => {
    const legacy = readFileSync(
      resolve(subgraphDir, "legacy-pool-rewards.ts.txt"),
      "utf8",
    )
    const triples = [
      ...legacy.matchAll(
        /\[\s*"(0x[0-9a-f]{40})",\s*"(0x[0-9a-f]{40})",\s*"(0x[0-9a-f]{40})",?\s*\]/g,
      ),
    ]
    expect(triples).toHaveLength(18)
    const byAddress = new Map(
      EXPLORER_STATIC_CONTRACTS.map((contract) => [contract.address, contract]),
    )
    for (const [, reward, pool, gauge] of triples) {
      expect(byAddress.get(reward as `0x${string}`)).toMatchObject({
        pool,
        gauge,
      })
    }
  })
})

describe("handled topics", () => {
  it("covers every data source handler for its kind", () => {
    const statics = new Map(
      EXPLORER_STATIC_CONTRACTS.map((contract) => [
        contract.template,
        contract.kind,
      ]),
    )
    for (const source of manifest.dataSources) {
      const kind = statics.get(source.name) as ContractKind
      expect(
        [...HANDLED_EVENTS[kind]].sort(),
        `${source.name} (${kind})`,
      ).toEqual(
        source.mapping.eventHandlers
          .map((handler) => canonical(handler.event))
          .sort(),
      )
    }
  })

  it("covers every template handler for its kind", () => {
    for (const template of manifest.templates) {
      const kind = TEMPLATE_KINDS[template.name] as ContractKind
      expect(kind, template.name).toBeDefined()
      expect([...HANDLED_EVENTS[kind]].sort(), template.name).toEqual(
        template.mapping.eventHandlers
          .map((handler) => canonical(handler.event))
          .sort(),
      )
    }
  })

  it("puts every kind in exactly one filter group", () => {
    const grouped = FILTER_GROUPS.flatMap((group) => group.kinds)
    expect(new Set(grouped).size).toBe(grouped.length)
    expect([...grouped].sort()).toEqual(
      (Object.keys(HANDLED_EVENTS) as ContractKind[]).sort(),
    )
  })

  it("reads voter bribe rewards like pool bribe rewards", () => {
    expect(HANDLED_EVENTS.voterBribeReward).toEqual(
      HANDLED_EVENTS.bribeVotingReward,
    )
  })
})

describe("warehouse-only static contracts", () => {
  it("are not explorer data sources and start at their deployment", () => {
    const explorerAddresses = new Set(
      manifest.dataSources.map((source) =>
        source.source.address?.toLowerCase(),
      ),
    )
    expect(
      WAREHOUSE_STATIC_CONTRACTS.map((contract) => [
        contract.template,
        contract.kind,
        contract.createdBlock,
      ]),
    ).toEqual([
      ["MusdBorrowerOperations", "musdBorrowerOperations", 178_630n],
      ["MusdTroveManager", "musdTroveManager", 178_660n],
    ])
    for (const contract of WAREHOUSE_STATIC_CONTRACTS) {
      expect(explorerAddresses.has(contract.address)).toBe(false)
    }
  })
})
