import type Anthropic from "@anthropic-ai/sdk"
import {
  stuartRequestSchema,
  supportReportSubmitSchema,
} from "@matchbox/stuart-ui/contract"
import { beforeEach, describe, expect, it } from "vitest"
import { resetClaudeBreaker, resetGrammarFallback } from "./claude"
import { fakeProviders, NOW, WALLET } from "./fakes"
import {
  isSafetyQuestion,
  MEZO_KNOWLEDGE,
  requiredSafetyNote,
  safetySignal,
} from "./knowledge/mezo"
import { runStuartQuery } from "./orchestrator"
import { IdScope } from "./outcome"
import type { BlockscoutReader } from "./providers/blockscout"
import { redactLogEvent, redactSecrets } from "./redact"
import { routeQuery } from "./router"
import { sentencesOf } from "./sourcedClaims"
import { submitSupportReport } from "./supportReport"
import { draftSupportReportTool } from "./tools/support"

// The regressions and follow-ups the adversarial review of the safety
// follow-ups found (19 Nov 2026), each with the review's own messages.
// Redaction is conservative (when unsure, redact); routing is precise (a
// false safety note costs the user an answer).

/** Obviously fake 64-hex: never a real key. */
const HEX = "0123456789abcdef".repeat(4)
const KEY = `0x${HEX}`
const A11 = Array.from({ length: 11 }, () => "abandon").join(" ")

/** The router's tool, or its kind. */
function route(query: string): string {
  const decision = routeQuery(query, NOW)
  if (decision.kind === "tool") return decision.tool
  if (decision.kind === "clarify") return `clarify:${decision.cardId}`
  return decision.kind
}

/** A scripted model: the given tool calls, then the given answer. */
function scripted(
  calls: Array<[string, unknown]>,
  answer: string,
): (body: unknown) => Promise<Anthropic.Beta.BetaMessage> {
  const queue: Anthropic.Beta.BetaContentBlock[][] = [
    ...calls.map(([name, input], index) => [
      {
        type: "tool_use" as const,
        id: `toolu_${index + 1}`,
        name,
        input,
        caller: { type: "direct" as const },
      },
    ]),
    [
      {
        type: "tool_use" as const,
        id: "toolu_answer",
        name: "respond",
        input: { answer, blocks: [], evidence: [], followups: [] },
        caller: { type: "direct" as const },
      },
    ],
  ]
  return async () => {
    const content = queue.shift()
    if (!content) throw new Error("unexpected Claude call")
    return {
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: "claude-opus-5-5",
      container: null,
      context_management: null,
      diagnostics: null,
      stop_details: null,
      stop_reason: "tool_use",
      stop_sequence: null,
      content,
      usage: {
        input_tokens: 120,
        output_tokens: 40,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation: null,
        fallback_credit: null,
        inference_geo: null,
        iterations: null,
        output_tokens_details: null,
        server_tool_use: null,
        service_tier: "standard",
        speed: null,
      },
    }
  }
}

/** A Blockscout that knows the given transaction hashes; paths it was asked. */
function blockscoutKnowing(hashes: readonly string[], asked: string[] = []) {
  const reader: BlockscoutReader = async (path, schema) => {
    asked.push(path)
    const hash = /^api\/v2\/transactions\/(0x[0-9a-f]{64})$/.exec(path)?.[1]
    if (hash === undefined || !hashes.includes(hash)) {
      return { status: "unavailable" }
    }
    const parsed = schema.safeParse({ hash })
    return parsed.success
      ? { status: "ok", data: parsed.data }
      : { status: "unavailable" }
  }
  return reader
}

function ask(
  query: string,
  create: ReturnType<typeof scripted> | null,
  options: {
    routerOff?: boolean
    logs?: Record<string, unknown>[]
    blockscout?: BlockscoutReader
  } = {},
) {
  return runStuartQuery(
    stuartRequestSchema.parse({
      version: 1,
      query,
      sessionId: "6f1c1b8e-3c55-4a3f-9b8a-1d2e3f4a5b6c",
      turn: 0,
      surface: "palette",
      chainId: 31_612,
      wallet: { address: WALLET, mode: "connected" },
    }),
    {
      providers: fakeProviders(
        options.blockscout === undefined
          ? {}
          : { blockscout: options.blockscout },
      ),
      secret: "test-secret",
      now: () => NOW,
      claude: create
        ? { create, model: "claude-opus-5-5", effort: "low" }
        : null,
      log: (event) => options.logs?.push(event),
      routerOff: options.routerOff ?? false,
    },
  )
}

beforeEach(() => {
  resetClaudeBreaker()
  resetGrammarFallback()
})

/** The support report draft a response shows, if any. */
function draftOf(response: Awaited<ReturnType<typeof ask>>) {
  for (const block of response.uiBlocks) {
    if (block.type === "support_report_preview") return block.draft
  }
  return undefined
}

/** The support tool run directly, as the model would call it. */
async function drafted(query: string, blockscout?: BlockscoutReader) {
  const outcome = await draftSupportReportTool.execute(
    {
      providers: fakeProviders(blockscout === undefined ? {} : { blockscout }),
      wallet: { address: WALLET, mode: "connected", label: "Main" },
      query,
      choice: null,
      now: () => NOW,
      secret: "test-secret",
      scope: new IdScope("c1"),
    },
    { problem: query, kind: null },
  )
  if ("invalid" in outcome) throw new Error(outcome.invalid)
  const block = outcome.blocks[0]
  if (block?.type !== "support_report_preview") throw new Error("no preview")
  return block.draft
}

const SECRETS_NOTE = /^Stuart, Matchbox and Mezo never ask for a seed phrase/
const REDIRECT_NOTE =
  /^Claim, vote and relock only on matchbox\.markets or mezo\.org/
const DRAINED_NOTE =
  /^Treat a wallet that lost funds after you signed something as compromised/
const HEX_REMOVED = "A long hex value was removed for safety"

function claimingModel(answer: string) {
  return scripted([["prepare_claim", { sources: null, lockIds: null }]], answer)
}

describe("B1: a 64-hex string beside a common word is a key again", () => {
  const KEYS = [
    `what is my position ${KEY}`,
    `here's my lock id ${KEY}, why can't I claim`,
    `which pool is my wallet in ${KEY}`,
    `I can't see my block rewards ${KEY}`,
    `my lock position is stuck, my wallet is ${KEY}`,
    `report a problem: my position is missing, my wallet is ${KEY}`,
    `check this tx with my wallet ${KEY}`,
    `what is my market ${KEY}`,
  ]

  it("routes each to the safety notes", () => {
    for (const query of KEYS) {
      expect(safetySignal(query), query).toBe("key_pasted")
      expect(route(query), query).toBe("mezo_knowledge")
    }
  })

  it("redacts each in logs and in a report's text", () => {
    for (const query of KEYS) {
      expect(redactSecrets(query).text, query).not.toContain(HEX)
      expect(redactSecrets(query, { mode: "report" }).text).not.toContain(HEX)
    }
  })

  it("redacts a hex in a Matchscan link and beside tx words, though it routes", () => {
    for (const query of [
      `https://scan.matchbox.markets/tx/${KEY}`,
      `what happened in tx ${KEY}`,
      `what is market ${KEY}`,
      `what is the apy of morpho market ${KEY}`,
    ]) {
      expect(isSafetyQuestion(query), query).toBe(false)
      expect(route(query), query).not.toBe("mezo_knowledge")
      expect(redactSecrets(query).text, query).not.toContain(HEX)
      expect(
        JSON.stringify(redactLogEvent({ message: "x", detail: query })),
      ).not.toContain(HEX)
    }
  })

  it("never keeps the key in a report the model drafts, nor in the edited statement", async () => {
    const query = `report a problem: my position is missing, my wallet is ${KEY}`
    const on = await ask(query, null)
    expect(on.answer.text).toMatch(SECRETS_NOTE)
    expect(draftOf(on)).toBeUndefined()
    const off = await ask(
      query,
      scripted(
        [["draft_support_report", { problem: query, kind: null }]],
        "Your report is ready to review.",
      ),
      { routerOff: true },
    )
    expect(JSON.stringify(off)).not.toContain(HEX)
    const draft = await drafted(query)
    expect(JSON.stringify(draft)).not.toContain(HEX)
    expect(draft.problemStatement).toContain(HEX_REMOVED)
    // Signing follows redaction: the redacted draft submits, and a key
    // pasted again into the edited statement is not stored.
    let stored = ""
    await submitSupportReport({
      body: supportReportSubmitSchema.parse({
        version: 1,
        draft,
        problemStatement: `${draft.problemStatement} again: ${KEY}`,
        includedItemIds: ["message"],
        contact: { method: "thread_only" },
      }),
      secret: "test-secret",
      ip: "203.0.113.9",
      now: NOW,
      sink: {
        supabaseUrl: "https://example.supabase.co",
        serviceRoleKey: "service-role",
        fetch: async (_url, init) => {
          stored = String(init?.body)
          return new Response(JSON.stringify("SR-7F3A19"), { status: 200 })
        },
      },
    })
    expect(stored).not.toBe("")
    expect(stored).not.toContain(HEX)
  })

  it("redacts a transaction hash the user typed, and looks nothing up", async () => {
    // The re-check of this round: a lookup put keys a user labelled as
    // transactions into the request logs. A report keeps only ids this
    // turn's tools returned; see safetyRecheck.test.ts.
    const asked: string[] = []
    const query = `report a bug: my claim tx ${KEY} reverted`
    const draft = await drafted(query, blockscoutKnowing([KEY], asked))
    expect(asked).toEqual([])
    expect(draft.problemStatement).not.toContain(HEX)
    expect(draft.problemStatement).toContain(HEX_REMOVED)
  })

  it("keeps the key out of every log line of a model turn", async () => {
    const logs: Record<string, unknown>[] = []
    await ask(
      `check this tx with my wallet ${KEY}`,
      scripted([], `The transaction ${KEY} is pending.`),
      { routerOff: true, logs },
    )
    expect(logs.length).toBeGreaterThan(0)
    expect(JSON.stringify(logs)).not.toContain(HEX)
  })
})

describe("B2: a phrase with one mistyped word is caught again", () => {
  const TYPO = [`${A11} abandom`, `my wallet won't open: ${A11} abandom`]

  it("routes to the safety notes", () => {
    for (const query of TYPO) {
      expect(safetySignal(query), query).toBe("phrase_pasted")
      expect(route(query), query).toBe("mezo_knowledge")
    }
  })

  it("redacts it in logs and reports", async () => {
    for (const query of TYPO) {
      for (const mode of ["log", "report"] as const) {
        const text = redactSecrets(query, { mode }).text
        expect(text, `${mode}: ${query}`).not.toMatch(/abandon|abandom/)
      }
      const draft = await drafted(query)
      expect(JSON.stringify(draft)).not.toMatch(/abandon|abandom/)
    }
  })

  it("keeps main's shape rule as a backstop in logs, and prose in reports", () => {
    // Twelve short words, none of them on the list.
    const shaped = "qwer tyui opas dfgh jklz xcvb nmqw erty uiop sdfg hjkl zxcv"
    expect(redactSecrets(shaped).text).toBe("[redacted:word_phrase]")
    // In a report too: twelve words that are not prose could be a phrase
    // from another language's list, so they go, as they did on main.
    expect(redactSecrets(shaped, { mode: "report" }).text).toBe(
      "[redacted:word_phrase]",
    )
    expect(
      redactSecrets(`my seed is ${shaped}`, { mode: "report" }).text,
    ).not.toContain("qwer")
    const prose =
      "the claim button does nothing when I press it after the vote ends"
    expect(redactSecrets(prose, { mode: "report" }).text).toBe(prose)
  })
})

describe("F3: the redirect note says only what is true", () => {
  const note = MEZO_KNOWLEDGE.find((entry) => entry.id === "safety.redirect")

  it("sends the user to Matchbox or mezo.org, opened themselves", () => {
    expect(note?.answer).toMatch(REDIRECT_NOTE)
    const sentences = [note?.answer ?? "", ...(note?.detail ?? [])].flatMap(
      sentencesOf,
    )
    expect(sentences.length).toBeGreaterThan(1)
    for (const sentence of sentences) {
      expect(sentence).not.toMatch(/never send you to another site/i)
      expect(sentence).not.toMatch(/never move/i)
    }
  })
})

describe("F4: support-type askers and scam places", () => {
  it("keeps news from Mezo, the team or a manager on its flow", () => {
    for (const query of [
      "the Mezo team says to vote before the epoch ends, vote for SNF",
      "official announcement said to claim before the epoch flip",
      "the team asked me to vote for their gauge",
      "the manager of the pool wants me to vote for it",
      "Mezo says rewards moved to the new epoch, claim",
    ]) {
      expect(isSafetyQuestion(query), query).toBe(false)
      expect(route(query), query).not.toBe("mezo_knowledge")
    }
  })

  it("warns when anyone names a link or a domain to claim at", async () => {
    for (const query of [
      "a guy in telegram said claim at mezo-rewards.xyz, claim my rewards",
      "a mod said rewards are at claim-mezo.app",
      "someone sent me a link to claim",
    ]) {
      expect(requiredSafetyNote(query), query).toBe("safety.redirect")
      expect(route(query), query).toBe("mezo_knowledge")
      const on = await ask(query, null)
      expect(on.answer.text, query).toMatch(REDIRECT_NOTE)
      expect(on.proposedActions).toEqual([])
      const off = await ask(
        query,
        claimingModel("Your claim is ready, review and sign in your wallet."),
        { routerOff: true },
      )
      expect(off.answer.text, query).toMatch(REDIRECT_NOTE)
      expect(off.proposedActions).toEqual([])
    }
  })

  it("keeps advice, news and Stuart's own places on their flow", () => {
    for (const query of [
      "someone told me to vote for SNF",
      "the Mezo team announced a new gauge contract, explain it",
      "support told me to ask you how to claim",
      "my friend told me to relock, relock my veBTC",
      "the docs say to claim on Pro, claim my rewards",
      "someone said claim on matchbox.markets, claim my rewards",
    ]) {
      expect(isSafetyQuestion(query), query).toBe(false)
      expect(route(query), query).not.toBe("mezo_knowledge")
    }
  })
})

describe("F5: questions made of BIP-39 words are questions", () => {
  const QUESTIONS = [
    "can you check what total reward this gauge will give next month",
    "please explain what fee this pool will charge when you swap token",
    "can you tell what price this lock will have when you add more",
    "can you tell what reward this vote will earn next month please",
    "please check what balance this address will have once you claim reward",
    "can you explain what average reward this pool will return next month",
    "please tell what total fee you will have when you bridge token",
    "can you check what rate this loan will have next month please",
    "please can you explain what reward this gauge will have next month",
    "Can you check what total reward this gauge will give next month?",
  ]

  it("routes each to its normal route", () => {
    for (const query of QUESTIONS) {
      expect(isSafetyQuestion(query), query).toBe(false)
      expect(route(query), query).not.toBe("mezo_knowledge")
    }
  })

  it("answers each without the secrets note, the checksum read", async () => {
    for (const query of QUESTIONS) {
      const response = await ask(query, null)
      expect(response.answer.text, query).not.toMatch(SECRETS_NOTE)
    }
  })

  it("still redacts each in a log line, where over-redaction is fine", () => {
    for (const query of QUESTIONS.slice(0, 3)) {
      expect(redactSecrets(query).text).toContain("[redacted:word_phrase]")
    }
  })
})

describe("F6: a backup is not a disclosure", () => {
  it("does not read a correct backup as a secret given away", () => {
    for (const query of [
      "I wrote down my seed phrase on paper, is that ok?",
      "I put my seed phrase in a safe",
      "I typed my seed phrase into my Ledger to restore it",
      "I imported my recovery phrase into a new wallet",
    ]) {
      expect(requiredSafetyNote(query), query).toBeNull()
    }
  })

  it("keeps the model's own warning for a backup question", async () => {
    const warning =
      "Never share your seed phrase with anyone. Never store your seed phrase online, write it on paper instead."
    const response = await ask(
      "I wrote down my seed phrase on paper, is that ok?",
      scripted([["mezo_knowledge", { question: "seed phrase" }]], warning),
      { routerOff: true },
    )
    expect(response.answer).toMatchObject({ origin: "model", text: warning })
  })

  it("does not read a few words or a seed amount as a secret", () => {
    for (const query of [
      "I shared a few words about SNF on the forum",
      "what is the seed amount for a new pool",
    ]) {
      expect(safetySignal(query), query).toBeNull()
    }
  })

  it("reads a secret handed to someone as given away, without an I", () => {
    for (const query of [
      "gave them my words",
      "put my phrase in the form",
      "they have my recovery words",
    ]) {
      expect(requiredSafetyNote(query), query).toBe("safety.secrets")
      expect(route(query), query).toBe("mezo_knowledge")
    }
  })

  it("warns about a drained wallet instead of a bare claim card", async () => {
    const query =
      "wallet got drained after I signed something, claim my rewards"
    expect(route(query)).toBe("mezo_knowledge")
    const on = await ask(query, null)
    expect(on.answer.text).toMatch(DRAINED_NOTE)
    expect(on.answer.text).toContain("new wallet")
    expect(on.answer.text).toContain("a new wallet with a new recovery phrase")
    expect(on.proposedActions).toEqual([])
    const off = await ask(
      query,
      claimingModel("Your claim is ready, review and sign in your wallet."),
      { routerOff: true },
    )
    expect(off.answer.text).toMatch(DRAINED_NOTE)
    expect(off.proposedActions).toEqual([])
  })
})

describe("F7: more ways of splitting a key or a phrase", () => {
  const words = Array.from({ length: 12 }, () => "abandon")

  it("reads keys split by two spaces, a blank line or eight groups", () => {
    for (const query of [
      `my key is ${HEX.slice(0, 32)}  ${HEX.slice(32)}`,
      `${HEX.slice(0, 32)}\n\n${HEX.slice(32)}`,
      (HEX.match(/.{8}/g) ?? []).join(" "),
    ]) {
      expect(safetySignal(query), query).toBe("key_pasted")
      expect(redactSecrets(query).text, query).not.toMatch(/[0-9a-f]{8}/)
    }
  })

  it("reads phrases split by a dash, a bar, a semicolon or a full stop", () => {
    for (const query of [
      words.join(" - "),
      words.join(" | "),
      words.join("; "),
      words.join(". "),
      words.map((word, index) => `${index + 1} - ${word}`).join(" "),
    ]) {
      expect(safetySignal(query), query).toBe("phrase_pasted")
      for (const mode of ["log", "report"] as const) {
        expect(redactSecrets(query, { mode }).text, query).not.toContain(
          "abandon",
        )
      }
    }
  })
})
