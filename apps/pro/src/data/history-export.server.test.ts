// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Download CSV through the API binding: a file when it works, and a 303
 * back to the page with a reason when it does not, so the browser never
 * saves an error as the CSV.
 */

const state = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
  reply: (): Response => new Response("date_utc\r\n", { status: 200 }),
  methods: [] as string[],
}))

vi.mock("cloudflare:workers", () => ({ env: state.env }))
vi.mock("@matchbox/logger", () => ({
  createLogger: () => ({ error: () => {}, warn: () => {}, info: () => {} }),
}))

const { exportResponse, matchExport } = await import("./history-export.server")

const wallet = `0x5050${"0".repeat(32)}0050`
const origin = "https://pro.example"

beforeEach(() => {
  for (const key of Object.keys(state.env)) delete state.env[key]
  state.env.PRO_DATA = "api"
  state.methods.length = 0
  state.env.API = {
    fetch: async (request: Request) => {
      state.methods.push(request.method)
      return state.reply()
    },
  }
  state.reply = () =>
    new Response("date_utc\r\n", {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="a.csv"',
      },
    })
})

async function download(
  kind: "activity" | "rewards",
  referer?: string,
): Promise<Response> {
  const wanted = matchExport(`/${wallet}/${kind}.csv`)
  if (wanted === null) throw new Error("not an export path")
  return exportResponse(
    new Request(`${origin}/${wallet}/${kind}.csv`, {
      headers: referer === undefined ? {} : { referer },
    }),
    wanted,
  )
}

describe("history export", () => {
  it("streams the file as an attachment", async () => {
    const response = await download("rewards")
    expect(response.status).toBe(200)
    expect(response.headers.get("content-disposition")).toMatch(/^attachment/)
    expect(await response.text()).toBe("date_utc\r\n")
  })

  it("asks the API with a HEAD for a HEAD", async () => {
    const wanted = matchExport(`/${wallet}/rewards.csv`)
    if (wanted === null) throw new Error("not an export path")
    await exportResponse(
      new Request(`${origin}/${wallet}/rewards.csv`, { method: "HEAD" }),
      wanted,
    )
    await download("rewards")
    expect(state.methods).toEqual(["HEAD", "GET"])
  })

  it("sends a refusal back to the page it came from, with its reason", async () => {
    state.reply = () =>
      new Response(null, { status: 429, headers: { "retry-after": "30" } })
    const busy = await download(
      "rewards",
      `${origin}/name.mezo/rewards?tab=x&download=old`,
    )
    expect(busy.status).toBe(303)
    expect(busy.headers.get("location")).toBe(
      "/name.mezo/rewards?tab=x&download=busy",
    )
    expect(busy.headers.get("cache-control")).toBe("no-store")
    expect(await busy.text()).toBe("")

    state.reply = () => new Response(null, { status: 404 })
    expect(
      (
        await download("activity", `${origin}/activity?filter=claims`)
      ).headers.get("location"),
    ).toBe("/activity?filter=claims&download=none")

    state.reply = () => new Response("boom", { status: 500 })
    expect((await download("activity")).headers.get("location")).toBe(
      `/${wallet}/activity?download=failed`,
    )
    state.reply = () => {
      throw new Error("binding down")
    }
    expect((await download("rewards")).headers.get("location")).toBe(
      `/${wallet}/rewards?download=failed`,
    )
  })

  it("says when the day's downloads are used, from Retry-After", async () => {
    const refusedWith = async (retryAfter: string | null) => {
      state.reply = () =>
        new Response(null, {
          status: 429,
          headers: retryAfter === null ? {} : { "retry-after": retryAfter },
        })
      return (await download("rewards")).headers.get("location")
    }
    expect(await refusedWith("60")).toBe(`/${wallet}/rewards?download=busy`)
    expect(await refusedWith(null)).toBe(`/${wallet}/rewards?download=busy`)
    expect(await refusedWith("soon")).toBe(`/${wallet}/rewards?download=busy`)
    expect(await refusedWith("61")).toBe(`/${wallet}/rewards?download=busy-day`)
    expect(await refusedWith("40000")).toBe(
      `/${wallet}/rewards?download=busy-day`,
    )
    const inTwoHours = new Date(Date.now() + 7_200_000).toUTCString()
    expect(await refusedWith(inTwoHours)).toBe(
      `/${wallet}/rewards?download=busy-day`,
    )
  })

  it("never sends anyone to another site or page", async () => {
    state.reply = () => new Response(null, { status: 429 })
    for (const referer of [
      "https://evil.example/0xabc/rewards",
      `${origin}//evil.example/rewards`,
      `${origin}/settings`,
      `${origin}/a/b/rewards`,
      "not a url",
      "javascript:alert(1)",
    ]) {
      const location = (await download("rewards", referer)).headers.get(
        "location",
      )
      expect(location).toBe(`/${wallet}/rewards?download=busy`)
    }
  })
})
