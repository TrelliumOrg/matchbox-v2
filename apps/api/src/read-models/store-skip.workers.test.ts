import { applyD1Migrations } from "cloudflare:test"
import { env } from "cloudflare:workers"
import { demoWalletOverview } from "@matchbox/contracts/read-models/fixtures"
import { beforeEach, describe, expect, it } from "vitest"
import {
  type ReadDatabase,
  type ReadModelKind,
  type ReadModelWrite,
  readReadModel,
  writeReadModels,
} from "./store"

// The warehouse snapshot wrote 930 documents a run, 816 of them gauge
// histories and protocol epochs that had not changed: 8.6 s of a 12.3 s
// run (12 Nov 2026). `skipUnchanged` does not send those.

const base = {
  network: "mezo" as const,
  block: 13_182_111,
  source: "warehouse" as const,
  updatedAt: 1_794_505_500,
}

function history(
  index: number,
  votesUnit: "veMEZO" | "veBTC" = "veMEZO",
): ReadModelWrite<"gauge-history"> {
  const address = `0x${index.toString(16).padStart(40, "0")}`
  return {
    ...base,
    kind: "gauge-history",
    key: address,
    data: { address, votesUnit, epochs: [] },
  }
}

/** Counts the statements sent to D1 in batches. */
function counting(db: ReadDatabase): { db: ReadDatabase; sent: () => number } {
  let sent = 0
  const proxy = new Proxy(db, {
    get(target, property, receiver) {
      if (property === "batch") {
        return (statements: D1PreparedStatement[]) => {
          sent += statements.length
          return target.batch(statements)
        }
      }
      const value: unknown = Reflect.get(target, property, receiver)
      return typeof value === "function" ? value.bind(target) : value
    },
  })
  return { db: proxy, sent: () => sent }
}

beforeEach(async () => {
  await applyD1Migrations(env.READ_DB, env.TEST_MIGRATIONS)
  await env.READ_DB.prepare("DELETE FROM read_models").run()
})

describe("writing only what changed", () => {
  const kinds: ReadModelKind[] = ["gauge-history"]
  const histories = Array.from({ length: 120 }, (_, index) => history(index))

  it("sends nothing for documents that are already stored as they are", async () => {
    const first = counting(env.READ_DB)
    expect(
      await writeReadModels(first.db, histories, { skipUnchanged: kinds }),
    ).toBe(120)
    // Nothing stored yet: every document is new and goes out.
    expect(first.sent()).toBe(120)

    const second = counting(env.READ_DB)
    expect(
      await writeReadModels(second.db, histories, { skipUnchanged: kinds }),
    ).toBe(0)
    expect(second.sent()).toBe(0)
  })

  it("still writes the one that changed and the one that is new", async () => {
    await writeReadModels(env.READ_DB, histories, { skipUnchanged: kinds })
    const next = [
      ...histories.slice(0, 119),
      history(119, "veBTC"),
      history(500),
    ]
    const run = counting(env.READ_DB)
    expect(await writeReadModels(run.db, next, { skipUnchanged: kinds })).toBe(
      2,
    )
    expect(run.sent()).toBe(2)
    const changed = await readReadModel(
      env.READ_DB,
      "mezo",
      "gauge-history",
      history(119).key,
    )
    expect(changed?.data.votesUnit).toBe("veBTC")
    expect(
      await readReadModel(
        env.READ_DB,
        "mezo",
        "gauge-history",
        history(500).key,
      ),
    ).not.toBeNull()
  })

  it("leaves the kinds it was not told about alone: they are always sent", async () => {
    const wallet: ReadModelWrite<"wallet-overview"> = {
      ...base,
      kind: "wallet-overview",
      key: demoWalletOverview.address,
      data: demoWalletOverview,
    }
    await writeReadModels(env.READ_DB, [wallet, ...histories], {
      skipUnchanged: kinds,
    })
    const run = counting(env.READ_DB)
    await writeReadModels(run.db, [wallet, ...histories], {
      skipUnchanged: kinds,
    })
    // The wallet document goes to D1, which finds it unchanged.
    expect(run.sent()).toBe(1)
  })

  it("writes everything, as before, when asked to skip nothing", async () => {
    await writeReadModels(env.READ_DB, histories)
    const run = counting(env.READ_DB)
    expect(await writeReadModels(run.db, histories)).toBe(0)
    expect(run.sent()).toBe(120)
  })

  it("writes everything when the stored etags cannot be read", async () => {
    await writeReadModels(env.READ_DB, histories, { skipUnchanged: kinds })
    let sent = 0
    const broken = new Proxy(env.READ_DB, {
      get(target, property, receiver) {
        if (property === "batch") {
          return (statements: D1PreparedStatement[]) => {
            sent += statements.length
            return target.batch(statements)
          }
        }
        if (property === "prepare") {
          return (sql: string) => {
            if (sql.startsWith("SELECT doc_key, etag")) {
              throw new Error("D1 unavailable")
            }
            return target.prepare(sql)
          }
        }
        const value: unknown = Reflect.get(target, property, receiver)
        return typeof value === "function" ? value.bind(target) : value
      },
    })
    await writeReadModels(broken, histories, { skipUnchanged: kinds })
    expect(sent).toBe(120)
  })
})
