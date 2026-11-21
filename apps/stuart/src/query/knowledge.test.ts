import { docsKnowledge } from "@matchbox/docs/knowledge"
import { stuartRequestSchema } from "@matchbox/stuart-ui/contract"
import { describe, expect, it } from "vitest"
import { SYSTEM_PROMPT } from "./claude"
import { FORBIDDEN_COPY } from "./copy"
import { fakeProviders, NOW } from "./fakes"
import {
  knowledgePage,
  MEZO_KNOWLEDGE,
  searchMezoKnowledge,
} from "./knowledge/mezo"
import { runStuartQuery } from "./orchestrator"
import { IdScope } from "./outcome"
import { numberTokens } from "./sourced"
import { knowledgeOutcome } from "./tools/knowledge"

describe("Mezo knowledge notes", () => {
  it("keep ids unique and cite https sources", () => {
    const ids = MEZO_KNOWLEDGE.map((entry) => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const entry of MEZO_KNOWLEDGE) {
      expect(entry.sources.length).toBeGreaterThan(0)
      for (const source of entry.sources) {
        expect(source.url).toMatch(/^https:\/\//)
        expect(source.label.length).toBeLessThanOrEqual(60)
      }
      expect(entry.title.length).toBeLessThanOrEqual(60)
    }
  })

  it("follow the copy rules and stay two sentences", () => {
    for (const entry of MEZO_KNOWLEDGE) {
      for (const text of [entry.answer, entry.title, ...entry.detail]) {
        expect(FORBIDDEN_COPY.test(text), `${entry.id}: ${text}`).toBe(false)
      }
      const sentences = entry.answer.split(/(?<=[.!?])\s+/).filter(Boolean)
      expect(sentences.length, entry.id).toBeLessThanOrEqual(2)
      for (const fact of entry.facts) {
        expect(fact.display.length).toBeLessThanOrEqual(60)
        expect(fact.label.length).toBeLessThanOrEqual(60)
      }
    }
  })

  it("source every number in an answer from the entry's facts", () => {
    for (const entry of MEZO_KNOWLEDGE) {
      const sourced = new Set(
        entry.facts.flatMap((fact) => numberTokens(fact.display)),
      )
      for (const token of numberTokens(entry.answer)) {
        expect(sourced.has(token), `${entry.id}: ${token}`).toBe(true)
      }
    }
  })

  it("carry the contract facts support depends on", () => {
    const text = (id: string) =>
      MEZO_KNOWLEDGE.find((entry) => entry.id === id)?.answer ?? ""
    expect(text("vote.distribute_window")).toContain(
      "Thursday 00:00 to 01:00 UTC",
    )
    expect(text("vote.once_per_epoch")).toContain("once per epoch")
    expect(text("safety.approve")).toMatch(/Do not approve.*custody/)
    expect(text("safety.meta_tx")).toContain(
      "disabled meta-transactions on 5 Oct 2026",
    )
    expect(text("gauges.mezo")).toContain("ThirdPartyVoter")
    expect(text("boost.voter")).toContain("BoostVoter")
    expect(text("borrow.troves")).toContain("110% collateral ratio")
  })

  it("never say troves are winding down: they are open (owner, 10 Nov 2026)", () => {
    const claim =
      /wind(?:ing|s)? down|wound down|borrowing on mezo (?:has moved|runs on)/i
    // The generated docs list on its own too, so a docs edit cannot slip
    // the claim back in even if the merge below changed.
    for (const entry of [...docsKnowledge, ...MEZO_KNOWLEDGE]) {
      for (const text of [
        entry.answer,
        entry.title,
        ...entry.detail,
        ...entry.keywords,
      ]) {
        expect(claim.test(text), `${entry.id}: ${text}`).toBe(false)
      }
    }
    expect(claim.test(SYSTEM_PROMPT)).toBe(false)
    expect(
      MEZO_KNOWLEDGE.find((entry) => entry.id === "borrow.where")?.answer,
    ).toContain("MUSD trove")
    expect(
      docsKnowledge.find((entry) => entry.id === "borrow.where")?.answer,
    ).toMatch(/MUSD trove.*Morpho Blue/)
  })

  it("take every docs note as written and add only Stuart's own", () => {
    for (const note of docsKnowledge) {
      expect(MEZO_KNOWLEDGE).toContainEqual(note)
      expect(knowledgePage(note)).toMatch(/^\/[a-z0-9/-]+$/)
    }
    const own = MEZO_KNOWLEDGE.filter((entry) => knowledgePage(entry) === null)
    expect(own.map((entry) => entry.id).sort()).toEqual([
      "earn.no_guarantee",
      "earn.savings",
      "network.gas",
      "safety.approve",
      "safety.drained",
      "safety.incident",
      "safety.meta_tx",
      "safety.phrase_holder",
      "safety.redirect",
      "safety.secrets",
      "support.contact",
    ])
  })

  it("rank the current docs page's notes first when a page is sent", () => {
    const query = "how does boost work and when can i claim"
    expect(searchMezoKnowledge(query)[0]?.entry.id).not.toBe("rewards.claim")
    const onRewards = searchMezoKnowledge(query, { page: "/concepts/rewards" })
    expect(onRewards[0]?.entry.id).toBe("rewards.claim")
    // One title word is enough on the page the reader is on.
    expect(searchMezoKnowledge("but whose works")).toEqual([])
    expect(
      searchMezoKnowledge("but whose works", { page: "/concepts/boost" })[0]
        ?.entry.id,
    ).toBe("boost.mechanism")
    expect(
      searchMezoKnowledge("troves", { page: "/concepts/borrow" })[0]?.entry.id,
    ).toMatch(/^borrow\./)
    // An unknown page changes nothing.
    expect(searchMezoKnowledge(query, { page: "/nowhere" })).toEqual(
      searchMezoKnowledge(query),
    )
  })

  it.each([
    [
      "Why does my vote transaction revert on Thursday right after midnight?",
      "vote.distribute_window",
    ],
    [
      "Can I vote twice with the same lock in one epoch?",
      "vote.once_per_epoch",
    ],
    [
      "How does boosting a veBTC gauge with veMEZO change what I earn?",
      "boost.earnings",
    ],
    [
      "A site asks me to approve my veBTC NFT so it can vote for me. Is that ok?",
      "safety.approve",
    ],
    ["Can I use a relayer to vote without paying gas?", "safety.meta_tx"],
    ["How do I vote for a MEZO gauge?", "gauges.mezo"],
    ["Where can I borrow MUSD against BTC now?", "borrow.where"],
    ["What is veMEZO?", "lock.vemezo"],
    ["Do I need to vote every week?", "vote.persist"],
    ["My boost didn't change after new votes", "boost.poke"],
  ])("finds the right note for %s", (query, id) => {
    expect(searchMezoKnowledge(query)[0]?.entry.id).toBe(id)
  })

  it("matches nothing for questions outside Mezo", () => {
    expect(searchMezoKnowledge("What's the weather in Paris?")).toEqual([])
    expect(searchMezoKnowledge("Write me a poem about Ethereum")).toEqual([])
  })
})

describe("mezo_knowledge outcome", () => {
  it("cites docs evidence and references only the best entry's facts", () => {
    const outcome = knowledgeOutcome(
      { scope: new IdScope("c1") },
      searchMezoKnowledge("Why does my vote revert on Thursday?"),
    )
    expect(outcome.intent).toBe("mezo_help")
    expect(outcome.evidence.length).toBeGreaterThan(0)
    expect(outcome.evidence.every((item) => item.kind === "docs")).toBe(true)
    expect(
      outcome.evidence.every((item) => item.url?.startsWith("https://")),
    ).toBe(true)
    const referenced = outcome.facts.filter((fact) =>
      outcome.answer.factRefs.includes(fact.id),
    )
    expect(referenced.map((fact) => fact.display)).toContain(
      "Thursday 00:00 to 01:00 UTC",
    )
    // The model sees every matched note as a row with its sources.
    expect(outcome.model.rows[0]).toMatchObject({
      topic: "Votes revert during the distribute window",
    })
  })

  it("says so when no note matches", () => {
    const outcome = knowledgeOutcome({ scope: new IdScope("c1") }, [])
    expect(outcome.status).toBe("empty")
    expect(outcome.answer.text).toMatch(/^No reviewed Mezo note covers that/)
  })
})

describe("knowledge without the model", () => {
  function ask(query: string) {
    return runStuartQuery(
      stuartRequestSchema.parse({
        version: 1,
        query,
        sessionId: "6f1c1b8e-3c55-4a3f-9b8a-1d2e3f4a5b6c",
        turn: 0,
        surface: "palette",
        chainId: 31_612,
      }),
      {
        providers: fakeProviders(),
        secret: "test-secret",
        now: () => NOW,
        claude: null,
        log: () => undefined,
      },
    )
  }

  it("answers a support question the router left to the model", async () => {
    // No help signal at the start, so the router hands it to the model;
    // with no model the notes still answer it, sourced.
    const response = await ask("tell me about poke and boost not updating")
    expect(response.intent).toBe("mezo_help")
    expect(response.answer.text).toMatch(/^Boost does not update by itself/)
    expect(response.evidence.every((item) => item.kind === "docs")).toBe(true)
  })

  it("keeps off-topic questions unsupported", async () => {
    const response = await ask("What's the weather in Paris?")
    expect(response.intent).toBe("unsupported")
    expect(response.answer.text).not.toMatch(/\d/)
  })
})
