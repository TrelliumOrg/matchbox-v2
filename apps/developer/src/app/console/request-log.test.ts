import { describe, expect, it } from "vitest"
import { matchesFilter, usageCsvHref } from "./request-log"

describe("request log", () => {
  it("links the environment usage CSV for the same range", () => {
    expect(
      usageCsvHref(
        "2b5a2814-a844-4572-aa2e-75650fd3841c",
        "2026-11-02T00:00:00.000Z",
        "2026-11-09T00:00:00.000Z",
      ),
    ).toBe(
      "/api/environments/2b5a2814-a844-4572-aa2e-75650fd3841c/usage.csv?from=2026-11-02T00%3A00%3A00.000Z&to=2026-11-09T00%3A00%3A00.000Z&bucket=day",
    )
  })

  it("filters like Classic: 429 has its own chip and 4xx leaves it out", () => {
    const pick = (filter: Parameters<typeof matchesFilter>[1]) =>
      [200, 404, 429, 500, 503].filter((status) =>
        matchesFilter({ status }, filter),
      )
    expect(pick("all")).toEqual([200, 404, 429, 500, 503])
    expect(pick("client-error")).toEqual([404])
    expect(pick("rate-limited")).toEqual([429])
    expect(pick("server-error")).toEqual([500, 503])
  })
})
