import { errorBodySchema } from "@matchbox/contracts/errors"
import { describe, expect, it } from "vitest"
import type { InternalProDeps } from "../read-models/routes"
import { createHarness } from "../testing"
import {
  internalCaller,
  isBindingHostname,
  isInternalPath,
  markBindingRequest,
  usableInternalToken,
} from "./access"

const internalPro: InternalProDeps = {
  readDb: null,
  readPrices: async () => null,
  cache: null,
  heads: null,
  network: "mezo",
}

const prices = "/internal/pro/prices"
const publicOrigin = "https://api.matchbox.markets"
const workersDev = "https://matchbox-api-v2-preview.mallard.workers.dev"
const browserOrigin = "https://evil.example"

function harness(internalToken: string | null = null) {
  return createHarness({ internalToken, internalPro })
}

type App = Awaited<ReturnType<typeof harness>>["app"]

function get(app: App, url: string, headers: Record<string, string> = {}) {
  return app.request(url, { headers: { Origin: browserOrigin, ...headers } })
}

function expectNoCors(response: Response) {
  for (const name of [
    "Access-Control-Allow-Origin",
    "Access-Control-Allow-Methods",
    "Access-Control-Allow-Headers",
    "Access-Control-Expose-Headers",
  ]) {
    expect(response.headers.get(name)).toBeNull()
  }
}

async function expectDenied(response: Response) {
  expect(response.status).toBe(404)
  expectNoCors(response)
  expect(response.headers.get("Cache-Control")).toBe("no-store")
  const body = errorBodySchema.parse(await response.json())
  expect(body.error.code).toBe("not_found")
}

describe("binding hostnames", () => {
  it("accepts exactly the hostnames Pro, Scan and Stuart build", () => {
    expect(isBindingHostname("api.internal")).toBe(true)
    expect(isBindingHostname("API.Internal")).toBe(true)
    expect(isBindingHostname("matchbox-developer-api")).toBe(true)
  })

  it("rejects every other unroutable name", () => {
    for (const host of [
      "scan.api.internal",
      "evil.internal",
      "internal",
      "api",
      "matchbox-api",
      "matchbox-developer-api.internal",
    ]) {
      expect(isBindingHostname(host), host).toBe(false)
    }
  })

  it("rejects routable names, localhost and IPs", () => {
    expect(isBindingHostname("api.matchbox.markets")).toBe(false)
    expect(
      isBindingHostname("matchbox-api-v2-preview.mallard.workers.dev"),
    ).toBe(false)
    expect(isBindingHostname("api.internal.example.com")).toBe(false)
    expect(isBindingHostname("localhost")).toBe(false)
    expect(isBindingHostname("127.0.0.1")).toBe(false)
    expect(isBindingHostname("[::1]")).toBe(false)
  })

  it("gates encoded internal paths", () => {
    expect(isInternalPath("/internal")).toBe(true)
    expect(isInternalPath("/internal/pro/head")).toBe(true)
    expect(isInternalPath("/%69nternal/pro/head")).toBe(true)
    expect(isInternalPath("/internals")).toBe(false)
    expect(isInternalPath("/v1/health")).toBe(false)
  })
})

describe("internalCaller", () => {
  it("treats the named entrypoint as a binding on any hostname", async () => {
    const request = new Request(`${publicOrigin}${prices}`)
    expect(await internalCaller(request, null)).toBe("denied")
    markBindingRequest(request)
    expect(await internalCaller(request, null)).toBe("binding")
  })

  it("refuses short tokens and production", () => {
    const long = "x".repeat(32)
    expect(usableInternalToken(long, "preview")).toBe(long)
    expect(usableInternalToken(long, "development")).toBe(long)
    expect(usableInternalToken(long, "production")).toBeNull()
    expect(usableInternalToken("x".repeat(31), "preview")).toBeNull()
    expect(usableInternalToken(null, "preview")).toBeNull()
  })

  it("denies a short secret even when the bearer matches", async () => {
    const short = "short-secret"
    const request = new Request(`${publicOrigin}${prices}`, {
      headers: { Authorization: `Bearer ${short}` },
    })
    expect(await internalCaller(request, short)).toBe("denied")
  })

  it("denies an unlisted binding-looking hostname", async () => {
    const request = new Request(`https://evil.internal${prices}`)
    expect(await internalCaller(request, null)).toBe("denied")
  })

  it("compares the token exactly", async () => {
    function withToken(token: string): Request {
      return new Request(`${publicOrigin}${prices}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    }
    expect(
      await internalCaller(
        withToken("s3cret-0123456789-abcdefghijklmnopq"),
        "s3cret-0123456789-abcdefghijklmnopq",
      ),
    ).toBe("token")
    expect(
      await internalCaller(
        withToken("s3cre"),
        "s3cret-0123456789-abcdefghijklmnopq",
      ),
    ).toBe("denied")
    expect(
      await internalCaller(
        withToken("s3cret-0123456789-abcdefghijklmnopq0"),
        "s3cret-0123456789-abcdefghijklmnopq",
      ),
    ).toBe("denied")
    expect(await internalCaller(withToken(""), "")).toBe("denied")
  })
})

describe("/internal/* lock-down", () => {
  it("serves a service binding call", async () => {
    const { app } = await harness()
    const response = await get(app, `https://api.internal${prices}`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { btc: null, mezo: null } })
    const stuart = await get(app, `https://matchbox-developer-api${prices}`)
    expect(stuart.status).toBe(200)
  })

  it("denies a public call on the custom domain and workers.dev", async () => {
    const { app } = await harness("s3cret-0123456789-abcdefghijklmnopq")
    await expectDenied(await get(app, `${publicOrigin}${prices}`))
    await expectDenied(await get(app, `${workersDev}${prices}`))
    await expectDenied(await get(app, `${publicOrigin}/%69nternal/pro/prices`))
    await expectDenied(await get(app, `http://localhost${prices}`))
  })

  it("denies an unknown internal path like a known one", async () => {
    const { app } = await harness()
    await expectDenied(await get(app, `${publicOrigin}/internal/nope`))
  })

  it("accepts the development token when the secret is set", async () => {
    const { app } = await harness("s3cret-0123456789-abcdefghijklmnopq")
    const response = await get(app, `${publicOrigin}${prices}`, {
      Authorization: "Bearer s3cret-0123456789-abcdefghijklmnopq",
    })
    expect(response.status).toBe(200)
  })

  it("denies a wrong token", async () => {
    const { app } = await harness("s3cret-0123456789-abcdefghijklmnopq")
    await expectDenied(
      await get(app, `${publicOrigin}${prices}`, {
        Authorization: "Bearer s3cret-0123456789-abcdefghijklmnopq-not",
      }),
    )
    await expectDenied(
      await get(app, `${publicOrigin}${prices}`, {
        Authorization: "s3cret-0123456789-abcdefghijklmnopq",
      }),
    )
  })

  it("denies every token when the secret is unset", async () => {
    const { app } = await harness(null)
    await expectDenied(
      await get(app, `${publicOrigin}${prices}`, {
        Authorization: "Bearer s3cret-0123456789-abcdefghijklmnopq",
      }),
    )
    await expectDenied(
      await get(app, `${publicOrigin}${prices}`, { Authorization: "Bearer " }),
    )
  })

  it("answers a public preflight with a bare 404", async () => {
    const { app } = await harness()
    const response = await app.request(`${publicOrigin}${prices}`, {
      method: "OPTIONS",
      headers: {
        Origin: browserOrigin,
        "Access-Control-Request-Method": "GET",
      },
    })
    await expectDenied(response)
  })

  it("denies a public WebSocket upgrade of /internal/heads", async () => {
    const { app } = await harness()
    await expectDenied(
      await get(app, `${publicOrigin}/internal/heads`, {
        Upgrade: "websocket",
      }),
    )
  })

  it("leaves the public API and its CORS unchanged", async () => {
    const { app } = await harness()
    const health = await get(app, `${publicOrigin}/v1/health`)
    expect(health.status).toBe(200)
    expect(health.headers.get("Access-Control-Allow-Origin")).toBe("*")
    const unauthenticated = await get(app, `${publicOrigin}/v1/networks`, {
      "CF-Connecting-IP": "198.51.100.7",
    })
    expect(unauthenticated.status).toBe(401)
  })
})
