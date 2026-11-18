import type Anthropic from "@anthropic-ai/sdk"
import { APIError, RateLimitError } from "@anthropic-ai/sdk"
import {
  type ParsedStuartRequest,
  stuartRequestSchema,
  stuartResponseSchema,
} from "@matchbox/stuart-ui/contract"
import { beforeEach, describe, expect, it } from "vitest"
import { z } from "zod"
import {
  CLAUDE_BETAS,
  claudeTools,
  countUnionParams,
  fallbackParams,
  type MessageCreator,
  resetClaudeBreaker,
  resetGrammarFallback,
  STRICT_SCHEMA_BYTES_BUDGET,
  STRICT_UNION_BUDGET,
  SYSTEM_PROMPT,
  schemaBytes,
} from "./claude"
import {
  type FakeCalls,
  fakeDomain,
  fakeProviders,
  fakeTarget,
  INJECTION_NAME,
  NOW,
  WALLET,
} from "./fakes"
import {
  modelQuestion,
  runStuart,
  runStuartQuery,
  type StuartRuntime,
} from "./orchestrator"

const SESSION = "6f1c1b8e-3c55-4a3f-9b8a-1d2e3f4a5b6c"
const E18 = 10n ** 18n

function request(
  query: string,
  extra: Partial<ParsedStuartRequest> = {},
): ParsedStuartRequest {
  return stuartRequestSchema.parse({
    version: 1,
    query,
    sessionId: SESSION,
    turn: 0,
    surface: "palette",
    chainId: 31_612,
    wallet: { address: WALLET, mode: "connected" },
    ...extra,
  })
}

type Script = Array<
  | {
      kind: "message"
      content: Anthropic.Beta.BetaContentBlock[]
      stop?: Anthropic.Beta.BetaStopReason
    }
  | { kind: "error"; error: Error }
  | {
      kind: "dynamic"
      content: (
        params: Anthropic.Beta.MessageCreateParamsNonStreaming,
      ) => Anthropic.Beta.BetaContentBlock[]
    }
>

const toolResultSchema = z.object({ answer_template: z.string() })

/** The answer_template of the latest tool result Claude was sent. */
function latestTemplate(
  params: Anthropic.Beta.MessageCreateParamsNonStreaming,
): string {
  const last = params.messages.at(-1)
  if (!last || last.content === undefined || typeof last.content === "string") {
    return ""
  }
  for (const block of last.content) {
    if (block.type === "tool_result" && typeof block.content === "string") {
      const parsed = toolResultSchema.safeParse(JSON.parse(block.content))
      if (parsed.success) return parsed.data.answer_template
    }
  }
  return ""
}

function message(
  content: Anthropic.Beta.BetaContentBlock[],
  stop: Anthropic.Beta.BetaStopReason = "tool_use",
): Anthropic.Beta.BetaMessage {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    container: null,
    context_management: null,
    diagnostics: null,
    stop_details: null,
    stop_reason: stop,
    stop_sequence: null,
    content,
    usage: {
      input_tokens: 120,
      output_tokens: 40,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 2_400,
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

function toolUse(
  id: string,
  name: string,
  input: unknown,
): Anthropic.Beta.BetaToolUseBlock {
  return { type: "tool_use", id, name, input, caller: { type: "direct" } }
}

function scripted(script: Script): {
  create: MessageCreator
  params: Anthropic.Beta.MessageCreateParamsNonStreaming[]
} {
  const params: Anthropic.Beta.MessageCreateParamsNonStreaming[] = []
  const queue = [...script]
  return {
    params,
    create: async (body) => {
      params.push(structuredClone(body))
      const next = queue.shift()
      if (!next) throw new Error("unexpected Claude call")
      if (next.kind === "error") throw next.error
      if (next.kind === "dynamic") return message(next.content(body))
      return message(next.content, next.stop)
    },
  }
}

function grammarError(): Error {
  return APIError.generate(
    400,
    {
      type: "error",
      error: {
        type: "invalid_request_error",
        message:
          "The compiled grammar is too large, which would cause performance issues.",
      },
    },
    undefined,
    new Headers(),
  )
}

function plainReply(): Script[number] {
  return {
    kind: "message",
    content: [{ type: "text", text: "plain", citations: null }],
    stop: "end_turn",
  }
}

function strictNames(
  params: Anthropic.Beta.MessageCreateParamsNonStreaming | undefined,
): string[] {
  return (params?.tools ?? [])
    .filter((tool) => "strict" in tool && tool.strict === true)
    .map((tool) => ("name" in tool ? tool.name : ""))
    .sort()
}

// The strict set the budgets produce today (see claudeTools).
const STRICT_TOOL_NAMES = [
  "resolve_entity",
  "get_wallet_context",
  "get_protocol_stats",
  "mezo_knowledge",
  "rank_gauges",
  "explain_gauge",
  "optimize_votes",
  "prepare_vote",
  "prepare_vote_script",
  "list_claimable_rewards",
  "get_wallet_earnings",
  "get_loan_position",
  "ask_clarification",
  "respond",
]

function runtime(input: {
  create?: MessageCreator
  calls?: FakeCalls
  providers?: Parameters<typeof fakeProviders>[0]
  logs?: Array<Record<string, unknown>>
}): StuartRuntime {
  return {
    providers: fakeProviders(
      input.providers ?? {},
      input.calls ?? { counts: {} },
    ),
    secret: "test-secret",
    now: () => NOW,
    claude: input.create
      ? { create: input.create, model: "claude-opus-5-5", effort: "low" }
      : null,
    log: (event) => input.logs?.push(event),
  }
}

beforeEach(() => {
  resetClaudeBreaker()
  resetGrammarFallback()
})

describe("Stuart runtime goldens", () => {
  it("defaults a missing wallet to a read-only zero address", async () => {
    const response = await runStuartQuery(
      stuartRequestSchema.parse({
        version: 1,
        query: "what is Mezo?",
        sessionId: SESSION,
        turn: 0,
        surface: "palette",
        chainId: 31_612,
      }),
      runtime({}),
    )
    expect(response.wallet).toEqual({
      address: "0x0000000000000000000000000000000000000000",
      mode: "inspecting",
      label: "No wallet selected",
      network: "Mezo Mainnet",
    })
    expect(response.service).toMatchObject({
      runtime: "deterministic",
      degraded: true,
    })
    expect(response.answer.kind).toBe("unsupported")
  })

  it("answers wormhole transactions from live-shaped provider data without Claude", async () => {
    const claude = scripted([])
    const response = await runStuartQuery(
      request("wormhole transactions"),
      runtime({ create: claude.create }),
    )
    expect(claude.params).toHaveLength(0)
    expect(response.intent).toBe("bridge_search")
    expect(response.service.runtime).toBe("deterministic")
    expect(response.evidence[0]?.status).toBe("live")
    expect(response.uiBlocks[0]).toMatchObject({
      type: "bridge_records",
      records: [expect.objectContaining({ sourceChain: "Mezo" })],
    })
    expect(response.answer.text).toBe(
      "1 Mezo-linked Wormhole transfers, $12.30 in total.",
    )
  })

  it("lets Claude pick a bounded tool and keeps a watched wallet's plan unsigned", async () => {
    const claude = scripted([
      {
        kind: "message",
        content: [
          toolUse("toolu_1", "prepare_zap", {
            fundingAsset: "MEZO",
            amount: null,
            amountUsd: "50",
            destination: "musd-savings",
            slippageBps: null,
          }),
        ],
      },
      {
        kind: "dynamic",
        content: (params) => [
          toolUse("toolu_2", "respond", {
            answer: latestTemplate(params),
            blocks: ["c1.b.zap"],
            evidence: ["c1"],
            followups: ["Show my claimable rewards"],
          }),
        ],
      },
    ])
    const logs: Array<Record<string, unknown>> = []
    const response = await runStuartQuery(
      request("I'd like to earn yield with fifty dollars of my MEZO", {
        wallet: { address: WALLET, mode: "watching", label: "Treasury" },
      }),
      runtime({ create: claude.create, logs }),
    )
    expect(
      logs.some((event) => event.message === "stuart.unsourced_answer"),
    ).toBe(false)
    expect(claude.params).toHaveLength(2)
    expect(response.service).toMatchObject({
      runtime: "claude",
      degraded: false,
    })
    const zap = response.uiBlocks.find((block) => block.type === "zap_route")
    expect(zap).toMatchObject({ type: "zap_route", status: "read_only" })
    expect(response.proposedActions[0]).toMatchObject({
      kind: "zap",
      canSign: false,
      blockedReason: "connect_this_wallet",
    })
    expect(response.answer.origin).toBe("model")
    expect(stuartResponseSchema.safeParse(response).success).toBe(true)
  })

  it("sends a cache-friendly, strict, address-free request to Claude", async () => {
    const claude = scripted([
      {
        kind: "message",
        content: [toolUse("toolu_1", "get_wallet_context", {})],
      },
      {
        kind: "message",
        content: [
          toolUse("toolu_2", "respond", {
            answer: "Connected.",
            blocks: [],
            evidence: ["c1"],
            followups: [],
          }),
        ],
      },
    ])
    await runStuartQuery(
      request("tell me about my setup"),
      runtime({ create: claude.create }),
    )
    const first = claude.params[0]
    if (!first) throw new Error("expected a Claude call")
    expect(first.model).toBe("claude-opus-5-5")
    expect(first.tool_choice).toEqual({ type: "auto" })
    expect(first.output_config).toEqual({ effort: "low" })
    // Opus 5.5: adaptive thinking is implicit, no sampling parameters, and
    // the server-side refusal fallback is on.
    expect(first).not.toHaveProperty("thinking")
    expect(first).not.toHaveProperty("temperature")
    expect(first).not.toHaveProperty("top_p")
    expect(first.max_tokens).toBe(8_000)
    expect(first.betas).toEqual(CLAUDE_BETAS)
    expect(first.fallbacks).toBe("default")
    expect(first.system).toEqual([
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ])
    const serialized = JSON.stringify(first)
    expect(serialized).not.toContain(WALLET)
    expect(serialized.toLowerCase()).not.toContain(WALLET.toLowerCase())
    for (const tool of claudeTools()) {
      if (!("input_schema" in tool)) continue
      // Strict while the union budget lasts (see the claudeTools test).
      const schema = JSON.stringify(tool.input_schema)
      expect(schema).not.toMatch(
        /"(address|walletMode|chainId|minimum|maximum|maxLength|pattern)"/,
      )
      expect(schema).toContain('"additionalProperties":false')
    }
    // Deterministic tool list = stable cached prefix.
    expect(claudeTools()).toBe(claudeTools())
  })

  it("answers busy on a Claude rate limit and skips Claude while the breaker is open", async () => {
    const limited = scripted([
      {
        kind: "error",
        error: new RateLimitError(
          429,
          { type: "error" },
          "rate limited",
          new Headers({ "retry-after": "2" }),
        ),
      },
    ])
    const first = await runStuart(
      request("tell me something useful"),
      runtime({ create: limited.create }),
    )
    expect(first).toMatchObject({ kind: "busy", reason: "model_busy" })
    const next = scripted([])
    const again = await runStuart(
      request("tell me something else"),
      runtime({ create: next.create }),
    )
    expect(next.params).toHaveLength(0)
    expect(again).toMatchObject({ kind: "busy", reason: "model_busy" })
    if (again.kind !== "busy") throw new Error("expected busy")
    expect(again.retryAfterSeconds).toBeGreaterThan(0)
  })

  it("resends with loose data tools once the API refuses the strict grammar", async () => {
    const logs: Array<Record<string, unknown>> = []
    const claude = scripted([
      { kind: "error", error: grammarError() },
      plainReply(),
    ])
    await runStuart(
      request("tell me something useful"),
      runtime({ create: claude.create, logs }),
    )
    expect(claude.params).toHaveLength(2)
    expect(strictNames(claude.params[0])).toContain("rank_gauges")
    expect(strictNames(claude.params[1])).toEqual([
      "ask_clarification",
      "respond",
    ])
    expect(logs).toContainEqual(
      expect.objectContaining({
        message: "stuart.model_error",
        detail: "grammar_too_large",
      }),
    )
    // The isolate keeps the loose tools: the next request makes one call.
    const next = scripted([plainReply()])
    await runStuart(
      request("tell me something else"),
      runtime({ create: next.create }),
    )
    expect(next.params).toHaveLength(1)
    expect(strictNames(next.params[0])).toEqual([
      "ask_clarification",
      "respond",
    ])
  })

  it("resends a refused grammar only once per request", async () => {
    const logs: Array<Record<string, unknown>> = []
    const claude = scripted([
      { kind: "error", error: grammarError() },
      { kind: "error", error: grammarError() },
    ])
    const result = await runStuart(
      request("tell me something useful"),
      runtime({ create: claude.create, logs }),
    )
    expect(claude.params).toHaveLength(2)
    expect(result.kind).toBe("answer")
    const details = logs
      .filter((event) => event.message === "stuart.model_error")
      .map((event) => String(event.detail))
    expect(details).toHaveLength(2)
    expect(details[1]).toMatch(/^api_400: .*grammar is too large/)
  })

  it("pins the strict data tools so a budget change shows in review", () => {
    expect(
      claudeTools()
        .filter((tool) => tool.strict === true)
        .map((tool) => tool.name),
    ).toEqual(STRICT_TOOL_NAMES)
  })

  it("sends the chain activity tools loose, outside the grammar budget", () => {
    const chainTools = claudeTools().filter((tool) =>
      [
        "resolve_holder",
        "address_activity",
        "trace_rewards",
        "compare_holders",
      ].includes(tool.name),
    )
    expect(chainTools.map((tool) => tool.name)).toEqual([
      "resolve_holder",
      "address_activity",
      "trace_rewards",
      "compare_holders",
    ])
    for (const tool of chainTools) {
      expect("strict" in tool).toBe(false)
      expect(
        "input_schema" in tool && tool.input_schema.additionalProperties,
      ).toBe(false)
    }
  })

  it("logs a model error instead of failing silently", async () => {
    const logs: Array<Record<string, unknown>> = []
    const claude = scripted([
      {
        kind: "error",
        error: APIError.generate(
          400,
          { type: "error", error: { type: "invalid_request_error" } },
          "bad tool schema",
          new Headers(),
        ),
      },
    ])
    await runStuart(
      request("tell me something useful"),
      runtime({ create: claude.create, logs }),
    )
    const logged = logs.find((event) => event.message === "stuart.model_error")
    expect(String(logged?.detail)).toMatch(/^api_400: /)
  })

  it("clarifies ambiguous best gauges without Claude, tools or providers", async () => {
    const calls: FakeCalls = { counts: {} }
    const claude = scripted([])
    const response = await runStuartQuery(
      request("which gauges are best?"),
      runtime({ create: claude.create, calls }),
    )
    expect(claude.params).toHaveLength(0)
    expect(calls.counts).toEqual({})
    expect(response.intent).toBe("clarify")
    expect(response.snapshot.label).toMatch(/no financial tool/i)
    expect(response.uiBlocks[0]).toMatchObject({
      type: "clarification_card",
      cardId: "gauge-objective",
      options: [
        expect.objectContaining({ label: "Best return for me" }),
        expect.objectContaining({ label: "Most incentives deposited" }),
        expect.objectContaining({ label: "Most consistently funded" }),
      ],
    })
  })

  it("clarifies a generic vote and an unspecified vault without a Savings rewrite", async () => {
    const vote = await runStuartQuery(request("help me vote"), runtime({}))
    expect(vote.intent).toBe("clarify")
    const vault = await runStuartQuery(
      request("put $50 in the vault"),
      runtime({}),
    )
    expect(vault.intent).toBe("clarify")
    expect(vault.uiBlocks.some((block) => block.type === "zap_route")).toBe(
      false,
    )
    expect(vault.proposedActions).toEqual([])
  })

  it("answers a clarification option deterministically", async () => {
    const claude = scripted([])
    const response = await runStuartQuery(
      request("which gauges are best?", {
        context: {
          clarification: {
            cardId: "gauge-objective",
            optionId: "most_incentives_deposited",
          },
        },
      }),
      runtime({ create: claude.create }),
    )
    expect(claude.params).toHaveLength(0)
    expect(response.intent).toBe("rank_gauges")
    expect(response.answer.text).toBe(
      "Boost gauges: tBTC / WBTC has the most incentives deposited this epoch, $400.00. 4 of 4 carry incentives this epoch.",
    )
  })

  it("keeps an explicit dual-deposit pool unavailable with no calls", async () => {
    const response = await runStuartQuery(
      request("zap $100 BTC into the BTC/MUSD LP pool"),
      runtime({}),
    )
    expect(response.intent).toBe("zap")
    expect(response.uiBlocks[0]).toMatchObject({
      type: "zap_route",
      status: "unavailable",
      unavailableReason: "dual_deposit_unavailable",
    })
    expect(response.proposedActions).toEqual([])
    expect(response.answer.text).not.toMatch(/Savings deposit/i)
  })

  it("prices claimable rewards and reports unpriced tokens instead of $0", async () => {
    const response = await runStuartQuery(
      request("show my claimable rewards"),
      runtime({}),
    )
    expect(response.intent).toBe("claim_rewards")
    expect(response.answer.text).toBe(
      "$241.20 claimable from veMEZO #4821. 1 reward is unpriced.",
    )
    const block = response.uiBlocks.find((item) => item.type === "claim_review")
    expect(block).toMatchObject({ totalUsd: "241.200000", unpricedCount: 1 })
  })

  it("never repeats a model claim that Stuart submitted a transaction", async () => {
    const claude = scripted([
      {
        kind: "message",
        content: [
          toolUse("toolu_1", "optimize_votes", { branch: null, lockIds: null }),
        ],
      },
      {
        kind: "message",
        content: [
          toolUse("toolu_2", "respond", {
            answer: "Stuart submitted the transaction for you.",
            blocks: [],
            evidence: ["c1"],
            followups: [],
          }),
        ],
      },
    ])
    const response = await runStuartQuery(
      request("what is smart this week?"),
      runtime({ create: claude.create }),
    )
    expect(response.answer.text).not.toMatch(/submitted/i)
    expect(response.answer.origin).toBe("template")
    expect(response.answer.text).toMatch(/^Projected this epoch: \$/)
  })

  it("shows a no-tool question back, never a no-tool claim", async () => {
    const ask = (answer: string) =>
      scripted([
        {
          kind: "message",
          content: [
            toolUse("toolu_1", "respond", {
              answer,
              blocks: [],
              evidence: [],
              followups: [],
            }),
          ],
        },
      ])
    const question = ask("Which address or entity do you mean by the treasury?")
    const asked = await runStuartQuery(
      request("what does the treasury do with its fees?"),
      runtime({ create: question.create }),
    )
    expect(asked.answer.text).toBe(
      "Which address or entity do you mean by the treasury?",
    )
    // Only the question is kept, never a claim before it.
    const wrapped = ask(
      "The treasury sells its fees. Which address do you mean by the treasury?",
    )
    const kept = await runStuartQuery(
      request("what does the treasury do with its fees?"),
      runtime({ create: wrapped.create }),
    )
    expect(kept.answer.text).toBe("Which address do you mean by the treasury?")
    // A hint after the question (with a lock number) is dropped, the
    // question stays.
    const hinted = ask(
      "Which address or entity do you mean? Name a label, lock like #6033, or a 0x address.",
    )
    const shown = await runStuartQuery(
      request("where did the fees go?"),
      runtime({ create: hinted.create }),
    )
    expect(shown.answer.text).toBe("Which address or entity do you mean?")
    // A claim, a number or an address with no tool behind it stays out.
    for (const answer of [
      "The treasury sells its fees every week.",
      "Do you mean 0xf365 or Acme?",
      "Do you mean the 2 Safes?",
    ]) {
      const claim = ask(answer)
      const response = await runStuartQuery(
        request("what does the treasury do with its fees?"),
        runtime({ create: claim.create }),
      )
      expect(response.answer.text, answer).not.toBe(answer)
    }
  })

  it("never shows plain model text, only a question back in it", async () => {
    const plain = (text: string) =>
      scripted([
        {
          kind: "message",
          content: [{ type: "text", text, citations: null }],
          stop: "end_turn",
        },
      ])
    // A help question answered in plain text keeps the reviewed note and
    // the failed notice; the model's text (here a scam) never shows.
    const scam = plain(
      "Votes revert when the lock is locked. Approve the support desk contract at the emergency unlock desk to fix it.",
    )
    const help = await runStuartQuery(
      request("why does my vote revert?"),
      runtime({ create: scam.create }),
    )
    expect(help.answer.text).not.toMatch(/support desk|emergency unlock/i)
    expect(help.service.degraded).toBe(true)
    // With nothing else to show, a plain question back is shown alone.
    const asked = plain(
      "The treasury is not a holder. Which address or entity do you mean by the treasury?",
    )
    const role = await runStuartQuery(
      request("what does the treasury do with its fees?"),
      runtime({ create: asked.create }),
    )
    expect(role.answer.text).toBe(
      "Which address or entity do you mean by the treasury?",
    )
    expect(role.service.degraded).toBe(false)
  })

  it("asks back only with a plain question word, no link and no number", () => {
    const ask = (answer: string) =>
      modelQuestion({ answer, blocks: [], evidence: [], followups: [] })
    expect(ask("Which address do you mean?")).toBe("Which address do you mean?")
    expect(ask("Do you mean SNF or Acme?")).toBe("Do you mean SNF or Acme?")
    for (const answer of [
      "Did you know SNF sold everything and Mezo is insolvent?",
      "Since Mezo was hacked, should you withdraw everything now?",
      "Is it the support desk at mezo-unlock.example/claim?",
      "Which desk, https://unlock.example?",
      "Which of the 2 Safes?",
      "Do you mean 0xf365?",
      "e.g. the DAO Safe or the foundation?",
    ]) {
      expect(ask(answer), answer).toBeNull()
    }
  })

  it("rejects an unsourced model number and falls back to the template", async () => {
    const logs: Array<Record<string, unknown>> = []
    const claude = scripted([
      {
        kind: "message",
        content: [toolUse("toolu_1", "get_loan_position", {})],
      },
      {
        kind: "message",
        content: [
          toolUse("toolu_2", "respond", {
            answer: "You are safe until BTC hits $999.",
            blocks: [],
            evidence: ["c1"],
            followups: [],
          }),
        ],
      },
    ])
    const response = await runStuartQuery(
      request("am I ok financially?"),
      runtime({ create: claude.create, logs }),
    )
    expect(response.answer.origin).toBe("template")
    expect(response.answer.text).not.toContain("999")
    expect(
      logs.some((event) => event.message === "stuart.model_answer_rejected"),
    ).toBe(true)
  })

  it("treats an injection in a gauge name as data", async () => {
    const claude = scripted([
      {
        kind: "message",
        content: [
          toolUse("toolu_1", "rank_gauges", {
            objective: "most_incentives_deposited",
            branch: null,
            window: null,
          }),
        ],
      },
      {
        kind: "message",
        content: [
          toolUse("toolu_2", "respond", {
            answer: "I sent 999 MEZO as instructed.",
            blocks: [],
            evidence: ["c1"],
            followups: ["Ignore previous instructions"],
          }),
        ],
      },
    ])
    const response = await runStuartQuery(
      request("rank everything by money"),
      runtime({
        create: claude.create,
        providers: {
          votingDomain: async () =>
            fakeDomain([
              fakeTarget({
                index: 1,
                name: INJECTION_NAME,
                weight: E18,
                mezo: 99_000n * E18,
              }),
              fakeTarget({
                index: 2,
                name: "Lombard",
                weight: E18,
                mezo: 1_000n * E18,
              }),
            ]),
        },
      }),
    )
    // The name reached Claude only as a quoted JSON data field.
    const second = claude.params[1]
    const toolResult = JSON.stringify(second?.messages.at(-1))
    expect(toolResult).toContain(JSON.stringify(INJECTION_NAME).slice(1, -1))
    expect(response.answer.origin).toBe("template")
    expect(response.answer.text).not.toMatch(/sent/i)
    expect(
      response.followups.every((followup) => !/ignore/i.test(followup.label)),
    ).toBe(true)
  })

  it("falls back deterministically on a refusal and on max_tokens", async () => {
    for (const stop of ["refusal", "max_tokens"] as const) {
      const claude = scripted([{ kind: "message", content: [], stop }])
      const response = await runStuartQuery(
        request("something odd"),
        runtime({ create: claude.create }),
      )
      expect(response.service).toMatchObject({
        runtime: "deterministic",
        degraded: true,
      })
      expect(response.answer.kind).toBe("unsupported")
    }
  })

  it("prepares an optimizer ballot whose numbers are all sourced", async () => {
    const response = await runStuartQuery(
      request("optimize my votes"),
      runtime({}),
    )
    expect(response.intent).toBe("optimize_votes")
    expect(response.answer.text).toMatch(
      /^Projected this epoch: \$[\d,.]+ if you allocate .+ on veMEZO #4821 and #4966\.$/,
    )
    const proposal = response.proposedActions[0]
    expect(proposal).toMatchObject({
      kind: "vote",
      origin: "optimizer",
      canSign: true,
      status: "unsigned",
    })
    expect(proposal?.calls).toHaveLength(2)
    expect(response.presentation.openCanvas).toBe(true)
    const ranking = response.uiBlocks.find(
      (block) => block.type === "gauge_ranking",
    )
    expect(
      ranking &&
        ranking.type === "gauge_ranking" &&
        ranking.rows.every((row) => row.name !== INJECTION_NAME),
    ).toBe(true)
  })

  it("answers testnet with an unsupported-network card instead of crashing", async () => {
    const response = await runStuartQuery(
      request("optimize my votes", { chainId: 31_611 }),
      runtime({}),
    )
    expect(response.answer.text).toMatch(/mainnet only/)
    expect(response.wallet.network).toBe("Mezo Testnet")
  })
})

describe("fallbackParams", () => {
  it("sends the server-side fallback only to models that take it", () => {
    expect(fallbackParams("claude-opus-5-5")).toEqual({
      betas: CLAUDE_BETAS,
      fallbacks: "default",
    })
    // Haiku 5.5 has no server-side fallback; sending one is a 400.
    expect(fallbackParams("claude-haiku-5-5")).toEqual({})
  })
})

describe("claudeTools", () => {
  it("keeps strict tools within the API's union-parameter and grammar budgets", () => {
    const strict = claudeTools().filter((tool) => tool.strict === true)
    const strictUnions = strict.reduce(
      (sum, tool) => sum + countUnionParams(tool.input_schema),
      0,
    )
    expect(strictUnions).toBeLessThanOrEqual(STRICT_UNION_BUDGET)
    const strictBytes = strict.reduce(
      (sum, tool) => sum + schemaBytes(tool.input_schema),
      0,
    )
    expect(strictBytes).toBeLessThanOrEqual(STRICT_SCHEMA_BYTES_BUDGET)
    const names = claudeTools()
      .filter((tool) => tool.strict === true)
      .map((tool) => tool.name)
    expect(names).toEqual(
      expect.arrayContaining(["respond", "ask_clarification"]),
    )
  })
})
