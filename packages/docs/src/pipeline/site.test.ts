import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { errorCodeSchema } from "@matchbox/contracts/errors"
import { beforeAll, describe, expect, it } from "vitest"
import {
  errorAnchorUrls,
  legacyUrls,
  matchRedirect,
  redirectMarker,
  redirects,
  resolveUrl,
} from "../redirects"
import { type BuildOutput, buildSite } from "./build-site"
import { loadContent } from "./content"
import { generatedFiles } from "./emit"
import { generateMcpTools, readMcpTools, toolsListOf } from "./mcp-tools"
import {
  generateReference,
  type ReferenceOutput,
  referencePage,
  samplesModule,
  statusText,
} from "./reference"
import { contractTables } from "./tables"

/**
 * The whole site, built from the real content as CI builds it: no
 * problems, generated files up to date, the reference complete, every old
 * URL resolving and Stuart's knowledge following Stuart's own rules.
 */

const root = fileURLToPath(new URL("../..", import.meta.url))

let output: BuildOutput
let reference: ReferenceOutput

beforeAll(async () => {
  reference = await generateReference()
  const mcp = await generateMcpTools(readMcpTools())
  output = await buildSite({
    content: loadContent(`${root}/content`),
    generated: [referencePage(reference), ...reference.pages, ...mcp.pages],
    generatedTrees: [reference.tree, mcp.tree],
    tables: contractTables,
    apiVersion: reference.version,
    files: ["/developer/openapi.json", "/llms.txt", "/sitemap.xml"],
    generatedTreeOf: () => null,
  })
}, 120_000)

describe("the site", () => {
  it("builds with no copy, link, anchor or tree problems", () => {
    expect(output.problems).toEqual([])
  })

  it("keeps stubs out of every tree and the search index", () => {
    const stubs = new Set(output.stubs.map((stub) => stub.path))
    for (const tree of Object.values(output.manifest.trees)) {
      for (const group of tree.groups) {
        expect(group.pages.length).toBeGreaterThan(0)
        for (const page of group.pages) expect(stubs.has(page.path)).toBe(false)
      }
    }
    for (const entry of output.search.entries) {
      expect(stubs.has(entry.u.split("#")[0] ?? "")).toBe(false)
    }
  })

  it("publishes Matchscan's Validators and Metrics pages in its tree", () => {
    const paths = (output.manifest.trees.scan?.groups ?? []).flatMap((group) =>
      group.pages.map((page) => page.path),
    )
    expect(paths).toContain("/scan/validators")
    expect(paths).toContain("/scan/metrics")
    const stubs = output.stubs.map((stub) => stub.path)
    expect(stubs).not.toContain("/scan/validators")
    expect(stubs).not.toContain("/scan/metrics")
  })

  it("has unique anchors and heading ids on every page", () => {
    for (const page of output.pages.values()) {
      const ids = page.toc.map((item) => item.id)
      expect(new Set(ids).size, page.path).toBe(ids.length)
    }
  })

  it("publishes every docs page the SDK README links to", () => {
    // The README ships to npm, so it cannot import the typed docsUrl: this
    // holds it to the same rule instead.
    const readme = readFileSync(`${root}/../sdk/README.md`, "utf8")
    const links = [
      ...readme.matchAll(/https:\/\/docs\.matchbox\.markets(\/[^\s)#]*)/g),
    ].map((match) => match[1] ?? "")
    expect(links.length).toBeGreaterThan(0)
    for (const path of links) expect(output.pages.has(path), path).toBe(true)
  })

  it("committed generated files match a fresh build", async () => {
    const files = await generatedFiles(output)
    files.set(
      "src/samples.gen.ts",
      samplesModule([...reference.samples, ...output.samples]),
    )
    for (const [relative, text] of files) {
      expect(readFileSync(`${root}/${relative}`, "utf8"), relative).toBe(text)
    }
  })
})

describe("the API reference", () => {
  it("has one page and a TypeScript sample for every operation", () => {
    const document = JSON.parse(reference.document) as {
      paths: Record<string, Record<string, unknown>>
    }
    const count = Object.values(document.paths).reduce(
      (sum, methods) => sum + Object.keys(methods).length,
      0,
    )
    expect(reference.pages).toHaveLength(count)
    for (const page of reference.pages) {
      expect(output.pages.has(page.path)).toBe(true)
      if (page.body.kind !== "operation") throw new Error(page.path)
      expect(page.body.operation.samples.map((code) => code.p.title)).toEqual([
        "TypeScript",
        "curl",
      ])
    }
    expect(reference.samples).toHaveLength(count)
  })

  it("gives every status a description that reads, or none", () => {
    // "`not_found`." used to render "404 not_found. ." on every page.
    expect(statusText("`not_found`.")).toBe("")
    expect(statusText("`forbidden`, `origin_not_allowed` or `x_y`.")).toBe("")
    expect(statusText("`invalid_request`: malformed parameters.")).toBe(
      "Malformed parameters.",
    )
    for (const page of reference.pages) {
      if (page.body.kind !== "operation") continue
      for (const status of page.body.operation.statuses) {
        const text = status.description
        if (text === "") continue
        expect(text, `${page.path} ${status.code}`).toMatch(/^[A-Z]/)
        expect(text, `${page.path} ${status.code}`).toMatch(/[a-z]/)
      }
    }
  })

  it("uses the SDK's real entry point in samples", () => {
    const withSdk = reference.samples.filter((sample) =>
      sample.source.includes("@matchbox-dev/sdk"),
    )
    expect(withSdk.length).toBeGreaterThan(0)
    for (const sample of withSdk) {
      expect(sample.source).toContain("createMatchboxClient")
      expect(sample.source).not.toContain("new Matchbox")
    }
  })

  it("maps every Classic console anchor to an operation page", () => {
    for (const [anchor, href] of Object.entries(reference.legacyAnchors)) {
      expect(anchor).toMatch(/^get-v1-/)
      expect(output.pages.has(href)).toBe(true)
    }
  })
})

describe("the MCP tool pages", () => {
  it("match the tools Stuart's MCP handler serves today", async () => {
    const live = await toolsListOf()
    expect(readMcpTools()).toEqual(live)
    expect(live.tools).toHaveLength(25)
    expect(live.tools.map((tool) => tool.name)).not.toContain(
      "draft_support_report",
    )
  }, 60_000)
})

describe("redirects", () => {
  it("land every old URL on a published page in at most two hops", () => {
    const pages = new Set(output.pages.keys())
    pages.add("/")
    for (const url of legacyUrls) {
      const result = resolveUrl(url, pages)
      expect(result.kind, url).toBe("page")
      expect(result.hops, url).toBeLessThanOrEqual(2)
    }
  })

  it("send every matchdocs page to its new home", () => {
    const pages = new Set(output.pages.keys())
    pages.add("/")
    expect(resolveUrl("/docs/guides/voting/", pages)).toMatchObject({
      path: "/pro/vote",
    })
    expect(resolveUrl("/docs/reference/glossary", pages)).toMatchObject({
      path: "/concepts/glossary",
    })
    expect(resolveUrl("/guides/dashboard", pages)).toMatchObject({
      path: "/pro/overview",
    })
    expect(resolveUrl("/docs/anything/else", pages)).toMatchObject({
      path: "/",
    })
  })

  it("keeps the error anchors every API error body links to", () => {
    const errors = output.pages.get("/developer/errors")
    if (errors === undefined || errors.kind !== "prose")
      throw new Error("no errors page")
    const text = JSON.stringify(errors.body)
    for (const url of errorAnchorUrls(errorCodeSchema.options)) {
      const code = url.split("#")[1] ?? ""
      expect(text).toContain(`"id":"${code}"`)
    }
  })

  it("end every chain for a browser holding Classic's cached 301s", () => {
    // Before the cutover Netlify answered docs.matchbox.markets<p> with a
    // 301 to matchbox.markets/docs<p> and no Cache-Control, so a returning
    // browser may still hold it for the page it visited and for home. The
    // zone redirect sends matchbox.markets/docs* to docs.matchbox.markets/
    // docs${1}, keeping the query. Every chain must reach a page.
    const pages = new Set(output.pages.keys())
    pages.add("/")
    type Hop = { host: "docs" | "classic"; path: string; query: string }
    const starts = [...legacyUrls, ...pages].map(
      (url) => url.split("#")[0] ?? url,
    )
    for (const start of starts) {
      const cached = new Set([start, "/"])
      let at: Hop = { host: "docs", path: start, query: "" }
      const seen = new Set<string>()
      let landed: string | null = null
      for (let step = 0; step < 12 && landed === null; step += 1) {
        const key = `${at.host}${at.path}?${at.query}`
        expect(seen.has(key), `${start} loops at ${key}`).toBe(false)
        seen.add(key)
        if (at.host === "classic") {
          at = { host: "docs", path: `/docs${at.path}`, query: at.query }
          continue
        }
        if (at.query === "" && cached.has(at.path)) {
          const rest = at.path === "/" ? "" : at.path
          at = { host: "classic", path: rest, query: "" }
          continue
        }
        const rule = matchRedirect(at.path)
        if (rule !== null) {
          const [path = "/", query = ""] = rule.to.split("?")
          at = { host: "docs", path, query }
          continue
        }
        if (pages.has(at.path)) {
          landed = at.path
          continue
        }
        expect(at.path.endsWith("/"), `${start} dead ends at ${at.path}`).toBe(
          true,
        )
        at = { ...at, path: at.path.slice(0, -1) }
      }
      expect(landed, start).not.toBeNull()
    }
  })

  it("mark every redirect target", () => {
    for (const rule of redirects) {
      expect(rule.to.endsWith(`?${redirectMarker}`), rule.from).toBe(true)
    }
  })

  it("never redirect a page that exists", () => {
    for (const rule of redirects) {
      if (rule.from.includes("*")) continue
      expect(output.pages.has(rule.from), rule.from).toBe(false)
    }
  })
})

describe("Stuart's knowledge bundle", () => {
  const forbidden = /[—–·;]/
  const numbers = (text: string): string[] =>
    (
      text.replace(/0x[0-9a-fA-F]+/g, "").match(/\d[\d,]*(?:\.\d+)?/g) ?? []
    ).map((value) =>
      value
        .replaceAll(",", "")
        .replace(/^0+(?=\d)/, "")
        .replace(/(\.\d*?)0+$/, "$1")
        .replace(/\.$/, ""),
    )

  it("never says troves are winding down: they are open (owner, 10 Nov 2026)", () => {
    const claim =
      /wind(?:ing|s)? down|wound down|borrowing on mezo (?:has moved|runs on)/i
    for (const { entries } of output.knowledge) {
      for (const entry of entries) {
        for (const text of [
          entry.answer,
          entry.title,
          ...entry.detail,
          ...entry.keywords,
        ]) {
          expect(claim.test(text), `${entry.id}: ${text}`).toBe(false)
        }
      }
    }
    for (const page of output.pages.values()) {
      expect(claim.test(JSON.stringify(page)), page.path).toBe(false)
    }
    const where = output.knowledge
      .flatMap((page) => page.entries)
      .find((entry) => entry.id === "borrow.where")
    expect(where?.answer).toContain("MUSD trove")
    expect(where?.answer).toContain("Morpho Blue")
  })

  it("calls recovery mode system-wide wherever it names it", () => {
    // The trove facts card read "Recovery mode below 150%", as if one
    // trove under 150% were in recovery mode. CCR is the system's ratio.
    function text(value: unknown): string {
      if (typeof value === "string") return value
      if (Array.isArray(value)) return value.map(text).join(" ")
      if (typeof value === "object" && value !== null) {
        return Object.entries(value)
          .filter(([key]) => key !== "t")
          .map(([, child]) => text(child))
          .join(" ")
      }
      return ""
    }
    const blocks: string[] = []
    function collect(value: unknown): void {
      if (Array.isArray(value)) {
        for (const child of value) collect(child)
        return
      }
      if (typeof value !== "object" || value === null) return
      const node = value as { t?: unknown; c?: unknown }
      if (node.t === "fact" || node.t === "p" || node.t === "li") {
        blocks.push(text(node))
        return
      }
      for (const child of Object.values(node)) collect(child)
    }
    // Prose and notes: the MCP tool pages only list it as an output field.
    for (const page of output.pages.values()) {
      if (page.kind === "prose") collect(page.body)
    }
    for (const entry of output.knowledge.flatMap((page) => page.entries)) {
      blocks.push(entry.answer, ...entry.detail)
    }
    const named = blocks.filter((block) => /recovery mode/i.test(block))
    expect(named.length).toBeGreaterThan(0)
    for (const block of named) expect(block, block).toMatch(/system/i)
  })

  it("sources the Borrow page's Enclave liquidation claim in FACTS.md", () => {
    const borrow = JSON.stringify(output.pages.get("/concepts/borrow"))
    expect(borrow).toContain("Enclave positions have no on-chain liquidation")
    const facts = readFileSync(`${root}/FACTS.md`, "utf8")
    const row = facts
      .split("\n")
      .find((line) => line.startsWith("| Enclave liquidation"))
    expect(row).toContain("docs/research/mezo-borrow-markets.md:289")
  })

  it("states the SDK's real retry rule", () => {
    const client = readFileSync(`${root}/../sdk/src/client.ts`, "utf8")
    const retries = Number(/defaultMaxRetries = (\d+)/.exec(client)?.[1])
    const delayMs = Number(
      /defaultMaxRetryDelayMs = ([\d_]+)/
        .exec(client)?.[1]
        ?.replaceAll("_", ""),
    )
    const page = output.pages.get("/developer/rate-limits")
    const said = JSON.stringify(page)
    expect(retries).toBe(2)
    expect(said).toContain("up to twice")
    expect(said).toContain(`at most ${retries + 1} attempts`)
    expect(said).toContain(`more than ${delayMs / 1000} seconds`)
    expect(said).toContain("does not wait")
  })

  it("answers the expiry questions its keywords catch", () => {
    // rewards.claim matched "rewards expire" while saying nothing about
    // expiry. The contract source shows unclaimed rewards never expire
    // (FACTS.md, Reward expiry), and the note must say so.
    const entries = output.knowledge.flatMap((page) => page.entries)
    for (const entry of entries) {
      const asksExpiry = (keyword: string) =>
        /(reward|fee|incentive)s? expire/.test(keyword)
      if (!entry.keywords.some(asksExpiry)) {
        continue
      }
      const said = [entry.answer, ...entry.detail].join(" ")
      expect(said, entry.id).toMatch(/expire/i)
    }
    const claim = entries.find((entry) => entry.id === "rewards.claim")
    expect(claim?.detail.join(" ")).toContain("do not expire")
  })

  it("follows the rules Stuart's knowledge test enforces", () => {
    const entries = output.knowledge.flatMap((page) => page.entries)
    expect(entries.length).toBeGreaterThan(10)
    const ids = entries.map((entry) => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const entry of entries) {
      expect(entry.title.length, entry.id).toBeLessThanOrEqual(60)
      expect(forbidden.test(entry.answer), entry.id).toBe(false)
      expect(forbidden.test(entry.title), entry.id).toBe(false)
      for (const line of entry.detail)
        expect(forbidden.test(line), entry.id).toBe(false)
      expect(
        entry.answer.split(/(?<=[.!?])\s+/).length,
        entry.id,
      ).toBeLessThanOrEqual(2)
      const facts = new Set(
        entry.facts.flatMap((fact) => numbers(fact.display)),
      )
      for (const number of numbers(entry.answer)) {
        expect(facts.has(number), `${entry.id}: ${number}`).toBe(true)
      }
    }
  })
})
