import type Anthropic from "@anthropic-ai/sdk"
import {
  stuartRequestSchema,
  supportReportSubmitSchema,
} from "@matchbox/stuart-ui/contract"
import { beforeEach, describe, expect, it } from "vitest"
import BIP39_WORDS from "./bip39Words"
import { resetClaudeBreaker, resetGrammarFallback } from "./claude"
import { type FakeCalls, fakeProviders, NOW, WALLET } from "./fakes"
import {
  isSafetyQuestion,
  MEZO_KNOWLEDGE,
  MEZO_KNOWLEDGE_VERSION,
  requiredSafetyNote,
} from "./knowledge/mezo"
import { runStuartQuery } from "./orchestrator"
import { IdScope } from "./outcome"
import { apiBlockscout } from "./providers/blockscout"
import { unavailableChainActivity } from "./providers/chainActivity"
import {
  type ApiFetcher,
  createFixtureReadModels,
} from "./providers/readModels"
import { redactSecrets } from "./redact"
import { routeQuery } from "./router"
import { searchQuery } from "./search"
import { listNeighbours, primePhraseChecksums } from "./secretShapes"
import { sentencesOf } from "./sourcedClaims"
import { resolveSubject } from "./subjects"
import { submitSupportReport } from "./supportReport"
import {
  fixedEntropies,
  phraseOfEntropy,
  seeded,
  seededPhrase,
  withTypo,
} from "./testPhrases"
import { draftSupportReportTool, HEX_REMOVED_NOTE } from "./tools/support"

// The re-check of the safety follow-ups (19 Nov 2026): one blocker and
// the follow-ups it found, each with the re-check's own messages.
// Disclosure to another system is conservative (when unsure, do not send,
// do redact); routing may be precise.

/** Obviously fake 64-hex: never a real key. */
const HEX = "0123456789abcdef".repeat(4)
const KEY = `0x${HEX}`
const GROUPS = (HEX.match(/.{8}/g) ?? []).join(" ")
/** The first valid BIP-39 phrase (all-zero entropy): public, never funded. */
const ZERO_PHRASE = `${Array.from({ length: 11 }, () => "abandon").join(" ")} about`

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

/**
 * The API Worker binding, recording every request: Blockscout is read
 * through it (`/internal/blockscout/...`). It knows every transaction, so
 * a lookup, if one were made, would succeed.
 */
function recordingApi(urls: string[]): ApiFetcher {
  return {
    fetch: async (request) => {
      urls.push(request.url)
      const hash = /\/transactions\/(0x[0-9a-f]{64})$/.exec(request.url)?.[1]
      return new Response(JSON.stringify({ hash: hash ?? "" }), {
        status: 200,
      })
    },
  }
}

type Recorder = { urls: string[]; calls: FakeCalls }

function recorder(): Recorder {
  return { urls: [], calls: { counts: {} } }
}

function providersFor(record: Recorder) {
  return fakeProviders(
    { blockscout: apiBlockscout(recordingApi(record.urls), "end-user") },
    record.calls,
  )
}

function ask(
  query: string,
  record: Recorder,
  create: ReturnType<typeof scripted> | null = null,
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
      providers: providersFor(record),
      secret: "test-secret",
      now: () => NOW,
      claude: create
        ? { create, model: "claude-opus-5-5", effort: "low" }
        : null,
      log: () => {},
      routerOff: create !== null,
    },
  )
}

/** The support tool run directly, as the model would call it. */
async function drafted(
  query: string,
  record: Recorder,
  verified?: ReadonlySet<string>,
) {
  const outcome = await draftSupportReportTool.execute(
    {
      providers: providersFor(record),
      wallet: { address: WALLET, mode: "connected", label: "Main" },
      query,
      choice: null,
      now: () => NOW,
      secret: "test-secret",
      scope: new IdScope("c1"),
      ...(verified === undefined ? {} : { verified }),
    },
    { problem: query, kind: null },
  )
  if ("invalid" in outcome) throw new Error(outcome.invalid)
  const block = outcome.blocks[0]
  if (block?.type !== "support_report_preview") throw new Error("no preview")
  return block.draft
}

/** What a submitted draft stores, the user's edit included. */
async function stored(
  draft: Awaited<ReturnType<typeof drafted>>,
  edit: string,
): Promise<string> {
  let body = ""
  await submitSupportReport({
    body: supportReportSubmitSchema.parse({
      version: 1,
      draft,
      problemStatement: edit,
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
        body = String(init?.body)
        return new Response(JSON.stringify("SR-7F3A19"), { status: 200 })
      },
    },
  })
  return body
}

beforeEach(() => {
  resetClaudeBreaker()
  resetGrammarFallback()
})

describe("1: a support draft sends nothing the user typed anywhere", () => {
  const REPORTS = [
    `report a problem: tx failed, key: ${KEY}`,
    `report a problem: tx failed, I used key ${KEY}`,
    `report a problem: tx failed, pk ${KEY}`,
    `report a problem: tx failed, privkey ${KEY}`,
    `report a problem: tx failed, priv key ${KEY}`,
    `report a problem: transaction failed from wallet ${KEY}`,
    `report a problem: tx failed, account ${KEY}`,
    `report a problem: explorer shows nothing for ${KEY}`,
    `report a problem: hash ${KEY} from my metamask export`,
    `report a problem: tx ${GROUPS} failed`,
    `report a problem: https://matchbox.markets/block/${KEY} is wrong`,
    `report a problem: https://mezo.org/borrow/markets/${KEY} shows nothing`,
    `report a problem: https://matchbox.markets/borrow/enclaves/${KEY} is empty`,
    `report a problem: https://pro.matchbox.markets/pools/mezo/${KEY} is stale`,
    `report a problem: https://explorer.mezo.org/tx/${KEY} failed`,
    `report a problem: https://claim-mezo.xyz/mezo.org/tx/${KEY} failed`,
    `report a problem: my claim tx ${KEY} reverted`,
  ]

  it("makes no outbound request when the router drafts the report", async () => {
    for (const query of REPORTS) {
      const record = recorder()
      const response = await ask(query, record)
      expect(record.urls, query).toEqual([])
      expect(record.calls.counts, query).toEqual({})
      expect(JSON.stringify(response), query).not.toContain(HEX)
    }
  })

  it("makes no outbound request when the model drafts it", async () => {
    for (const query of REPORTS) {
      const record = recorder()
      const response = await ask(
        query,
        record,
        scripted(
          [["draft_support_report", { problem: query, kind: null }]],
          "Your report is ready to review.",
        ),
      )
      expect(record.urls, query).toEqual([])
      expect(record.calls.counts, query).toEqual({})
      expect(JSON.stringify(response), query).not.toContain(HEX)
    }
  })

  it("redacts every typed 64-hex value, says so, and signing follows redaction", async () => {
    for (const query of REPORTS) {
      const record = recorder()
      const draft = await drafted(query, record)
      expect(record.urls, query).toEqual([])
      expect(JSON.stringify(draft), query).not.toContain(HEX)
      expect(draft.problemStatement, query).toContain(HEX_REMOVED_NOTE)
      // The redacted draft is what was signed: it submits, and a key
      // pasted again into the edited statement is not stored.
      const body = await stored(draft, `${draft.problemStatement} ${KEY}`)
      expect(body, query).not.toBe("")
      expect(body, query).not.toContain(HEX)
    }
  })

  it("keeps an id this turn's tools returned, through submit", async () => {
    const record = recorder()
    const query = `report a problem: my claim tx ${KEY} reverted`
    const draft = await drafted(query, record, new Set([KEY]))
    expect(record.urls).toEqual([])
    expect(draft.problemStatement).toContain(KEY)
    expect(draft.problemStatement).not.toContain(HEX_REMOVED_NOTE)
    expect(await stored(draft, `${draft.problemStatement} (edited)`)).toContain(
      KEY,
    )
  })
})

describe("1: no other request carries text that may hold a secret", () => {
  const SECRETS = [
    `my key ${KEY}`,
    `xxxxxxxxxxxxxxxxxxxx ${KEY}`,
    GROUPS,
    HEX.slice(0, 48),
    ZERO_PHRASE,
    ZERO_PHRASE.split(" ").slice(0, 9).join(" "),
  ]

  it("the Ctrl K search never sends one to the gauge directory", async () => {
    const asked: string[] = []
    const models = {
      ...createFixtureReadModels(),
      searchGauges: async (query: string) => {
        asked.push(query)
        return []
      },
    }
    for (const query of SECRETS) {
      const response = await searchQuery(query, models)
      expect(JSON.stringify(response), query).not.toContain(HEX.slice(0, 40))
    }
    expect(asked).toEqual([])
    // A whole pasted hash is answered with its Matchscan link and sent
    // nowhere (as on main): the user chooses whether to open it.
    expect((await searchQuery(KEY, models)).results[0]?.type).toBe(
      "transaction",
    )
    expect(asked).toEqual([])
    // Names and address prefixes are still searched.
    await searchQuery("SNF", models)
    await searchQuery("0x2ba614a598", models)
    expect(asked).toEqual(["SNF", "0x2ba614a598"])
  })

  it("a holder name is never sent to the label search when it may hold one", async () => {
    const asked: string[] = []
    const providers = fakeProviders({
      chain: {
        ...unavailableChainActivity,
        labelSearch: async (name: string) => {
          asked.push(name)
          return []
        },
      },
    })
    const wallet = {
      address: WALLET,
      mode: "connected",
      label: "Main",
    } as const
    for (const text of [HEX, `wallet ${HEX.slice(0, 50)}`, ZERO_PHRASE]) {
      await resolveSubject({ providers, wallet }, text)
    }
    expect(asked).toEqual([])
    await resolveSubject({ providers, wallet }, "Quiet Harbor Labs")
    expect(asked).toEqual(["Quiet Harbor Labs"])
  })
})

/** Routed to the safety notes, primed as runStuart primes. */
async function safety(query: string): Promise<boolean> {
  await primePhraseChecksums(query)
  return isSafetyQuestion(query)
}

/** How many of 40 seeded phrases of a case route to the safety notes. */
async function rate(
  length: number,
  questions: number,
  shape: (words: string[]) => string,
  typo: boolean,
  base: number,
): Promise<number> {
  let routed = 0
  for (let seed = base; seed < base + 40; seed += 1) {
    const phrase = await seededPhrase(length, questions, seed)
    const words = typo ? withTypo(phrase, seed) : phrase.words
    if (await safety(shape(words))) routed += 1
  }
  return routed
}

const alone = (words: string[]) => words.join(" ")
const leadIn = (words: string[]) => `my wallet won't open: ${words.join(" ")}`

describe("2: a real phrase routes with a typo or question words", () => {
  it("routes 40 of 40 phrases with one typo and two question words", async () => {
    expect(await rate(12, 2, alone, true, 100)).toBe(40)
    expect(await rate(12, 2, leadIn, true, 200)).toBe(40)
    expect(await rate(24, 2, alone, true, 300)).toBe(40)
    expect(await rate(12, 3, alone, true, 400)).toBe(40)
  })

  it("routes 40 of 40 valid phrases with four question words, the whole message", async () => {
    expect(await rate(12, 4, alone, false, 500)).toBe(40)
    expect(await rate(12, 4, leadIn, false, 600)).toBe(40)
    expect(await rate(24, 4, alone, false, 700)).toBe(40)
  })

  it("routes the fixed-entropy phrases with one typo in any word", async () => {
    for (const bytes of [16, 32]) {
      for (const entropy of fixedEntropies(bytes)) {
        const words = await phraseOfEntropy(entropy)
        const random = seeded(bytes + (entropy[1] ?? 0))
        const at = Math.floor(random() * words.length)
        const typo = [...words]
        typo[at] = `${(words[at] ?? "").slice(0, -1)}q`
        expect(await safety(typo.join(" ")), typo.join(" ")).toBe(true)
      }
    }
  })

  it("reads list neighbours one edit away", () => {
    expect(listNeighbours("abandom")).toContain("abandon")
    expect(listNeighbours("abnadon")).toContain("abandon")
    expect(listNeighbours("abandn")).toContain("abandon")
    expect(listNeighbours("abanddon")).toContain("abandon")
  })

  it("keeps the questions of the last round as questions", async () => {
    for (const query of [
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
    ]) {
      expect(await safety(query), query).toBe(false)
    }
  })
})

describe("6: a checksum is read only on a phrase standing as its own run", () => {
  const QUESTION =
    "please check total reward balance price fee next month average token gauge pool vote"

  it("keeps a question of list words a question", async () => {
    expect(await safety(QUESTION)).toBe(false)
    const decision = routeQuery(QUESTION, NOW)
    expect(decision.kind === "tool" ? decision.tool : decision.kind).not.toBe(
      "mezo_knowledge",
    )
  })

  it("keeps a 2,000-character message of list-word sentences a question, quickly", async () => {
    const prose = `${QUESTION}. `.repeat(30).slice(0, 2_000)
    const glued = `${QUESTION} `.repeat(30).slice(0, 2_000)
    // Twelve-word sentences of list words, one word in each mistyped: the
    // most checksums a message this long can ask for.
    const typos = (
      await Promise.all(
        Array.from({ length: 26 }, async (_, seed) =>
          withTypo(await seededPhrase(12, 3, 900 + seed), seed).join(" "),
        ),
      )
    )
      .join(". ")
      .slice(0, 2_000)
    for (const text of [prose, glued]) {
      expect(await safety(text)).toBe(false)
    }
    const started = performance.now()
    for (const text of [prose, glued, typos]) {
      await primePhraseChecksums(text)
      isSafetyQuestion(text)
      redactSecrets(text)
    }
    // Tens of milliseconds here; the bound holds on a machine five times
    // slower than the one this was measured on.
    expect(performance.now() - started).toBeLessThan(1_500)
  })

  it("checks a phrase that follows a long run of words", async () => {
    // A question word in every five: ordinary text, but every window of
    // it may have its checksum read, which once used up a cap of 64.
    const prose = "check total reward this balance ".repeat(55).trimEnd()
    expect(await safety(prose)).toBe(false)
    const phrase = await seededPhrase(12, 2, 1_000)
    for (const join of [". ", " (2026) "]) {
      const text = `${prose}${join}${phrase.words.join(" ")}`
      expect(text.length).toBeGreaterThan(1_800)
      expect(await safety(text), join).toBe(true)
    }
  })

  it("never reads a window across a full stop", async () => {
    // A valid phrase cut by a sentence end: five words close one sentence,
    // seven open the next. Neither sentence stands as a phrase.
    for (let seed = 1_100; seed < 1_120; seed += 1) {
      const phrase = await seededPhrase(12, 2, seed)
      const random = seeded(seed)
      const filler = () =>
        Array.from({ length: 3 }, () =>
          random() < 0.5 ? "please check" : "next total",
        ).join(" ")
      const text = `${filler()} ${phrase.words.slice(0, 5).join(" ")}. ${phrase.words.slice(5).join(" ")} ${filler()}`
      expect(await safety(text), text).toBe(false)
    }
  })
})

describe("7: an id link counts only on the project's own hosts", () => {
  it("reads ids in Matchbox and Mezo links on their id routes", () => {
    for (const query of [
      `https://scan.matchbox.markets/tx/${KEY}`,
      `scan.matchbox.markets/tx/${KEY}`,
      `https://explorer.mezo.org/tx/${KEY}`,
      `https://pro.matchbox.markets/pools/mezo/${KEY}`,
      `see (https://matchbox.markets/borrow/markets/${KEY})`,
      `https://mezo.org/block/${KEY}/`,
    ]) {
      expect(isSafetyQuestion(query), query).toBe(false)
    }
  })

  it("reads a hex in any other link as a key", () => {
    for (const query of [
      `https://claim-mezo.xyz/mezo.org/tx/${KEY}`,
      `claim-mezo.xyz/scan.matchbox.markets/tx/${KEY}`,
      `https://scan.matchbox.markets.claim-mezo.xyz/tx/${KEY}`,
      `https://mezo.org@claim-mezo.xyz/tx/${KEY}`,
      `https://user@scan.matchbox.markets/tx/${KEY}`,
      `https://scan.matchbox.markets:8443/tx/${KEY}`,
      `https://claim-mezo.xyz@scan.matchbox.markets/tx/${KEY}`,
      `ftp://scan.matchbox.markets/tx/${KEY}`,
      `https://scan.matchbox.markets/address/${KEY}`,
      `https://claim-mezo.xyz/?next=https://mezo.org/tx/${KEY}`,
    ]) {
      expect(isSafetyQuestion(query), query).toBe(true)
      expect(redactSecrets(query).text, query).not.toContain(HEX)
    }
  })
})

describe("8: a place is a scam's only when the message ties the action to it", () => {
  it("never reads the project's own domains, or a source of information, as one", () => {
    for (const [query, tool] of [
      [
        "someone said the docs at https://mezo.org/docs explain it, relock my veBTC",
        null,
      ],
      [
        "he said coingecko.com shows BTC is up, claim my rewards",
        "prepare_claim",
      ],
      [
        "a mod said scan.matchbox.markets has the receipts, claim my rewards",
        "prepare_claim",
      ],
    ] as const) {
      expect(requiredSafetyNote(query), query).not.toBe("safety.redirect")
      const decision = routeQuery(query, NOW)
      const routed = decision.kind === "tool" ? decision.tool : decision.kind
      expect(routed, query).not.toBe("mezo_knowledge")
      if (tool !== null) expect(routed, query).toBe(tool)
    }
  })

  it("keeps the redirect note where the action is tied to a place", () => {
    for (const query of [
      "a guy in telegram said claim at mezo-rewards.xyz, claim my rewards",
      "a mod said rewards are at claim-mezo.app",
      "someone sent me a link to claim",
      "someone sent me a link to claim-mezo.app",
      "support told me to vote on https://mezo-vote.xyz",
      "he said connect your wallet to mezo-claims.app, then claim",
      "the admin says https://claim-mezo.xyz is where to claim",
      "someone said relock through veBTC-migrate.io",
      "a mod said https://claim-mezo.xyz/mezo.org to claim",
      "the team said rewards moved to mezo.org.claims-v2.xyz, claim",
    ]) {
      expect(requiredSafetyNote(query), query).toBe("safety.redirect")
    }
  })
})

describe("9: the cheap gaps", () => {
  const ZERO = ZERO_PHRASE.split(" ")

  it("reads a key split by three spaces, tabs or a dash, in routing and redaction", () => {
    for (const query of [
      `my key is ${HEX.slice(0, 32)}   ${HEX.slice(32)}`,
      `${HEX.slice(0, 32)}\t\t\t${HEX.slice(32)}`,
      `${HEX.slice(0, 32)}-${HEX.slice(32)}`,
      `0x${HEX.slice(0, 32)} - ${HEX.slice(32)}`,
    ]) {
      expect(isSafetyQuestion(query), query).toBe(true)
      for (const mode of ["log", "report"] as const) {
        const out = redactSecrets(query, { mode }).text
        expect(out, query).not.toContain(HEX.slice(0, 32))
        expect(out, query).not.toContain(HEX.slice(32))
      }
    }
  })

  it("reads a phrase separated by slashes, in routing and redaction", async () => {
    const seededWords = (await seededPhrase(12, 2, 1_200)).words
    for (const query of [
      ZERO.join("/"),
      ZERO.join(" / "),
      seededWords.join("/"),
    ]) {
      expect(await safety(query), query).toBe(true)
      for (const mode of ["log", "report"] as const) {
        expect(redactSecrets(query, { mode }).text, query).toBe(
          "[redacted:word_phrase]",
        )
      }
    }
  })

  it("routes funds gone after a signature to the drained note, with no claim card", async () => {
    for (const query of [
      "my funds are gone after I signed a permit, claim my rewards",
      "my vault was drained after I approved a contract",
      "all my tokens were taken right after I connected to a site",
    ]) {
      expect(requiredSafetyNote(query), query).toBe("safety.drained")
      const response = await ask(query, recorder())
      expect(response.answer.text, query).toMatch(/^Treat a wallet/)
      expect(response.proposedActions, query).toEqual([])
    }
    for (const query of [
      "my rewards are gone after the epoch flip, claim them",
      "my funds are missing from the dashboard, is the indexer down?",
    ]) {
      expect(requiredSafetyNote(query), query).not.toBe("safety.drained")
    }
  })

  it("treats a phrase kept online as exposed", () => {
    for (const query of [
      "I backed up my seed phrase to icloud",
      "I backed up my seed phrase to iCloud Drive",
      "I saved my recovery phrase in google drive",
      "I stored my seed phrase in dropbox",
      "I saved my seed phrase in my notes app",
      "I emailed my seed phrase to myself",
      "I saved my recovery words in an email draft",
      "I took a screenshot of my seed phrase",
      "my seed phrase was synced to the cloud",
    ]) {
      expect(requiredSafetyNote(query), query).toBe("safety.secrets")
    }
  })

  it("tells the user a person they know who holds the phrase controls the funds", async () => {
    for (const query of [
      "I gave my recovery phrase to my wife",
      "I told my brother my seed phrase",
      "my dad has my seed phrase",
      "I gave my seed phrase to my lawyer to keep in his safe",
    ]) {
      expect(requiredSafetyNote(query), query).toBe("safety.phrase_holder")
      const response = await ask(query, recorder())
      expect(response.answer.text, query).toMatch(
        /^Anyone who has your recovery phrase controls the funds/,
      )
    }
    // A backup on paper or in a safe stays a plain question.
    for (const query of [
      "I wrote down my seed phrase on paper, is that ok?",
      "I put my seed phrase in a safe",
    ]) {
      expect(requiredSafetyNote(query), query).toBeNull()
    }
    // Someone the user does not name as their own is a disclosure.
    expect(
      requiredSafetyNote("I gave my seed phrase to a guy on discord"),
    ).toBe("safety.secrets")
  })
})

describe("10: a report's free text keeps prose and redacts a phrase", () => {
  // Twelve or more words of 3 to 8 letters, four of them not BIP-39 words
  // ("indexer", "totals", "monday", "refresh"), no secret named.
  const PROSE =
    "indexer shows wrong claim totals since monday morning after every single page refresh"
  const LISTED = (words: string[]) =>
    words.filter((word) => BIP39_WORDS.has(word.toLowerCase())).length

  it("keeps a run with four or more unlisted words in a report, as intended", () => {
    const words = PROSE.split(" ")
    expect(words.length).toBeGreaterThanOrEqual(12)
    expect(words.length - LISTED(words)).toBeGreaterThanOrEqual(4)
    expect(redactSecrets(PROSE, { mode: "report" }).text).toBe(PROSE)
    // A log line still loses it: there the rule is any 12 short words.
    expect(redactSecrets(PROSE).text).toBe("[redacted:word_phrase]")
  })

  it("redacts any run with nine BIP-39 words in some twelve, however written", () => {
    const nine = [
      ...ZERO_PHRASE.split(" ").slice(0, 4),
      "indexer",
      ...ZERO_PHRASE.split(" ").slice(4, 7),
      "totals",
      "Ability",
      "absent",
      "refresh",
    ]
    expect(LISTED(nine)).toBe(9)
    // Eight listed words among prose words is still prose.
    const eight = [
      "since",
      "after",
      "every",
      ...nine.slice(3, 9),
      "monday",
      ...nine.slice(10),
    ]
    for (const join of [" ", ", ", "/", "\n", " - "]) {
      const text = `the claim failed: ${nine.join(join)} and nothing else`
      expect(redactSecrets(text, { mode: "report" }).text, join).not.toMatch(
        /abandon|ability/i,
      )
      expect(redactSecrets(eight.join(join), { mode: "report" }).text).toBe(
        eight.join(join),
      )
    }
  })

  it("redacts a run that is not prose: another language's list, or four typos", () => {
    const italian =
      "abaco abbaglio abbinato abete abisso abolire abrasivo abrogato accadere accenno accusato acetone"
    const czech =
      "abdikace abeceda adresa agrese akce aktovka alej alkohol amputace ananas andulka anekdota"
    const typos = ZERO_PHRASE.split(" ")
      .map((word, index) => (index % 3 === 0 ? `${word.slice(0, -1)}x` : word))
      .join(" ")
    for (const phrase of [italian, czech, typos]) {
      expect(redactSecrets(phrase, { mode: "report" }).text).toBe(
        "[redacted:word_phrase]",
      )
      expect(
        redactSecrets(`report a problem: ${phrase}`, { mode: "report" }).text,
      ).not.toContain(phrase.split(" ")[5])
    }
  })

  it("keeps such a run out of the draft and the edited statement", async () => {
    const italian =
      "abaco abbaglio abbinato abete abisso abolire abrasivo abrogato accadere accenno accusato acetone"
    const draft = await drafted(`report a problem: ${italian}`, recorder())
    expect(JSON.stringify(draft)).not.toContain("abbaglio")
    const plain = await drafted("report a problem: my claim failed", recorder())
    expect(await stored(plain, `it broke. ${italian}`)).not.toContain(
      "abbaglio",
    )
  })

  it("applies the same rule to the edited statement on submit", async () => {
    const draft = await drafted("report a problem: my claim failed", recorder())
    const nine = [
      ...ZERO_PHRASE.split(" ").slice(0, 9),
      "indexer",
      "totals",
      "refresh",
    ].join(" ")
    // Separated by a date, the prose is its own run and stays.
    const body = await stored(draft, `${PROSE} on 19-11-2026, then ${nine}`)
    expect(body).toContain(PROSE)
    expect(body).not.toContain("abandon")
    // Run on into the phrase, it goes with it: redaction is conservative.
    const joined = await stored(draft, `${PROSE}. Also: ${nine}`)
    expect(joined).not.toContain("abandon")
    expect(joined).not.toContain(PROSE)
  })
})

describe("3, 4, 5: the safety notes, each sentence on its own", () => {
  const NOTES = [
    "safety.drained",
    "safety.redirect",
    "safety.secrets",
    "safety.phrase_holder",
  ]
  const sentences = (id: string) => {
    const entry = MEZO_KNOWLEDGE.find((each) => each.id === id)
    if (entry === undefined) throw new Error(id)
    return sentencesOf([entry.answer, ...entry.detail].join(" "))
  }

  it("names no site but the project's own, and sends no one to contact anyone", () => {
    for (const id of NOTES) {
      for (const sentence of sentences(id)) {
        for (const domain of sentence.match(
          /\b[a-z0-9-]+(?:\.[a-z0-9-]+)+\b/gi,
        ) ?? []) {
          expect(["matchbox.markets", "mezo.org"], sentence).toContain(domain)
        }
        expect(sentence, sentence).not.toMatch(
          /\brevoke\.|revoke\s+(?:site|tool)/i,
        )
        if (/\b(?:contact|ask|reach|message|dm)\b/i.test(sentence)) {
          expect(sentence, sentence).toMatch(
            /(?:you open yourself|open a ticket yourself)|never ask|DM you first/,
          )
        }
      }
    }
  })

  it("says what the re-check asked for", () => {
    const drained = sentences("safety.drained").join(" ")
    expect(drained).toContain("a new wallet with a new recovery phrase")
    expect(drained).toContain("not a new account in the same wallet")
    expect(drained).toContain("No one can recover drained funds for a fee")
    expect(drained).toContain("gas sent to that wallet can be taken")
    expect(drained).not.toMatch(/until then/)
    const redirect = sentences("safety.redirect").join(" ")
    expect(redirect).toContain(
      "Rewards do not move because someone messages you.",
    )
    expect(redirect).not.toMatch(/known Mezo contracts|in Matchbox\b/)
    expect(sentences("safety.secrets").join(" ")).not.toContain(
      "Mezo support takes questions",
    )
    expect(MEZO_KNOWLEDGE_VERSION).toMatch(/^2026-11-19\.5\+/)
  })
})

describe("1: a key labelled as one routes to the safety notes", () => {
  it("reads key, pk, privkey, an export or a 64-hex wallet as a key, beside tx words too", () => {
    for (const query of [
      `report a problem: tx failed, key: ${KEY}`,
      `report a problem: tx failed, I used key ${KEY}`,
      `report a problem: tx failed, pk ${KEY}`,
      `report a problem: tx failed, privkey ${KEY}`,
      `report a problem: tx failed, priv key ${KEY}`,
      `report a problem: transaction failed from wallet ${KEY}`,
      `report a problem: tx failed, account ${KEY}`,
      `report a problem: hash ${KEY} from my metamask export`,
    ]) {
      expect(isSafetyQuestion(query), query).toBe(true)
    }
    for (const query of [
      `report a problem: my claim tx ${KEY} reverted`,
      `what happened in tx ${KEY}`,
      `https://scan.matchbox.markets/tx/${KEY}`,
    ]) {
      expect(isSafetyQuestion(query), query).toBe(false)
    }
  })
})
