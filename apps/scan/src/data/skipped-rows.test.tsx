import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

/**
 * Lists the API answers with rows left out (`meta.skipped`) say so: the
 * token list and the validators table, which have no Pager to say it.
 */

vi.mock("cloudflare:workers", () => ({ env: { SCAN_DATA: "fixtures" } }))
vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeader: () => undefined,
  setResponseHeader: () => {},
}))
// The fixtures' answers, with two rows skipped from these two lists.
vi.mock("./scan/read.server", async (original) => {
  const real = await original<typeof import("./scan/read.server")>()
  return {
    ...real,
    readScan: async (...args: Parameters<typeof real.readScan>) => {
      const read = await real.readScan(...args)
      return (args[0] === "tokens" || args[0] === "validators") &&
        read.status === "ok"
        ? { ...read, skipped: 2 }
        : read
    },
  }
})

const { tokensPage } = await import("./token-pages.server")
const { validatorsPage } = await import("./validators.server")
const { SkippedNote } = await import("../explorer/skipped-note")

describe("rows the API left out", () => {
  it("are counted on the token list and the validators table", async () => {
    expect((await tokensPage()).table).toMatchObject({ skipped: 2 })
    expect(
      (await validatorsPage({ epoch: null, sort: "share" })).table,
    ).toMatchObject({ skipped: 2 })
  })

  it("are said under the list, and nothing is said when none were", () => {
    const { rerender } = render(<SkippedNote skipped={2} what="tokens" />)
    expect(screen.getByRole("status").textContent).toBe(
      "2 of the tokens are not shown: the data for them could not be read.",
    )
    rerender(<SkippedNote skipped={undefined} what="tokens" />)
    expect(screen.queryByRole("status")).toBeNull()
  })
})
