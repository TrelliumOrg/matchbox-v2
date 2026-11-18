import { describe, expect, it } from "vitest"
import { classicAppRedirect } from "./classic-paths"

const app = "2b5a2814-a844-4572-aa2e-75650fd3841c"

describe("Classic console paths", () => {
  it("sends Classic per-tab app paths to the one app page", () => {
    const keys = classicAppRedirect(
      new URL(`https://developer.matchbox.markets/apps/${app}/keys?org=x`),
    )
    expect(keys?.status).toBe(301)
    expect(keys?.headers.get("location")).toBe(`/apps/${app}?org=x&tab=keys`)
    expect(
      classicAppRedirect(
        new URL(`https://developer.matchbox.markets/apps/${app}/environments`),
      )?.headers.get("location"),
    ).toBe(`/apps/${app}?tab=environment`)
  })

  it("leaves every other path alone", () => {
    for (const path of [`/apps/${app}`, "/apps", `/apps/${app}/nope`, "/"]) {
      expect(
        classicAppRedirect(
          new URL(`https://developer.matchbox.markets${path}`),
        ),
      ).toBeNull()
    }
  })
})
