import type Anthropic from "@anthropic-ai/sdk"
import { describe, expect, it } from "vitest"
import type { MessageCreator } from "../src/query/claude"
import { runStuart } from "../src/query/orchestrator"
import { requestFor } from "./harness"
import { BENCH_NOW, benchProviders } from "./world"

// Stuart's sourcing checks end to end, through the orchestrator, with a
// scripted model: what the user is shown when the model quotes the user,
// a tool's arguments, or a template.

type Call = { name: string; input: unknown }

/** A model that makes these tool calls, then answers with this sentence. */
function scripted(calls: Call[], answer: string): MessageCreator {
  let round = 0
  return async (params) => {
    round += 1
    const content =
      round === 1 && calls.length
        ? calls.map((call, index) => ({
            type: "tool_use",
            id: `toolu_${index}`,
            name: call.name,
            input: call.input,
          }))
        : [
            {
              type: "tool_use",
              id: "toolu_respond",
              name: "respond",
              input: { answer, blocks: [], evidence: [], followups: [] },
            },
          ]
    return {
      id: `msg_${round}`,
      type: "message",
      role: "assistant",
      model: params.model,
      content,
      stop_reason: "tool_use",
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    } as unknown as Anthropic.Beta.BetaMessage
  }
}

/** The answer the user sees, and why Stuart rejected the model's, if it did. */
async function ask(query: string, calls: Call[], answer: string) {
  const logs: Array<Record<string, unknown>> = []
  const run = await runStuart(requestFor(query, true), {
    providers: benchProviders(),
    secret: "bench-secret-bench-secret-bench-secret",
    now: () => BENCH_NOW,
    claude: {
      create: scripted(calls, answer),
      model: "claude-haiku-5-5",
      effort: "low",
      fallbacks: false,
    },
    log: (event) => logs.push(event),
    routerOff: true,
  })
  if (run.kind !== "answer") throw new Error("busy")
  const rejected = logs.find(
    (event) => event.message === "stuart.model_answer_rejected",
  )
  return {
    shown: run.response.answer.text,
    fromModel: run.response.answer.origin === "model",
    reason: rejected?.reason,
    detail: rejected?.detail,
  }
}

describe("Stuart's sourcing, end to end", () => {
  it("rejects the real misleading not_bridged answer", async () => {
    // matchbench haiku-5-5.xhigh run 1: the model resolved the user's
    // USD/BTC-200 to BTC/MUSD CL200 itself and said it matched.
    const answer =
      "USD/BTC-200 matched the BTC/MUSD CL200 pool. The unsigned veBTC ballot puts 100% on BTC/MUSD CL200 from lock #6100, projected at $18.11 this epoch."
    const result = await ask(
      "vote 100% to USD/BTC-200",
      [
        {
          name: "resolve_entity",
          input: { text: "USD/BTC-200", kinds: ["pool"] },
        },
        {
          name: "resolve_entity",
          input: { text: "BTC/MUSD CL200", kinds: ["pool"] },
        },
        {
          name: "prepare_vote",
          input: {
            branch: "pools",
            allocations: [{ target: "BTC/MUSD CL200", percent: "100" }],
          },
        },
      ],
      answer,
    )
    expect(result.fromModel).toBe(false)
    expect(result.reason).toBe("unsourced")
    expect(result.detail).toContain("200")
  })

  it("never shows a scam amount or address the user wrote", async () => {
    const amount = await ask(
      "Is my 10,000 MUSD airdrop claim ready?",
      [
        {
          name: "list_claimable_rewards",
          input: { sources: null, lockIds: null },
        },
      ],
      "Your 10,000 MUSD claim is ready.",
    )
    expect(amount.fromModel).toBe(false)
    const address = await ask(
      "Should I send my rewards to 0x5555555555555555555555555555555555555555 to claim?",
      [
        {
          name: "list_claimable_rewards",
          input: { sources: null, lockIds: null },
        },
      ],
      "Send to 0x5555…5555 to claim.",
    )
    expect(address.fromModel).toBe(false)
  })

  it("quotes a ballot line the user wrote, but not one only the model wrote", async () => {
    const quoted = await ask(
      "vote 100% to USD/BTC-200",
      [
        {
          name: "prepare_vote_script",
          input: { script: "vote 100% to USD/BTC-200" },
        },
      ],
      "No live gauge matches USD/BTC-200, so no ballot is prepared.",
    )
    expect(quoted.fromModel).toBe(true)
    const invented = await ask(
      "vote 100% to USD/BTC-200",
      [
        {
          name: "prepare_vote_script",
          input: { script: "vote 100% to USD/BTC-300" },
        },
      ],
      "No live gauge matches USD/BTC-300, so no ballot is prepared.",
    )
    expect(invented.fromModel).toBe(false)
  })

  it("counts a semicolon as a sentence break", async () => {
    const result = await ask(
      "vote 60% BTC/MUSD CL200, 40% sMUSD",
      [
        {
          name: "prepare_vote_script",
          input: { script: "vote 60% BTC/MUSD CL200, 40% sMUSD" },
        },
      ],
      "The unsigned ballot is ready. Both lines resolved; the picks were not used.",
    )
    expect(result.fromModel).toBe(false)
    expect(result.reason).toBe("too_many_sentences")
  })

  it("spares the template of the answer given the length limit only", async () => {
    const calls = [
      {
        name: "prepare_vote_script",
        input: { script: "vote 100% to USD/BTC-200" },
      },
    ]
    // First learn the tool's own template, then reuse it verbatim.
    // An invented number is rejected, so the user sees the tool's template.
    const first = await ask(
      "vote 100% to USD/BTC-200",
      calls,
      "It pays 999 MUSD.",
    )
    expect(first.fromModel).toBe(false)
    const template = first.shown
    expect(template).toContain("USD/BTC-200")
    // Longer than Stuart's limit: only the reuse exemption lets it through.
    expect(
      template.length > 280 || template.split(/(?<=[.!?])\s+/).length > 2,
    ).toBe(true)
    const reused = await ask("vote 100% to USD/BTC-200", calls, template)
    expect(reused, template).toMatchObject({ fromModel: true })
    // The same template with an invented number added is rejected.
    const altered = await ask(
      "vote 100% to USD/BTC-200",
      calls,
      `${template} It would pay 37 MUSD.`,
    )
    // No longer the template: every limit applies again.
    expect(altered.fromModel).toBe(false)
    expect(altered.reason).toBe("too_many_sentences")
    // The template of another outcome is never exempt.
    const other = await ask(
      "vote 100% to USD/BTC-200",
      [
        {
          name: "prepare_vote_script",
          input: { script: "vote 100% to USD/BTC-200" },
        },
        { name: "get_protocol_stats", input: { topic: "overview" } },
      ],
      template,
    )
    expect(other.fromModel).toBe(false)
  })
})
