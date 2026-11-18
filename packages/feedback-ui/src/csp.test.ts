import { describe, expect, it } from "vitest"
import { feedbackCspSources } from "./csp"

describe("feedbackCspSources", () => {
  it("allows the Worker and Turnstile when the widget is built in", () => {
    expect(feedbackCspSources("https://feedback.matchbox.markets/")).toEqual({
      connect: [
        "https://feedback.matchbox.markets",
        "https://challenges.cloudflare.com",
      ],
      frames: ["https://challenges.cloudflare.com"],
    })
  })

  it("adds nothing to a build without it", () => {
    expect(feedbackCspSources(undefined)).toEqual({ connect: [], frames: [] })
    expect(feedbackCspSources("javascript:alert(1)")).toEqual({
      connect: [],
      frames: [],
    })
  })
})
