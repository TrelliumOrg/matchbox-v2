import { describe, expect, it, vi } from "vitest"
import { cspReport, parseCspReport } from "./csp-report.server"

const legacy = {
  "csp-report": {
    "document-uri": "https://pro.matchbox.markets/vote?address=0xabc#x",
    "effective-directive": "connect-src",
    "blocked-uri": "wss://relay.wallet.example",
    "source-file": "https://pro.matchbox.markets/assets/wc.js",
    disposition: "report",
  },
}

function post(body: string): Request {
  return new Request("https://pro.matchbox.markets/csp-report", {
    method: "POST",
    headers: { "content-type": "application/csp-report" },
    body,
  })
}

describe("CSP reports", () => {
  it("reads a report, keeping the page without its query", () => {
    expect(parseCspReport(legacy)).toEqual([
      {
        directive: "connect-src",
        blocked: "wss://relay.wallet.example",
        page: "https://pro.matchbox.markets/vote",
        source: "https://pro.matchbox.markets/assets/wc.js",
        disposition: "report",
      },
    ])
  })

  it("finds nothing in what is not a report", () => {
    expect(parseCspReport({ hello: "world" })).toEqual([])
    expect(parseCspReport([{ type: "csp-violation", body: {} }])).toEqual([])
    expect(parseCspReport("text")).toEqual([])
  })

  it("logs each violation only while reporting", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined)
    const quiet = await cspReport(post(JSON.stringify(legacy)), false)
    expect(quiet.status).toBe(204)
    const calls = warn.mock.calls.length + log.mock.calls.length
    expect(calls).toBe(0)
    const logged = await cspReport(post(JSON.stringify(legacy)), true)
    expect(logged.status).toBe(204)
    expect(warn.mock.calls.length + log.mock.calls.length).toBeGreaterThan(0)
    warn.mockRestore()
    log.mockRestore()
  })

  it("refuses other methods, junk and oversized bodies", async () => {
    const get = await cspReport(
      new Request("https://pro.matchbox.markets/csp-report"),
      true,
    )
    expect(get.status).toBe(405)
    expect((await cspReport(post("{not json"), true)).status).toBe(400)
    expect((await cspReport(post("x".repeat(20_000)), true)).status).toBe(413)
  })
})
