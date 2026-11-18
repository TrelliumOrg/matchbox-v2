import { describe, expect, it } from "vitest"
import { Route } from "../routes/__root"

describe("document head", () => {
  it("has no referrer meta, which would override /authorize's no-referrer", async () => {
    const head = await Route.options.head?.({} as never)
    const meta = head?.meta ?? []
    expect(
      meta.some(
        (entry) =>
          entry !== undefined && "name" in entry && entry.name === "referrer",
      ),
    ).toBe(false)
  })
})
