import {
  baseSecurityHeaders,
  contentSecurityPolicy,
  walletConnectFrames,
  walletConnectSources,
} from "@matchbox/app-kit/security"
import { describe, expect, it } from "vitest"
import headersFile from "../public/_headers?raw"
import { proCspOptions } from "./security.server"

const live = {
  url: new URL("https://pro.matchbox.markets/vote"),
  rpcUrl: "https://mainnet.mezo.public.validationcloud.io",
  stuartUrl: "https://matchbox-stuart-preview.mallard.workers.dev",
  feedbackUrl: undefined,
  reportOnly: false,
}

function directive(csp: string, name: string): string {
  return csp.split("; ").find((part) => part.startsWith(`${name} `)) ?? ""
}

describe("Pro's content security policy", () => {
  const csp = contentSecurityPolicy("n0nce", proCspOptions(live))

  it("runs only nonced scripts and what they load", () => {
    expect(directive(csp, "script-src")).toBe(
      "script-src 'nonce-n0nce' 'strict-dynamic'",
    )
    expect(csp).not.toContain("unsafe-eval")
    expect(directive(csp, "script-src")).not.toContain("unsafe-inline")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("base-uri 'none'")
  })

  it("may be framed by Safe{Wallet} and nothing else", () => {
    expect(directive(csp, "frame-ancestors")).toBe(
      "frame-ancestors 'self' https://safe.mezo.org",
    )
  })

  it("reaches the RPC, the head socket, WalletConnect, Safe and Stuart", () => {
    const connect = directive(csp, "connect-src")
    for (const source of [
      "'self'",
      "https://mainnet.mezo.public.validationcloud.io",
      "wss://pro.matchbox.markets",
      ...walletConnectSources,
      "https://safe-transaction-mezo.safe.onchainden.com",
      "https://matchbox-stuart-preview.mallard.workers.dev",
      // A custom RPC from the Network setting.
      "https:",
      "http://localhost:*",
      "http://*.localhost:*",
    ]) {
      expect(connect.split(" ")).toContain(source)
    }
    expect(connect.split(" ")).not.toContain("http:")
    expect(directive(csp, "frame-src")).toBe(
      `frame-src 'self' ${walletConnectFrames.join(" ")}`,
    )
    expect(directive(csp, "img-src")).toBe("img-src 'self' data: https: blob:")
    expect(directive(csp, "font-src")).toBe(
      "font-src 'self' https://fonts.reown.com",
    )
  })

  it("uses ws: for the head socket on a local http preview", () => {
    const local = contentSecurityPolicy(
      "n",
      proCspOptions({
        ...live,
        url: new URL("http://localhost:4173/"),
        rpcUrl: "http://127.0.0.1:8545",
        stuartUrl: "",
      }),
    )
    const connect = directive(local, "connect-src").split(" ")
    expect(connect).toContain("ws://localhost:4173")
    expect(connect).toContain("http://127.0.0.1:8545")
    expect(connect.some((source) => source.includes("stuart"))).toBe(false)
  })

  it("adds the feedback Worker and Turnstile only when built with them", () => {
    const options = proCspOptions({
      ...live,
      feedbackUrl: "https://feedback.matchbox.markets",
    })
    expect(options.connect).toContain("https://feedback.matchbox.markets")
    expect(options.frames).toContain("https://challenges.cloudflare.com")
    expect(proCspOptions(live).frames).not.toContain(
      "https://challenges.cloudflare.com",
    )
  })

  it("passes the report-only switch through, with somewhere to report", () => {
    const reporting = proCspOptions({ ...live, reportOnly: true })
    expect(reporting.reportOnly).toBe(true)
    expect(reporting.reportPath).toBe("/csp-report")
    expect(proCspOptions(live).reportOnly).toBe(false)
    expect(proCspOptions(live).reportPath).toBeUndefined()
  })
})

/** The `/*` block of public/_headers, header name (lower case) to value. */
function staticHeaders(): Map<string, string> {
  const headers = new Map<string, string>()
  let inBlock = false
  for (const line of headersFile.split(/\r?\n/)) {
    if (line.startsWith("#") || line.trim() === "") continue
    if (!line.startsWith(" ")) {
      inBlock = line.trim() === "/*"
      continue
    }
    if (!inBlock) continue
    const at = line.indexOf(":")
    headers.set(
      line.slice(0, at).trim().toLowerCase(),
      line.slice(at + 1).trim(),
    )
  }
  return headers
}

describe("static file headers", () => {
  it("are the Worker's, CSP and COOP aside", () => {
    const headers = staticHeaders()
    for (const [name, value] of Object.entries(baseSecurityHeaders)) {
      if (name === "cross-origin-opener-policy") continue
      expect(headers.get(name), name).toBe(value)
    }
    // As on Matchscan: pages get the CSP from the Worker, files none, and
    // nothing sends X-Frame-Options, which would keep Pro out of Safe.
    expect(headers.has("content-security-policy")).toBe(false)
    expect(headers.has("x-frame-options")).toBe(false)
  })
})
