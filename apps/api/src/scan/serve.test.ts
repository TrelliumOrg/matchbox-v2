import { Hono } from "hono"
import { describe, expect, it } from "vitest"
import type { ApiEnv } from "../context"
import { ScanResponder, scanMaxMemoryEntryBytes } from "./serve"

// The responder's isolate memory is a byte-budgeted LRU, as the proxy's:
// entries count by size, the oldest go first, and big bodies stay at the
// edge only.

function app(responder: ScanResponder, size: () => number) {
  const hono = new Hono<ApiEnv>()
  hono.get("/:name", (c) =>
    responder.serve(c, {
      cacheClass: "run",
      resource: c.req.param("name"),
      version: "v1",
      caller: { client: "scan", endUser: null },
      render: async () => ({ body: { text: "x".repeat(size()) } }),
    }),
  )
  return hono
}

async function source(hono: Hono<ApiEnv>, name: string): Promise<string> {
  const response = await hono.request(`https://api.internal/${name}`)
  expect(response.status).toBe(200)
  return response.headers.get("X-Cache") ?? ""
}

describe("the scan responder's memory", () => {
  it("keeps entries within its byte budget, oldest out first", async () => {
    const budget = 200 * 1024
    const responder = new ScanResponder({
      cache: null,
      rateLimits: null,
      memoryBytes: budget,
    })
    // About 40 KiB held per entry (UTF-16): five fit, ten do not.
    const hono = app(responder, () => 20 * 1024)
    for (let index = 0; index < 10; index += 1) {
      expect(await source(hono, `page-${index}`)).toBe("miss")
    }
    expect(responder.heldBytes).toBeLessThanOrEqual(budget)
    expect(responder.heldBytes).toBeGreaterThan(budget / 2)
    expect(await source(hono, "page-9")).toBe("memory")
    expect(await source(hono, "page-0")).toBe("miss")
  })

  it("leaves a body bigger than an entry may be to the edge", async () => {
    const responder = new ScanResponder({ cache: null, rateLimits: null })
    const hono = app(responder, () => scanMaxMemoryEntryBytes)
    expect(await source(hono, "directory")).toBe("miss")
    expect(responder.heldBytes).toBe(0)
    expect(await source(hono, "directory")).toBe("miss")
  })
})
