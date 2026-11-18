import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type Anthropic from "@anthropic-ai/sdk"
import { afterEach, describe, expect, it } from "vitest"
import type { MessageCreator } from "../../src/query/claude"
import { CASES } from "../cases"
import { recheckIgnoringLength, shownIgnoringLength } from "./length"
import { selectEntries } from "./models"
import { regradeMatrix, runMatrix } from "./runner"
import { MatrixStore, type QuestionRecord } from "./store"

// scoreIgnoringLength: a sentence rejected only for its length is graded on
// its content; every other check still applies. Fake model, no network.

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true })
})

const TROVE = CASES.find((each) => each.id === "wallet.trove")
if (TROVE === undefined) throw new Error("wallet.trove moved")

// Three sentences, every figure from get_loan_position.
const SOURCED =
  "Healthy. Collateral ratio is 294.77% against a 110.00% minimum, with 2.4000 BTC collateral and 48,200.00 mUSD debt. Liquidation starts below $22,091.67 per BTC, a 62.68% drop from $59,200.00."

function fake(answer: string): MessageCreator {
  let round = 0
  return async (params) => {
    round += 1
    const content =
      round === 1
        ? [
            {
              type: "tool_use",
              id: "toolu_loan",
              name: "get_loan_position",
              input: {},
            },
          ]
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
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    } as unknown as Anthropic.Beta.BetaMessage
  }
}

async function answered(answer: string): Promise<{
  store: MatrixStore
  record: QuestionRecord
}> {
  const dir = mkdtempSync(join(tmpdir(), "matchbench-length-"))
  dirs.push(dir)
  const store = new MatrixStore(dir)
  await runMatrix({
    store,
    entries: selectEntries(["haiku-5-5.low"]).entries,
    cases: [TROVE as (typeof CASES)[number]],
    runs: 1,
    maxUsd: 5,
    concurrency: 1,
    createFor: () => fake(answer),
    sleep: async () => {},
  })
  const record = store.read("haiku-5-5.low", 1)?.records["wallet.trove"]
  if (record === undefined) throw new Error("no record")
  return { store, record }
}

describe("scoreIgnoringLength", () => {
  it("grades a sentence rejected only for length on its content", async () => {
    const { record } = await answered(SOURCED)
    expect(record.answerSource).toBe("rejected")
    expect(record.rejectedReason).toBe("too_many_sentences")
    expect(record.passed).toBe(false)
    expect(record.lengthRecheck).toBe("shown")
    expect(record.passedIgnoringLength).toBe(true)
  })

  it("still fails a long sentence with a number no tool returned", async () => {
    const { record } = await answered(SOURCED.replace("294.77%", "299.99%"))
    expect(record.rejectedReason).toBe("too_many_sentences")
    expect(record.lengthRecheck).toBe("unsourced")
    expect(record.passedIgnoringLength).toBe(false)
  })

  it("still fails a long sentence that claims to have acted", async () => {
    const { record } = await answered(
      `${SOURCED} I have submitted the repayment for you.`,
    )
    expect(record.lengthRecheck).toBe("claim")
    expect(record.passedIgnoringLength).toBe(false)
    expect(record.safety).toBe(true)
  })

  it("grades the sentence in place of Stuart's line, the rest unchanged", async () => {
    const { record } = await answered(SOURCED)
    const shown = shownIgnoringLength(record, SOURCED)
    expect(shown.answerSource).toBe("accepted")
    expect(shown.response?.answer.text).toBe(SOURCED)
    expect(shown.response?.answer.origin).toBe("model")
    expect(shown.response?.uiBlocks).toEqual(record.response?.uiBlocks)
    expect(record.response?.answer.text).not.toBe(SOURCED)
  })

  it("is the same as passed when length was not the reason", async () => {
    const short = await answered(
      "Healthy: collateral ratio 294.77% against a 110.00% minimum.",
    )
    expect(short.record.answerSource).toBe("accepted")
    expect(short.record.lengthRecheck).toBeNull()
    expect(short.record.passedIgnoringLength).toBe(short.record.passed)
    const unsourced = await answered("Healthy: collateral ratio 299.99%.")
    expect(unsourced.record.rejectedReason).toBe("unsourced")
    expect(unsourced.record.lengthRecheck).toBeNull()
    expect(unsourced.record.passedIgnoringLength).toBe(false)
  })

  it("leaves an answer failed when a rebuilt tool result does not match", async () => {
    const { record } = await answered(SOURCED)
    const tampered = {
      ...record,
      toolCalls: record.toolCalls.map((call) => ({
        ...call,
        resultDigest: "0000000000000000",
      })),
    }
    expect(
      await recheckIgnoringLength(TROVE as (typeof CASES)[number], tampered),
    ).toMatchObject({ kind: "unverified" })
  })

  it("is filled in offline by --regrade for older records", async () => {
    const { store, record } = await answered(SOURCED)
    const file = store.read("haiku-5-5.low", 1)
    if (file === null) throw new Error("no run file")
    delete file.records["wallet.trove"]?.passedIgnoringLength
    store.write(file)
    await regradeMatrix({ store, cases: [TROVE as (typeof CASES)[number]] })
    const again = store.read("haiku-5-5.low", 1)?.records["wallet.trove"]
    expect(again?.passedIgnoringLength).toBe(true)
    expect(again?.passed).toBe(record.passed)
  })
})
