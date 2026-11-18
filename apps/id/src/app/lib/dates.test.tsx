import { afterEach, describe, expect, it, vi } from "vitest"

/**
 * Pages render on the server (the Worker runs in UTC) and hydrate in the
 * visitor's zone. At 00:15 UTC it is still the day before in New York: a
 * date or time formatted locally during hydration would not match the
 * server's HTML (React error 418, then a client re-render).
 */

const lastSeen = "2026-11-11T00:15:00.000Z"
const zone = process.env.TZ

afterEach(() => {
  if (zone === undefined) delete process.env.TZ
  else process.env.TZ = zone
  vi.useRealTimers()
  vi.resetModules()
})

/** A fresh module graph (React included) in one time zone. */
async function load(timeZone: string) {
  process.env.TZ = timeZone
  vi.resetModules()
  const [react, server, client, dates] = await Promise.all([
    import("react"),
    import("react-dom/server"),
    import("react-dom/client"),
    import("./dates"),
  ])
  const page = react.createElement(
    "p",
    null,
    react.createElement(dates.SeenAt, { iso: lastSeen }),
    " ",
    react.createElement(dates.ShortDate, { iso: lastSeen }),
  )
  return { react, server, client, page }
}

describe("dates on server-rendered pages", () => {
  it("hydrate without a mismatch, then show the visitor's local time", async () => {
    vi.useFakeTimers({
      now: new Date("2026-11-11T00:20:00.000Z"),
      toFake: ["Date"],
    })
    const worker = await load("UTC")
    const html = worker.server.renderToString(worker.page)
    expect(html).toContain("Today, 00:15")
    expect(html).toContain("11 Nov")

    const browser = await load("America/New_York")
    const container = document.createElement("div")
    container.innerHTML = html
    document.body.appendChild(container)
    const recoverable = vi.fn()
    await browser.react.act(async () => {
      browser.client.hydrateRoot(container, browser.page, {
        onRecoverableError: recoverable,
      })
    })
    expect(recoverable).not.toHaveBeenCalled()
    expect(container.textContent).toContain("Today, 19:15")
    expect(container.textContent).toContain("10 Nov")
    container.remove()
  })
})
