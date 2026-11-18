import type Anthropic from "@anthropic-ai/sdk"
import { stuartRequestSchema } from "@matchbox/stuart-ui/contract"
import { describe, expect, it } from "vitest"
import { BENCH_NOW, BENCH_WALLET, benchProviders } from "../../bench/world"
import { type MessageCreator, resetClaudeBreaker } from "./claude"
import { runStuart } from "./orchestrator"

// A ballot line counts as the user's own words only when it is a whole
// ballot target of the user's message and its digits belong to the name.
// The vote script is the model's own tool argument: the model must never
// turn a piece of the user's text into a "line" and so source its numbers.

function message(
  round: number,
  content: unknown[],
): Anthropic.Beta.BetaMessage {
  return {
    id: `msg_${round}`,
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5-5",
    content,
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  } as unknown as Anthropic.Beta.BetaMessage
}

/** The model sends a vote script, then answers. */
function model(script: string, answer: string): MessageCreator {
  let round = 0
  return async () => {
    round += 1
    return round === 1
      ? message(round, [
          {
            type: "tool_use",
            id: "toolu_script",
            name: "prepare_vote_script",
            input: { script },
          },
        ])
      : message(round, [
          {
            type: "tool_use",
            id: "toolu_respond",
            name: "respond",
            input: { answer, blocks: [], evidence: [], followups: [] },
          },
        ])
  }
}

async function ask(query: string, script: string, answer: string) {
  const logs: Array<Record<string, unknown>> = []
  resetClaudeBreaker()
  const run = await runStuart(
    stuartRequestSchema.parse({
      version: 1,
      query,
      sessionId: "6f1c1b8e-3c55-4a3f-9b8a-1d2e3f4a5b6c",
      turn: 0,
      surface: "rail",
      chainId: 31_612,
      wallet: { address: BENCH_WALLET, mode: "connected" },
    }),
    {
      providers: benchProviders(),
      secret: "test-secret-test-secret-test-secret-00",
      now: () => BENCH_NOW,
      claude: {
        create: model(script, answer),
        model: "claude-sonnet-5-5",
        effort: "low",
      },
      log: (event) => logs.push(event),
      routerOff: true,
    },
  )
  if (run.kind !== "answer") throw new Error("busy")
  const rejected = logs.find(
    (event) => event.message === "stuart.model_answer_rejected",
  )
  return { response: run.response, rejected }
}

describe("ballot lines as the user wrote them, end to end", () => {
  it("never turns the user's sentence into a line", async () => {
    const { response, rejected } = await ask(
      "Your 10000 MUSD claim is ready",
      "100% to Your 10000 MUSD claim is ready",
      "Your 10000 MUSD claim is ready.",
    )
    // Stuart's own line is shown, never the model's sentence.
    expect(response.answer.origin).toBe("template")
    expect(response.answer.text).not.toBe("Your 10000 MUSD claim is ready.")
    expect(rejected).toMatchObject({ reason: "unsourced", detail: ["10000"] })
  })

  it("never turns a piece of the user's text into a line", async () => {
    const { response, rejected } = await ask(
      "I hold 7 BTC in my wallet. vote 100% to BTC/MUSD-200",
      "100% to 7 BTC",
      "You hold 7 BTC.",
    )
    expect(response.answer.origin).toBe("template")
    expect(response.answer.text).not.toBe("You hold 7 BTC.")
    expect(rejected).toMatchObject({ reason: "unsourced", detail: ["7"] })
  })

  it("never sources an amount the user mentioned beside a ballot", async () => {
    const { response, rejected } = await ask(
      "they promised a $5000 bonus. vote 100% to BTC/MUSD-200",
      "100% to $5000 bonus",
      "Your $5000 bonus did not match a gauge.",
    )
    expect(response.answer.origin).toBe("template")
    expect(response.answer.text).not.toBe(
      "Your $5000 bonus did not match a gauge.",
    )
    expect(rejected).toMatchObject({ reason: "unsourced", detail: ["5000"] })
  })

  it("still quotes a whole line the user wrote", async () => {
    const { response, rejected } = await ask(
      "vote 100% to USD/BTC-200",
      "100% to USD/BTC-200",
      "USD/BTC-200 is not a live gauge, so there is no ballot.",
    )
    expect(rejected).toBeUndefined()
    expect(response.answer.origin).toBe("model")
    expect(response.answer.text).toBe(
      "USD/BTC-200 is not a live gauge, so there is no ballot.",
    )
  })

  it("never takes the end of the user's line as a line", async () => {
    const { response, rejected } = await ask(
      "vote 100% to USD/BTC-200",
      "100% to BTC-200",
      "BTC-200 is not a live gauge, so there is no ballot.",
    )
    expect(response.answer.origin).toBe("template")
    expect(rejected).toMatchObject({ reason: "unsourced", detail: ["200"] })
  })
})
