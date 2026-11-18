import { demoGaugeDirectory } from "@matchbox/contracts/read-models/fixtures"
import {
  badRequest,
  currentEpoch,
  epochStart,
  type FixtureRoute,
  ok,
} from "./shared"
import { findLock, labels } from "./world"

/**
 * `/search?kind=&q=` as the API answers it: labels by name prefix plus
 * gauge names from Pro's directory, a label by address or address prefix,
 * an epoch by number or start, a lock by id in either escrow.
 */

const maxMatches = 20

function nameHits(q: string) {
  const lower = q.toLowerCase()
  const byName = Object.values(labels)
    .filter((label) => label.name.toLowerCase().startsWith(lower))
    .slice(0, maxMatches)
  const labelled = new Set(byName.map((label) => label.address))
  const gauges = demoGaugeDirectory.gauges
    .filter((card) => card.gauge.name.toLowerCase().includes(lower))
    .slice(0, maxMatches)
    .map((card) => ({
      address: card.gauge.address.toLowerCase(),
      name: card.gauge.name,
    }))
    .filter((gauge) => !labelled.has(gauge.address))
  return [
    ...byName.map((label) => ({ type: "label", label })),
    ...gauges.map((gauge) => ({ type: "gauge", ...gauge })),
  ]
}

export const searchFixtures: FixtureRoute[] = [
  {
    pattern: /^search$/,
    answer: (_match, query) => {
      const kind = query.get("kind")
      const q = query.get("q") ?? ""
      if (q === "" || q.length > 80) return badRequest
      switch (kind) {
        case "name":
          return ok({ data: { kind, hits: nameHits(q) } })
        case "address": {
          const found = labels[q.toLowerCase()]
          return ok({
            data: {
              kind,
              hits:
                found === undefined ? [] : [{ type: "label", label: found }],
            },
          })
        }
        case "address-prefix": {
          const lower = q.toLowerCase()
          return ok({
            data: {
              kind,
              hits: Object.values(labels)
                .filter((label) => label.address.startsWith(lower))
                .slice(0, maxMatches)
                .map((label) => ({ type: "label", label })),
            },
          })
        }
        case "epoch": {
          const number = Number(q)
          if (!Number.isInteger(number) || number < 0) return badRequest
          const start = number < 100_000 ? epochStart(number) : number
          const known = start <= epochStart(currentEpoch)
          return ok({
            data: {
              kind,
              hits: known ? [{ type: "epoch", epoch_start: start }] : [],
            },
          })
        }
        case "lock": {
          const [escrow, id] = q.includes(":") ? q.split(":") : [null, q]
          if (id === undefined || !/^(0|[1-9][0-9]{0,77})$/.test(id)) {
            return badRequest
          }
          const escrows = escrow === null ? ["vebtc", "vemezo"] : [escrow]
          const hits = escrows.flatMap((name) => {
            const found = name === undefined ? null : findLock(name, id)
            return found === null
              ? []
              : [{ type: "lock", escrow: found.escrow, token_id: id }]
          })
          return ok({ data: { kind, hits } })
        }
        default:
          return badRequest
      }
    },
  },
]
