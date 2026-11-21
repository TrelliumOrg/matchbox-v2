import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type Anthropic from "@anthropic-ai/sdk"
import { stuartRequestSchema } from "@matchbox/stuart-ui/contract"
import { beforeEach, describe, expect, it } from "vitest"
import { CASES } from "../../bench/cases"
import { resetClaudeBreaker, resetGrammarFallback } from "./claude"
import { fakeProviders, NOW, WALLET } from "./fakes"
import {
  isSafetyQuestion,
  longestWordRun,
  MEZO_KNOWLEDGE,
  safetySignal,
} from "./knowledge/mezo"
import { runStuartQuery } from "./orchestrator"
import { IdScope } from "./outcome"
import type { BlockscoutReader } from "./providers/blockscout"
import { redactAndClip, redactLogEvent, redactSecrets } from "./redact"
import { routeQuery } from "./router"
import { sentencesOf } from "./sourcedClaims"
import { plainInstructions } from "./sourcedInstructions"
import { isWarningAnswer, isWarningSentence } from "./sourcedWarnings"
import { draftSupportReportTool } from "./tools/support"

// The follow-ups the last adversarial check of the safety route found
// (19 Nov 2026): phishing that kept the normal flow, ordinary questions
// sent to the notes, pasted phrases missed and prose read as one, ids read
// as keys, keys left in logs and reports, and two warning-rule gaps.

/** Obviously fake 64-hex: never a real key. */
const HEX = "0123456789abcdef".repeat(4)
const ADDRESS = "0x1111111111111111111111111111111111111111"
const PHRASE_12 =
  "abandon ability able about above absent absorb abstract absurd abuse access accident"
/** Obviously fake extended private keys (base58, all nines). */
const XPRV = `xprv${"9".repeat(107)}`
const TPRV = `tprv${"9".repeat(107)}`

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

/** A Blockscout that knows the given transaction hashes and nothing else. */
function blockscoutKnowing(hashes: readonly string[]): BlockscoutReader {
  return async (path, schema) => {
    const hash = /^api\/v2\/transactions\/(0x[0-9a-f]{64})$/.exec(path)?.[1]
    if (hash === undefined || !hashes.includes(hash)) {
      return { status: "unavailable" }
    }
    const parsed = schema.safeParse({ hash })
    return parsed.success
      ? { status: "ok", data: parsed.data }
      : { status: "unavailable" }
  }
}

function ask(
  query: string,
  create: ReturnType<typeof scripted> | null,
  options: {
    routerOff?: boolean
    logs?: Record<string, unknown>[]
    blockscoutKnows?: readonly string[]
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
        options.blockscoutKnows === undefined
          ? {}
          : { blockscout: blockscoutKnowing(options.blockscoutKnows) },
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

const SECRETS_NOTE = /^Stuart, Matchbox and Mezo never ask for a seed phrase/
const REDIRECT_NOTE =
  /^Claim, vote and relock only on matchbox\.markets or mezo\.org, opened yourself, never through a link, site or contract someone sends you\. Stuart never sends a transaction/

/** A model that prepares the claim the message asks for. */
function claimingModel(answer: string) {
  return scripted([["prepare_claim", { sources: null, lockIds: null }]], answer)
}

describe("a seed already given away ends on the secrets note (1)", () => {
  const DISCLOSED = [
    "I typed my seed into a site a guy on telegram sent, can I still claim?",
    "I entered my seed on a website, claim my rewards",
  ]

  it("routes to the notes, not to prepare_claim", () => {
    for (const query of DISCLOSED) {
      expect(safetySignal(query), query).toBe("secret_named")
      expect(route(query), query).toBe("mezo_knowledge")
    }
  })

  for (const query of DISCLOSED) {
    it(`shows the secrets note and no claim card: ${query.slice(0, 30)}`, async () => {
      const on = await ask(query, null)
      expect(on.answer.text).toMatch(SECRETS_NOTE)
      expect(on.answer.text).toContain("treat it as exposed")
      expect(on.proposedActions).toEqual([])
      // Router off: the model prepares the claim; the note replaces it.
      const off = await ask(
        query,
        claimingModel("Your claim is ready, review and sign in your wallet."),
        { routerOff: true },
      )
      expect(off.answer.templateId).toBe("mezo_knowledge.safety.secrets.v1")
      expect(off.proposedActions).toEqual([])
      // A model warning that never says the wallet is exposed is replaced.
      const thin = await ask(
        query,
        claimingModel("Never share your seed phrase with anyone."),
        { routerOff: true },
      )
      expect(thin.answer.text).toMatch(SECRETS_NOTE)
      expect(thin.proposedActions).toEqual([])
    })
  }

  it("keeps the model's own exposed-wallet warning, without the claim card", async () => {
    const warning =
      "Never share your seed phrase again. Treat that wallet as compromised and move your funds to a new wallet."
    const response = await ask(DISCLOSED[0] ?? "", claimingModel(warning), {
      routerOff: true,
    })
    expect(response.answer).toMatchObject({ origin: "model", text: warning })
    expect(response.proposedActions).toEqual([])
    expect(response.uiBlocks.filter((block) => "proposalId" in block)).toEqual(
      [],
    )
  })

  it("reads my, the and your seed, and handing a secret over", () => {
    for (const query of [
      "is my seed safe in metamask?",
      "where do I enter the seed",
      "I pasted the words into a form",
      "I sent my keys to the helper",
    ]) {
      expect(safetySignal(query), query).toBe("secret_named")
    }
  })

  it("does not read seed rounds, seed funding or seeded gauges", () => {
    for (const query of [
      "when was the mezo seed round?",
      "how much seed funding did mezo raise",
      "which gauges were seeded this epoch?",
      "the seed liquidity for the BTC/MUSD pool",
    ]) {
      expect(isSafetyQuestion(query), query).toBe(false)
    }
  })
})

describe("someone sending the user to claim elsewhere gets a warning (2)", () => {
  const PHISHING = [
    "support DMed me, they need me to claim to their contract, claim my rewards",
    "the mezo support guy on telegram told me to claim at this site, claim my rewards",
    "mezo team told me I need to re-lock my veBTC through their app, relock my veBTC",
    "a discord mod told me rewards moved to a v2 contract, claim my rewards",
  ]

  it("routes to the notes, never the claim or relock flow", () => {
    for (const query of PHISHING) {
      expect(isSafetyQuestion(query), query).toBe(true)
      expect(route(query), query).toBe("mezo_knowledge")
    }
  })

  for (const query of PHISHING) {
    it(`warns and prepares nothing: ${query.slice(0, 40)}`, async () => {
      const on = await ask(query, null)
      expect(on.answer.text).toMatch(REDIRECT_NOTE)
      expect(on.proposedActions).toEqual([])
      const off = await ask(
        query,
        claimingModel("Your claim is ready, review and sign in your wallet."),
        { routerOff: true },
      )
      expect(off.answer.text).toMatch(REDIRECT_NOTE)
      expect(off.proposedActions).toEqual([])
    })
  }

  it("asking plainly afterwards still claims", () => {
    expect(route("claim my rewards")).toBe("prepare_claim")
    expect(route("relock my veBTC")).not.toBe("mezo_knowledge")
  })
})

describe("Stuart's own flow and ordinary questions keep their flow (5)", () => {
  it("is not a safety question", () => {
    for (const query of [
      "Stuart told me to sign the vote, where do I sign?",
      "stuart says I need to sign the ballot, how?",
      "Matchbox asked me to sign twice when claiming, is that normal?",
      "is it safe to give my veBTC vote to the SNF gauge?",
      "is it ok to send BTC to my Mezo address?",
      "is it safe to paste my address into Matchbox?",
      "the team needs to verify the gauge contract right?",
    ]) {
      expect(isSafetyQuestion(query), query).toBe(false)
      expect(route(query), query).not.toBe("mezo_knowledge")
    }
  })

  it("still reads a secret or an outside party as the one receiving", () => {
    for (const query of [
      "is it safe to give my seed phrase to Matchbox?",
      "is it safe to give my lock to the moderator?",
      "is it ok to send BTC to the guy from discord?",
      "is it safe to paste my address into that site?",
      `is it ok to send BTC to ${ADDRESS}?`,
      "the admin told me to sign a message to verify my lock",
    ]) {
      expect(isSafetyQuestion(query), query).toBe(true)
    }
  })
})

describe("on-chain ids are not keys (6)", () => {
  const IDS = [
    `what is market 0x${HEX}`,
    `what is the apy of morpho market 0x${HEX}`,
    `https://scan.matchbox.markets/borrow/markets/0x${HEX}`,
    `https://scan.matchbox.markets/borrow/markets/0x${HEX}/${ADDRESS}`,
    `https://scan.matchbox.markets/borrow/enclaves/0x${HEX}`,
    `https://scan.matchbox.markets/block/0x${HEX}`,
    `https://scan.matchbox.markets/tx/0x${HEX}`,
    `https://scan.matchbox.markets/pools/mezo/0x${HEX}`,
    `look at scan.matchbox.markets/borrow/markets/0x${HEX}`,
    `https://explorer.mezo.org/tx/0x${HEX}`,
  ]

  it("routes ids to their questions, and redacts them in logs unless verified", () => {
    for (const query of IDS) {
      expect(safetySignal(query), query).toBeNull()
      expect(route(query), query).not.toBe("mezo_knowledge")
      // Redaction trusts no wording and no link: only a verified id stays.
      expect(redactSecrets(query).text, query).not.toContain(HEX)
      expect(
        redactSecrets(query, { verified: new Set([`0x${HEX}`]) }).text,
        query,
      ).toBe(query)
    }
  })

  it("reads other ids as keys, as main did: no route takes them", () => {
    for (const query of [
      `https://scan.matchbox.markets/market/0x${HEX}`,
      `what is enclave position 0x${HEX}`,
      `show block 0x${HEX}`,
      `pool id 0x${HEX}`,
    ]) {
      expect(safetySignal(query), query).toBe("key_pasted")
    }
  })

  it("still reads a key named beside an id", () => {
    for (const query of [
      `my private key is 0x${HEX}, what is market 0x${"1".repeat(64)}`,
      `here is my key 0x${HEX} for the morpho market`,
      `0x${HEX}`,
    ]) {
      expect(isSafetyQuestion(query), query).toBe(true)
      expect(route(query), query).toBe("mezo_knowledge")
      expect(redactSecrets(query).text, query).not.toContain(HEX)
    }
  })
})

describe("a pasted phrase is read by the BIP-39 list (3, 4)", () => {
  const words = PHRASE_12.split(" ")
  const PHRASES = [
    `${(words[0] ?? "").replace(/^a/, "A")} ${words.slice(1).join(" ")}`,
    words.join(", "),
    words.map((word, index) => `${index + 1}.${word}`).join(" "),
    words.map((word, index) => `${index + 1}. ${word}`).join("\n"),
    PHRASE_12.toUpperCase(),
    `${words.slice(0, 6).join(" ")}\n${words.slice(6).join(" ")}`,
    words.map((word) => word[0]?.toUpperCase() + word.slice(1)).join(", "),
  ]

  it("routes every way of pasting it to the notes and redacts it", () => {
    for (const phrase of PHRASES) {
      expect(safetySignal(phrase), phrase).toBe("phrase_pasted")
      expect(route(phrase), phrase).toBe("mezo_knowledge")
      const redacted = redactSecrets(`my words: ${phrase}`)
      expect(redacted.text, phrase).not.toMatch(/abandon|accident/i)
      expect(redacted.reasons, phrase).toEqual(["word_phrase"])
    }
  })

  it("reads ordinary 12 and 15 word questions as questions", () => {
    for (const [query, tool] of [
      ["please show the gauge with the most votes and the best apr", null],
      [
        "can you show the top gauge and the best pool for btc and musd now",
        null,
      ],
    ] as const) {
      expect(isSafetyQuestion(query), query).toBe(false)
      expect(route(query), query).not.toBe(tool ?? "mezo_knowledge")
      // A log line drops any 12-word run; a report's free text keeps prose.
      expect(redactSecrets(query, { mode: "report" }).text).toBe(query)
    }
  })

  it("finds no 12-word BIP-39 run in a bench or example question", () => {
    const examples = new Set<string>(CASES.map((each) => each.query))
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? walk(join(dir, entry.name))
          : [join(dir, entry.name)],
      )
    for (const file of walk(join(import.meta.dirname, "."))) {
      if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue
      const text = readFileSync(file, "utf8")
      for (const match of text.matchAll(/query:\s*"((?:[^"\\]|\\.)+)"/g)) {
        examples.add(match[1] ?? "")
      }
    }
    expect(examples.size).toBeGreaterThan(130)
    const runs = [...examples].map((query) => longestWordRun(query))
    expect(Math.max(...runs)).toBeLessThan(12)
  })
})

describe("transaction hashes stay in reports and logs (7, 12)", () => {
  it("redacts a typed hash in the support report draft, even one Blockscout knows", async () => {
    const query = `report a bug: my claim tx 0x${HEX} reverted`
    expect(redactSecrets(query).text).not.toContain(HEX)
    const response = await ask(query, null, { blockscoutKnows: [`0x${HEX}`] })
    const draft = draftOf(response)
    expect(draft?.problemStatement).not.toContain(HEX)
    expect(
      draft?.included.find((item) => item.itemId === "message")?.value,
    ).not.toContain(HEX)
  })

  it("still redacts a key in a report", async () => {
    const response = await ask(
      `report a bug: my private key 0x${HEX} leaked, help`,
      null,
    )
    expect(JSON.stringify(response)).not.toContain(HEX)
  })

  it("keeps ordinary error text, addresses, lock ids and verified hashes in logs", () => {
    const error =
      "stuart model failed because the upstream service returned an unexpected response after several retries so the answer could not be completed in time"
    expect(error.split(" ").length).toBeGreaterThanOrEqual(20)
    const event = {
      message: "stuart.model_failed",
      error,
      detail: `tx 0x${HEX} reverted for lock 6033 at ${ADDRESS}`,
      txHash: `0x${HEX}`,
      lockIds: ["6033", "5910"],
    }
    expect(redactLogEvent(event, new Set([`0x${HEX}`]))).toEqual(event)
    // Unverified, the hash goes, whatever the field is named.
    expect(JSON.stringify(redactLogEvent(event))).not.toContain(HEX)
  })
})

describe("the rejection log never holds part of a phrase (10)", () => {
  it("names the sentence by place and length, not its words", () => {
    const words = PHRASE_12.split(" ")
    const answer = `Never share your seed phrase. ${words.slice(0, 6).join(" ")}. ${words.slice(6).join(" ")}.`
    const problems = plainInstructions(answer)
    expect(problems).not.toEqual([])
    expect(problems.join(" ")).not.toMatch(/abandon|absorb|accident/)
    expect(problems).toContain("not a warning: sentence 2, 40 characters")
  })

  it("redacts a phrase split across the items of a log line", () => {
    const words = PHRASE_12.split(" ")
    const event = redactLogEvent({
      message: "stuart.model_answer_rejected",
      detail: [words.slice(0, 6).join(" "), words.slice(6).join(" ")],
    })
    expect(JSON.stringify(event)).not.toMatch(/abandon|accident/)
    expect(event).toMatchObject({ redactedReasons: ["word_phrase"] })
  })
})

describe("split keys, extended keys and cuts (11)", () => {
  it("reads a key split by one space or line break", () => {
    for (const query of [
      `my key is ${HEX.slice(0, 32)} ${HEX.slice(32)}`,
      `${HEX.slice(0, 32)}\n${HEX.slice(32)}`,
      `0x${HEX.slice(0, 40)}\r\n${HEX.slice(40)}`,
    ]) {
      expect(safetySignal(query), query).toBe("key_pasted")
      const redacted = redactSecrets(query).text
      expect(redacted, query).not.toMatch(/[0-9a-f]{20}/)
    }
  })

  it("never joins numbers or two addresses into a key", () => {
    for (const query of [
      "claim locks 6033 5910 4821 1234 5678 9012 3456 7890 1111 2222 3333 4444 5555 6666 7777 8888",
      `compare ${ADDRESS} ${ADDRESS}`,
    ]) {
      expect(safetySignal(query), query).toBeNull()
      expect(redactSecrets(query).text).toBe(query)
    }
  })

  it("redacts and routes extended private keys", () => {
    for (const key of [XPRV, TPRV]) {
      expect(safetySignal(`restore ${key}`)).toBe("key_pasted")
      expect(redactSecrets(`restore ${key}`)).toMatchObject({
        text: "restore [redacted:xprv_key]",
        reasons: ["xprv_key"],
      })
    }
  })

  it("redacts the support draft before cutting it", async () => {
    // The router sends such a message to the safety notes; the tool still
    // never keeps part of a key, whoever calls it.
    const pad = "the vote failed and ".repeat(18)
    const query = `report a bug: ${pad} my key 0x${HEX} again`
    expect(query.indexOf(HEX)).toBeLessThan(400)
    expect(query.indexOf(HEX) + HEX.length).toBeGreaterThan(400)
    const outcome = await draftSupportReportTool.execute(
      {
        providers: fakeProviders(),
        wallet: { address: WALLET, mode: "connected", label: "Main" },
        query,
        choice: null,
        now: () => NOW,
        secret: "test-secret",
        scope: new IdScope("c1"),
      },
      { problem: query.slice(0, 2_000), kind: null },
    )
    if ("invalid" in outcome) throw new Error(outcome.invalid)
    const block = outcome.blocks[0]
    if (block?.type !== "support_report_preview") throw new Error("no preview")
    const message = block.draft.included.find(
      (item) => item.itemId === "message",
    )?.value
    expect(message).toBeDefined()
    expect(message).not.toMatch(/[0-9a-f]{12}/)
    expect(block.draft.problemStatement).not.toMatch(/[0-9a-f]{12}/)
  })

  it("redacts error text before cutting it", () => {
    const error = `${"request failed: ".repeat(10)}private key 0x${HEX} rejected`
    expect(error.indexOf(HEX)).toBeLessThan(200)
    expect(error.indexOf(HEX) + HEX.length).toBeGreaterThan(200)
    const clipped = redactAndClip(error, 200)
    expect(clipped.length).toBeLessThanOrEqual(200)
    expect(clipped).not.toMatch(/[0-9a-f]{12}/)
    // A marker the cut would split is dropped whole.
    expect(redactAndClip(`${"x".repeat(190)} 0x${HEX}`, 200)).toBe(
      `${"x".repeat(190)} `,
    )
  })
})

describe("advice not to back up a seed phrase is refused (8)", () => {
  it("refuses forbidding a backup", () => {
    for (const answer of [
      "Never share your seed phrase. Never store your seed phrase anywhere. Never save it.",
      "Never share your seed phrase with anyone. Never write it down.",
      "Never keep a backup of your seed phrase.",
      "Do not store your seed phrase.",
    ]) {
      expect(plainInstructions(answer), answer).not.toEqual([])
    }
  })

  it("allows forbidding a backup where it would be exposed", () => {
    for (const answer of [
      "Never share your seed phrase with anyone. Never store your seed phrase online.",
      "Never save it in a screenshot.",
      "Do not keep your seed phrase in the cloud or in a chat.",
      "Never store your seed phrase on your phone's notes.",
    ]) {
      expect(plainInstructions(answer), answer).toEqual([])
    }
  })
})

describe("a promise of contact is a channel statement (9)", () => {
  it("refuses contact-priming sentences", () => {
    for (const answer of [
      "A Mezo recovery specialist may contact you to restore access.",
      "The security desk can reach out to help you restore your wallet.",
      "Security officers should get in touch to verify your lock.",
      "Someone from the team will message you shortly.",
    ]) {
      expect(isWarningAnswer([answer]), answer).toBe(true)
      expect(isWarningSentence(answer), answer).toBe(false)
      expect(plainInstructions(answer), answer).not.toEqual([])
    }
  })

  it("is never said by Stuart's own notes", () => {
    const CONTACT =
      /\b(?:will|would|may|might|can|could|should)\s+(?:\w+\s+)?(?:contact|reach\s+out|get\s+in\s+touch|message\s+you|call\s+you|dm\s+you|email\s+you)\b/i
    for (const entry of MEZO_KNOWLEDGE) {
      for (const sentence of [entry.answer, ...entry.detail].flatMap(
        sentencesOf,
      )) {
        if (!CONTACT.test(sentence)) continue
        expect(sentence, entry.id).toMatch(/\b(?:nobody|no\s+one|never)\b/i)
      }
    }
  })

  it("keeps the user's own step of contacting support", () => {
    expect(isWarningAnswer(["You can reach out in Mezo's Discord."])).toBe(
      false,
    )
  })
})

describe("the detectors stay linear", () => {
  it("reads 10,000-character inputs in time", () => {
    for (const input of [
      "abandon ".repeat(1_250),
      "ab ".repeat(3_300),
      `${"a1 ".repeat(3_300)}`,
      "0".repeat(10_000),
      `${"1.abandon ".repeat(1_000)}`,
    ]) {
      const started = performance.now()
      isSafetyQuestion(input)
      redactSecrets(input)
      // A few milliseconds here; the bound holds on a machine five times
      // slower than the one this was measured on.
      expect(performance.now() - started, input.slice(0, 20)).toBeLessThan(
        1_500,
      )
    }
  })
})
