// @vitest-environment node
import { gaugeProfileResponseSchema } from "@matchbox/contracts/read-models"
import { describe, expect, it, vi } from "vitest"
import { fixtureEpochReference, fixtureResponse } from "../data/fixture-api"
import { dataUriBytes, fetchPicture, type PictureFetch } from "./assets"
import { clockEpoch, type Reader, type Sources } from "./data"
import fallbackPng from "./fallback.png?inline"
import { renderPng } from "./render"
import { type ImageDeps, ogImage, ogTarget, type Render } from "./routes"

/** The demo epoch's gauges: Kiln Labs has the profile fixture. */
const kiln = "0x4da4c05483324ea9cfc951510a5e77cc79541159"
const nowSeconds = Math.floor(Date.now() / 1000)

const fixtures: Reader = async (path, schema) => {
  const found = fixtureResponse(path, Date.now())
  return found.status === 404 ? null : schema.parse(found.body)
}

/** Fixtures, with Kiln Labs' picture an uploaded image. */
const withImage: Reader = async (path, schema) => {
  const found = fixtureResponse(path, Date.now())
  if (found.status === 404) return null
  if (!path.startsWith("/internal/pro/gauges/")) return schema.parse(found.body)
  const body = gaugeProfileResponseSchema.parse(found.body)
  body.data.card.gauge.picture = {
    type: "image",
    url: "https://pictures.example/kiln.png",
  }
  return schema.parse(body)
}

const failing: Reader = async () => {
  throw new Error("API down")
}

const tinyPng = new Uint8Array(dataUriBytes(fallbackPng))

function pngSize(bytes: Uint8Array): { width: number; height: number } {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  expect([...bytes.subarray(0, 8)]).toEqual(signature)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

function memoryCache(): ImageDeps["cache"] & { keys: string[] } {
  const store = new Map<string, Response>()
  return {
    keys: [],
    async match(request: RequestInfo | URL) {
      const key = request instanceof Request ? request.url : String(request)
      return store.get(key)?.clone()
    },
    async put(request: RequestInfo | URL, response: Response) {
      const key = request instanceof Request ? request.url : String(request)
      this.keys.push(key)
      store.set(key, response)
    },
  }
}

function deps(overrides: Partial<ImageDeps> & { read?: Reader } = {}) {
  const pending: Promise<unknown>[] = []
  const sources: Sources = {
    read: overrides.read ?? fixtures,
    reference: fixtureEpochReference,
    nowSeconds,
  }
  const log = vi.fn()
  const value: ImageDeps = {
    sources,
    render: renderPng,
    fetch: async () => new Response(null, { status: 404 }),
    cache: null,
    waitUntil: (promise) => {
      pending.push(promise)
    },
    log,
    ...overrides,
  }
  return { deps: value, pending, log }
}

async function image(
  path: string,
  options: Partial<ImageDeps> & { read?: Reader } = {},
) {
  const { deps: value, pending, log } = deps(options)
  const response = await ogImage(
    new Request(`https://pro.matchbox.markets${path}`),
    value,
  )
  await Promise.all(pending)
  return { response, log }
}

async function expectCard(response: Response, maxAge: number) {
  expect(response.status).toBe(200)
  expect(response.headers.get("content-type")).toBe("image/png")
  expect(response.headers.get("cache-control")).toBe(
    `public, max-age=${maxAge}`,
  )
  const bytes = new Uint8Array(await response.arrayBuffer())
  expect(pngSize(bytes)).toEqual({ width: 1200, height: 630 })
  return bytes
}

describe("ogTarget", () => {
  it("parses the three image paths", () => {
    expect(ogTarget("/og/default.png")).toEqual({ kind: "default" })
    expect(
      ogTarget(`/og/gauge/${kiln.toUpperCase().replace("0X", "0x")}.png`),
    ).toEqual({ kind: "gauge", address: kiln })
    expect(ogTarget("/og/protocol/47.png")).toEqual({
      kind: "protocol",
      epoch: 47,
    })
    expect(ogTarget("/og/protocol/latest.png")).toEqual({
      kind: "protocol",
      epoch: null,
    })
    for (const path of [
      "/og/gauge/0x12.png",
      "/og/protocol/x.png",
      "/og/a.png",
    ]) {
      expect(ogTarget(path)).toBeNull()
    }
  })
})

describe("ogImage", () => {
  it.each([
    "/og/default.png",
    `/og/gauge/${kiln}.png`,
    "/og/protocol/47.png",
    "/og/protocol/40.png",
    "/og/protocol/latest.png",
  ])(
    "renders %s as a 1200x630 PNG for an hour",
    async (path) => {
      const { response } = await image(path)
      await expectCard(response, 3600)
    },
    20_000,
  )

  it("inlines the gauge's picture", async () => {
    const fetcher = vi.fn<PictureFetch>(
      async () =>
        new Response(tinyPng, { headers: { "content-type": "image/png" } }),
    )
    const render = vi.fn<Render>(renderPng)
    const { response } = await image(`/og/gauge/${kiln}.png`, {
      read: withImage,
      fetch: fetcher,
      render,
    })
    await expectCard(response, 3600)
    expect(fetcher).toHaveBeenCalledWith(
      "https://pictures.example/kiln.png",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(render.mock.calls[0]?.[1].picture).toMatch(
      /^data:image\/png;base64,/,
    )
  }, 20_000)

  it("falls back to initials when the picture fails", async () => {
    for (const fetcher of [
      async () => {
        throw new Error("network")
      },
      async () =>
        new Response("<html>", { headers: { "content-type": "text/html" } }),
      async () =>
        new Response(tinyPng, { headers: { "content-type": "image/webp" } }),
    ] satisfies PictureFetch[]) {
      const render = vi.fn<Render>(renderPng)
      const { response } = await image(`/og/gauge/${kiln}.png`, {
        read: withImage,
        fetch: fetcher,
        render,
      })
      await expectCard(response, 3600)
      expect(render.mock.calls[0]?.[1].picture).toBeNull()
    }
  }, 30_000)

  it("serves the default card for a short while when the API fails", async () => {
    for (const path of [
      "/og/default.png",
      `/og/gauge/${kiln}.png`,
      "/og/protocol/47.png",
    ]) {
      const { response } = await image(path, { read: failing })
      await expectCard(response, 300)
    }
  }, 20_000)

  it("serves the bundled card when rendering fails", async () => {
    const { response, log } = await image("/og/default.png", {
      render: async () => {
        throw new Error("wasm trap")
      },
    })
    const bytes = await expectCard(response, 300)
    expect(bytes).toEqual(tinyPng)
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "og render failed",
        error: "wasm trap",
      }),
    )
  })

  it("sends unknown gauges and epochs to one cached image", async () => {
    const unknown = await image(
      "/og/gauge/0x0000000000000000000000000000000000000001.png",
    )
    expect(unknown.response.status).toBe(302)
    expect(unknown.response.headers.get("location")).toBe("/og/default.png")
    const epoch = await image("/og/protocol/9999.png")
    expect(epoch.response.headers.get("location")).toBe(
      "/og/protocol/latest.png",
    )
  })

  it("caches by path, hour and epoch, and answers from the cache", async () => {
    const cache = memoryCache()
    const render = vi.fn<Render>(renderPng)
    const first = await image("/og/protocol/47.png?v=1", { cache, render })
    const second = await image("/og/protocol/47.png?v=2", { cache, render })
    expect(render).toHaveBeenCalledTimes(1)
    // The key's epoch is the clock's, not the page's: it moves on each
    // Thursday, so the test reads it the way the route does.
    const epoch = clockEpoch({
      reference: fixtureEpochReference,
      nowSeconds,
    })
    expect(cache.keys).toEqual([
      `https://pro.matchbox.markets/og/protocol/47.png?hour=${Math.floor(nowSeconds / 3600)}&epoch=${epoch}`,
    ])
    expect(await second.response.arrayBuffer()).toEqual(
      await first.response.arrayBuffer(),
    )
  }, 20_000)

  it("answers HEAD without a body and 404s other paths", async () => {
    const { deps: value } = deps({ render: async () => tinyPng })
    const head = await ogImage(
      new Request("https://pro.matchbox.markets/og/default.png", {
        method: "HEAD",
      }),
      value,
    )
    expect(head.status).toBe(200)
    expect(head.body).toBeNull()
    const missing = await ogImage(
      new Request("https://pro.matchbox.markets/og/other.png"),
      value,
    )
    expect(missing.status).toBe(404)
  })
})

describe("fetchPicture", () => {
  it("gives up on slow pictures", async () => {
    // The picture never answers, so only fetchPicture's own limit can end
    // the wait. No wall-clock bound: a loaded runner makes 50 ms take
    // longer, and the test's own timeout catches a wait that never ends.
    let reason: unknown
    const slow: PictureFetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          reason = init.signal.reason
          reject(init.signal.reason)
        })
      })
    expect(
      await fetchPicture("https://pictures.example/a.png", slow, 50),
    ).toBeNull()
    expect(reason).toMatchObject({ name: "TimeoutError" })
  })

  it("only fetches https pictures", async () => {
    const fetcher = vi.fn<PictureFetch>()
    expect(
      await fetchPicture("http://pictures.example/a.png", fetcher),
    ).toBeNull()
    expect(fetcher).not.toHaveBeenCalled()
  })
})
