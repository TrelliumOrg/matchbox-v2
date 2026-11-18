import { docsAskResponseSchema } from "@matchbox/docs/ask"
import { stuartErrorSchema } from "@matchbox/stuart-ui/contract"
import { describe, expect, it } from "vitest"
import { createStuartApp } from "../app"
import { post, testDeps } from "../testing"
import answerDocsQuestion from "./docsAsk"
import { knowledgePage, MEZO_KNOWLEDGE } from "./knowledge/mezo"
import { STUART_LIMITS } from "./rateLimit"

const DOCS = "https://docs.matchbox.markets"
const PRO = "https://pro.matchbox.markets"

function ask(
  body: unknown,
  headers: Record<string, string> = { origin: DOCS },
): Request {
  return post("/docs/ask", {
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "cf-connecting-ip": "10.0.0.7", ...headers },
  })
}

async function errorCode(response: Response): Promise<string> {
  return stuartErrorSchema.parse(await response.json()).error.code
}

describe("POST /docs/ask", () => {
  it("answers the docs origin from reviewed notes, the page's first", async () => {
    const app = createStuartApp(testDeps())
    const response = await app.request(
      ask({ question: "when can i claim", page: "/concepts/rewards" }),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get("access-control-allow-origin")).toBe(DOCS)
    expect(response.headers.get("cache-control")).toBe("no-store")
    const body = docsAskResponseSchema.parse(await response.json())
    expect(body.notes[0]).toMatchObject({ id: "rewards.claim", onPage: true })
    expect(body.notes[0]?.sources[0]?.url).toBe(`${DOCS}/concepts/rewards`)
    expect(body.version).toMatch(/^[0-9a-f]{12}$/)
  })

  it("names troves and Morpho when asked where to borrow", async () => {
    const app = createStuartApp(testDeps())
    const response = await app.request(
      ask({ question: "Where can I borrow MUSD against BTC now?", page: null }),
    )
    const body = docsAskResponseSchema.parse(await response.json())
    expect(body.notes[0]?.id).toBe("borrow.where")
    expect(body.notes[0]?.answer).toMatch(/MUSD trove.*Morpho Blue/)
  })

  it("never returns a Stuart-only note, whatever is asked", () => {
    // Stuart's own notes carry claims the docs have not verified (the
    // incident figures, the meta-transaction date), so the public endpoint
    // searches only what the docs publish.
    const own = MEZO_KNOWLEDGE.filter((entry) => knowledgePage(entry) === null)
    expect(own.length).toBeGreaterThan(0)
    const ownIds = new Set(own.map((entry) => entry.id))
    const questions = [
      "was there an exploit",
      "how do I get gas",
      "contact support",
      ...own.flatMap((entry) => [entry.title, ...entry.keywords]),
    ]
    for (const question of questions) {
      for (const page of [null, "/concepts/vebtc", "/stuart"]) {
        const { notes } = answerDocsQuestion({ question, page })
        for (const note of notes) {
          expect(ownIds.has(note.id), `${question}: ${note.id}`).toBe(false)
          expect(note.sources[0]?.url, note.id).toMatch(
            /^https:\/\/docs\.matchbox\.markets\//,
          )
        }
      }
    }
  })

  it("answers nothing, not a guess, outside the notes", async () => {
    const app = createStuartApp(testDeps())
    const response = await app.request(
      ask({
        question: "What's the weather in Paris?",
        page: "/concepts/boost",
      }),
    )
    expect(docsAskResponseSchema.parse(await response.json()).notes).toEqual([])
  })

  it("never touches the model, providers or a wallet", async () => {
    const deps = testDeps({
      providers: () => {
        throw new Error("no providers on the docs endpoint")
      },
      snapshotBlock: async () => {
        throw new Error("no chain reads on the docs endpoint")
      },
    })
    const response = await createStuartApp(deps).request(
      ask({ question: "how does boost work", page: "/concepts/boost" }),
    )
    expect(response.status).toBe(200)
  })

  it("lets the docs origins reach this route and no other", async () => {
    const app = createStuartApp(testDeps())
    const preflight = await app.request(
      new Request("https://matchbox-stuart.test/docs/ask", {
        method: "OPTIONS",
        headers: { origin: DOCS },
      }),
    )
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get("access-control-allow-origin")).toBe(DOCS)
    for (const path of ["/chat", "/proposal/refresh", "/support-report"]) {
      const other = await app.request(
        new Request(`https://matchbox-stuart.test${path}`, {
          method: "OPTIONS",
          headers: { origin: DOCS },
        }),
      )
      expect(other.status, path).toBe(403)
    }
    const search = await app.request(
      new Request("https://matchbox-stuart.test/search?q=boost", {
        headers: { origin: DOCS },
      }),
    )
    expect(search.status).toBe(403)
    // Pro may still call it.
    const pro = await app.request(
      ask({ question: "boost", page: null }, { origin: PRO }),
    )
    expect(pro.status).toBe(200)
  })

  it("refuses other sites", async () => {
    const app = createStuartApp(testDeps())
    const foreign = await app.request(
      ask(
        { question: "boost", page: null },
        { origin: "https://docs.matchbox.markets.evil.example" },
      ),
    )
    expect(foreign.status).toBe(403)
    expect(await errorCode(foreign)).toBe("forbidden_origin")
  })

  it.each([
    ["an empty question", { question: "   ", page: null }],
    ["a long question", { question: "x".repeat(301), page: null }],
    [
      "a page that is not a docs path",
      { question: "boost", page: "https://x" },
    ],
    ["a page with a dot segment", { question: "boost", page: "/../admin" }],
    ["a missing page", { question: "boost" }],
    ["an extra field", { question: "boost", page: null, wallet: "0x1" }],
  ])("rejects %s", async (_name, body) => {
    const response = await createStuartApp(testDeps()).request(ask(body))
    expect(response.status).toBe(400)
    expect(await errorCode(response)).toBe("invalid_request")
  })

  it("rejects a body over 2 KiB before parsing it", async () => {
    const response = await createStuartApp(testDeps()).request(
      ask(
        JSON.stringify({
          question: "boost",
          page: null,
          pad: "x".repeat(2100),
        }),
      ),
    )
    expect(response.status).toBe(413)
  })

  it("rate limits each IP prefix, counting bad requests too", async () => {
    const app = createStuartApp(testDeps())
    const limit = STUART_LIMITS.docs.ip.perMinute
    for (let index = 0; index < limit; index += 1) {
      const response = await app.request(ask("not json"))
      expect(response.status).toBe(400)
    }
    const limited = await app.request(ask({ question: "boost", page: null }))
    expect(limited.status).toBe(429)
    expect(limited.headers.get("retry-after")).not.toBeNull()
    expect(await errorCode(limited)).toBe("rate_limited")
  })
})
