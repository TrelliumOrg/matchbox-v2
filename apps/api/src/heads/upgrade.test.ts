import { describe, expect, it } from "vitest"
import { routeHeadsUpgrade } from "./upgrade"

function hub() {
  const calls: { name: string; url: string }[] = []
  const namespace = {
    idFromName: (name: string) => name,
    get: (id: string) => ({
      fetch: async (request: Request) => {
        calls.push({ name: id, url: request.url })
        return new Response("hub")
      },
    }),
  }
  return { calls, env: { BLOCK_HUB: namespace } }
}

function upgrade(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { headers: { Upgrade: "websocket", ...headers } })
}

describe("routeHeadsUpgrade", () => {
  it("hands a binding caller's upgrade straight to the BlockHub", async () => {
    const { calls, env } = hub()
    const response = await routeHeadsUpgrade(
      upgrade("https://api.internal/internal/heads"),
      env,
      null,
    )
    expect(await response?.text()).toBe("hub")
    expect(calls).toEqual([
      { name: "mezo", url: "https://api.internal/internal/heads" },
    ])
  })

  it("refuses a public upgrade without a valid token", async () => {
    const { calls, env } = hub()
    const publicUrl = "https://api.matchbox.markets/internal/heads"
    expect(
      await routeHeadsUpgrade(
        upgrade(publicUrl),
        env,
        "s3cret-0123456789-abcdefghijklmnopq",
      ),
    ).toBe(null)
    expect(
      await routeHeadsUpgrade(
        upgrade(publicUrl, { Authorization: "Bearer wrong" }),
        env,
        "s3cret-0123456789-abcdefghijklmnopq",
      ),
    ).toBe(null)
    expect(
      await routeHeadsUpgrade(
        upgrade(publicUrl, {
          Authorization: "Bearer s3cret-0123456789-abcdefghijklmnopq",
        }),
        env,
        null,
      ),
    ).toBe(null)
    expect(calls).toEqual([])
  })

  it("accepts the development token on the public origin", async () => {
    const { calls, env } = hub()
    const response = await routeHeadsUpgrade(
      upgrade("https://api.matchbox.markets/internal/heads", {
        Authorization: "Bearer s3cret-0123456789-abcdefghijklmnopq",
      }),
      env,
      "s3cret-0123456789-abcdefghijklmnopq",
    )
    expect(await response?.text()).toBe("hub")
    expect(calls).toHaveLength(1)
  })

  it("leaves everything else to the app", async () => {
    const { env } = hub()
    expect(
      await routeHeadsUpgrade(
        new Request("https://api.internal/internal/heads"),
        env,
        null,
      ),
    ).toBeNull()
    expect(
      await routeHeadsUpgrade(
        upgrade("https://api.internal/internal/pro/head"),
        env,
        null,
      ),
    ).toBeNull()
    expect(
      await routeHeadsUpgrade(
        upgrade("https://api.internal/internal/heads"),
        {},
        null,
      ),
    ).toBeNull()
  })
})
