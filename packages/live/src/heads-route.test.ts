// @vitest-environment node
import { describe, expect, it, vi } from "vitest"
import { headsRoute } from "./heads-route"

function upgrade(): Request {
  return new Request("https://scan.test/live/heads", {
    headers: { upgrade: "websocket" },
  })
}

describe("/live/heads", () => {
  it("asks for a WebSocket upgrade", async () => {
    const response = await headsRoute(
      new Request("https://scan.test/live/heads"),
      null,
    )
    expect(response.status).toBe(426)
  })

  it("has no BlockHub without the API binding", async () => {
    expect((await headsRoute(upgrade(), null)).status).toBe(503)
  })

  it("forwards the upgrade to the API Worker's BlockHub", async () => {
    const fetch = vi.fn(async (request: Request) => {
      expect(new URL(request.url).pathname).toBe("/internal/heads")
      expect(request.headers.get("upgrade")).toBe("websocket")
      return new Response(null, { status: 200 })
    })
    const response = await headsRoute(upgrade(), {
      fetch: fetch as unknown as Fetcher["fetch"],
    })
    expect(response.status).toBe(200)
    expect(fetch).toHaveBeenCalledOnce()
  })
})
