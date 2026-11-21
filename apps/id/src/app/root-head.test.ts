import { describe, expect, it } from "vitest"
import { Route } from "../routes/__root"
import { Route as SignIn } from "../routes/sign-in"

describe("document head", () => {
  it("has no referrer meta, which would override /authorize's no-referrer", async () => {
    const head = await Route.options.head?.({
      matches: [{ pathname: "/authorize" }],
    } as never)
    const meta = head?.meta ?? []
    expect(
      meta.some(
        (entry) =>
          entry !== undefined && "name" in entry && entry.name === "referrer",
      ),
    ).toBe(false)
  })

  it("links each page's production address as canonical, without the query", async () => {
    const head = await Route.options.head?.({
      matches: [{ pathname: "/sign-in" }],
    } as never)
    const canonical = (head?.links ?? []).filter(
      (link) => link !== undefined && link.rel === "canonical",
    )
    expect(canonical).toEqual([
      { rel: "canonical", href: "https://id.matchbox.markets/sign-in" },
    ])
  })

  it("names the product in the sign-in page's title", async () => {
    const head = await SignIn.options.head?.({} as never)
    expect(head?.meta).toContainEqual({ title: "Sign in | Matchbox ID" })
  })
})
