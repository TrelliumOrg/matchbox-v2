// @vitest-environment node
import { describe, expect, it, vi } from "vitest"
import {
  coinUri,
  dataUriBytes,
  fetchPicture,
  lockupImage,
  type PictureFetch,
} from "./assets"
import { renderPng } from "./render"
import { cachedImage, createMemo, fallbackImage, png, within } from "./server"

function pngSize(bytes: Uint8Array): { width: number; height: number } {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  expect([...bytes.subarray(0, 8)]).toEqual(signature)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

function memoryCache() {
  const store = new Map<string, Response>()
  return {
    keys: [] as string[],
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

describe("render", () => {
  it("draws an element with the bundled fonts as a 1200x630 PNG", async () => {
    const lockup = lockupImage("scan")
    const bytes = await renderPng(
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: "100%",
          background: "#121212",
          color: "#f4f4f2",
          fontFamily: "Figtree",
        }}
      >
        <img
          src={lockup.uri}
          width={lockup.width}
          height={lockup.height}
          alt="Matchscan"
        />
        <span style={{ fontSize: 64, fontWeight: 600 }}>Block 13,078,795</span>
        <span style={{ fontFamily: "DM Mono" }}>0x7f3a…91c2</span>
      </div>,
    )
    expect(pngSize(bytes)).toEqual({ width: 1200, height: 630 })
  }, 20_000)

  it("draws each product's lockup and the official coins", () => {
    expect(lockupImage("scan").uri).toMatch(/^data:image\/svg\+xml;base64,/)
    expect(lockupImage("scan").width).toBeGreaterThan(0)
    expect(lockupImage("pro").width).not.toBe(lockupImage("scan").width)
    expect(coinUri("mUSDC")).toMatch(/^data:image\/svg\+xml/)
    expect(coinUri("UNKNOWN")).toBeNull()
  })
})

describe("fetchPicture", () => {
  it("gives up on slow pictures", async () => {
    const slow: PictureFetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(init.signal.reason))
      })
    // `slow` only settles when its signal aborts. The deadline's signal is
    // ours to fire, so the test shows the 50 ms deadline is the thing that
    // ends the fetch without reading the machine's clock.
    const deadline = new AbortController()
    const timeout = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(deadline.signal)
    try {
      let settled = false
      const picture = fetchPicture(
        "https://pictures.example/a.png",
        slow,
        50,
      ).finally(() => {
        settled = true
      })
      await new Promise((resolve) => setImmediate(resolve))
      expect(settled).toBe(false)
      expect(timeout).toHaveBeenCalledWith(50)
      deadline.abort(new DOMException("deadline", "TimeoutError"))
      expect(await picture).toBeNull()
    } finally {
      timeout.mockRestore()
    }
  })

  it("only fetches https pictures", async () => {
    const fetcher = vi.fn<PictureFetch>()
    expect(
      await fetchPicture("http://pictures.example/a.png", fetcher),
    ).toBeNull()
    expect(fetcher).not.toHaveBeenCalled()
  })
})

describe("image cache", () => {
  const tiny = png(new Uint8Array([1, 2, 3]), 3600)
  const fallbackUri = `data:image/png;base64,${btoa("fallback")}`

  function deps() {
    return {
      cache: memoryCache(),
      waitUntil: vi.fn(),
      log: vi.fn(),
    }
  }

  it("renders once and serves the cached image after", async () => {
    const used = deps()
    const produce = vi.fn(async () => tiny.clone())
    const request = new Request("https://scan.test/og/default.png")
    const key = new Request("https://scan.test/og/default.png?hour=1")
    const first = await cachedImage(request, key, produce, () => tiny, used)
    await used.waitUntil.mock.calls[0]?.[0]
    const second = await cachedImage(request, key, produce, () => tiny, used)
    expect(first.status).toBe(200)
    expect(second.headers.get("content-type")).toBe("image/png")
    expect(produce).toHaveBeenCalledOnce()
    expect(used.cache.keys).toEqual([key.url])
  })

  it("serves the fallback for a short while when rendering fails", async () => {
    const used = deps()
    const response = await cachedImage(
      new Request("https://scan.test/og/tx/0x1.png"),
      new Request("https://scan.test/og/tx/0x1.png?hour=1"),
      async () => {
        throw new Error("wasm")
      },
      () => fallbackImage(fallbackUri),
      used,
    )
    expect(response.headers.get("cache-control")).toBe("public, max-age=300")
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array(dataUriBytes(fallbackUri)),
    )
    expect(used.log).toHaveBeenCalledOnce()
  })

  it("answers HEAD without a body and refuses other methods", async () => {
    const used = deps()
    const key = new Request("https://scan.test/og/default.png?hour=2")
    const head = await cachedImage(
      new Request("https://scan.test/og/default.png", { method: "HEAD" }),
      key,
      async () => tiny.clone(),
      () => tiny,
      used,
    )
    expect(head.body).toBeNull()
    const post = await cachedImage(
      new Request("https://scan.test/og/default.png", { method: "POST" }),
      key,
      async () => tiny.clone(),
      () => tiny,
      used,
    )
    expect(post.status).toBe(405)
  })
})

describe("memo", () => {
  it("shares a value until it expires and retries failures", async () => {
    const memo = createMemo<string>({ ttlMs: 60_000, size: 10 })
    const load = vi.fn(async () => "card")
    expect(await memo("a", load)).toBe("card")
    expect(await memo("a", load)).toBe("card")
    expect(load).toHaveBeenCalledOnce()
    const failing = vi.fn(async (): Promise<string> => {
      throw new Error("API down")
    })
    expect(await memo("b", failing)).toBeNull()
    await Promise.resolve()
    expect(await memo("b", failing)).toBeNull()
    expect(failing).toHaveBeenCalledTimes(2)
  })

  it("gives up waiting after the timeout", async () => {
    const never = new Promise<string>(() => {})
    expect(await within(never, 10, "late")).toBe("late")
  })
})
