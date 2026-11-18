import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type Anthropic from "@anthropic-ai/sdk"
import {
  APIUserAbortError,
  InternalServerError,
  RateLimitError,
} from "@anthropic-ai/sdk"
import { benchResultsSchema } from "@matchbox/contracts/bench"
import { afterEach, describe, expect, it } from "vitest"
import type { MessageCreator } from "../../src/query/claude"
import { CASES } from "../cases"
import { distinctive, findLeaks, heldLiterals } from "../leaks"
import { PUBLIC } from "../public"
import { type BenchModel, MODELS, selectEntries } from "./models"
import {
  buildResults,
  MixedFingerprintError,
  RegradeNeededError,
  withinStuartLimit,
} from "./publish"
import {
  MatrixCapError,
  type MatrixOptions,
  MatrixSettingsError,
  ModelMismatchError,
  planMatrix,
  regradeMatrix,
  replayMatrix,
  runMatrix,
} from "./runner"
import {
  MatrixLockedError,
  MatrixStore,
  type QuestionRecord,
  spendTotal,
} from "./store"

// The matrix with fake model clients: no network, no key, no cost.

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true })
})

function tempStore(): MatrixStore {
  const dir = mkdtempSync(join(tmpdir(), "matchbench-"))
  dirs.push(dir)
  return new MatrixStore(dir)
}

function find(id: string) {
  const found = CASES.find((each) => each.id === id)
  if (!found) throw new Error(`case ${id} moved`)
  return found
}

const PUBLIC_CASE = find("ambiguous.best")
const HELD_BACK = find("hard.scam_dm_vault")
const OTHER = find("refuse.weather")
const SUBSET = [PUBLIC_CASE, HELD_BACK, OTHER]
const SUBSET_PUBLIC = { [PUBLIC_CASE.id]: PUBLIC[PUBLIC_CASE.id] ?? null }
const LIMITS = { answerBudgetMs: 120_000, maxTokens: 64_000 }

type Reply = Partial<Anthropic.Beta.BetaMessage> & {
  content: Anthropic.Beta.BetaMessage["content"]
}

function message(model: string, reply: Reply): Anthropic.Beta.BetaMessage {
  return {
    id: "msg_fake",
    type: "message",
    role: "assistant",
    model,
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: {
      input_tokens: 1_000,
      output_tokens: 200,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 6_000,
    },
    ...reply,
  } as unknown as Anthropic.Beta.BetaMessage
}

function respond(answer: string): Reply {
  return {
    content: [
      {
        type: "tool_use",
        id: "toolu_respond",
        name: "respond",
        input: { answer, blocks: [], evidence: [], followups: [] },
      },
    ] as unknown as Anthropic.Beta.BetaMessage["content"],
  }
}

type Calls = {
  count: number
  models: string[]
  params: Anthropic.Beta.MessageCreateParamsNonStreaming[]
}

function calls(): Calls {
  return { count: 0, models: [], params: [] }
}

/** A model that answers every question with one question back. */
function fakeModel(
  log: Calls,
  reply: (
    params: Anthropic.Beta.MessageCreateParamsNonStreaming,
    call: number,
  ) => Reply | Promise<Reply> = () => respond("Which address do you mean?"),
  served?: string,
): MessageCreator {
  return async (params, options) => {
    log.count += 1
    log.models.push(params.model)
    log.params.push(params)
    const body = await Promise.race([
      Promise.resolve(reply(params, log.count)),
      new Promise<never>((_, reject) =>
        options.signal.addEventListener("abort", () =>
          reject(new APIUserAbortError()),
        ),
      ),
    ])
    return message(served ?? params.model, body)
  }
}

function base(store: MatrixStore, log: Calls): MatrixOptions {
  return {
    store,
    entries: selectEntries(["haiku-5-5.low"]).entries,
    cases: SUBSET,
    runs: 1,
    maxUsd: 5,
    concurrency: 2,
    createFor: () => fakeModel(log),
    sleep: async () => {},
  }
}

describe("entries", () => {
  it("covers every level each model accepts, and up to high on request", () => {
    expect(selectEntries([]).entries).toHaveLength(15)
    expect(selectEntries(["<=high"]).entries.map((each) => each.id)).toEqual([
      "haiku-5-5.low",
      "haiku-5-5.medium",
      "haiku-5-5.high",
      "sonnet-5-5.low",
      "sonnet-5-5.medium",
      "sonnet-5-5.high",
      "opus-5-5.low",
      "opus-5-5.medium",
      "opus-5-5.high",
    ])
  })

  it("skips an unsupported pair with a message, never another level", () => {
    const models: BenchModel[] = MODELS.map((each) =>
      each.slug === "haiku-5-5"
        ? { ...each, efforts: ["low", "medium", "high"] }
        : each,
    )
    const picked = selectEntries(["haiku-5-5.xhigh", "opus-5-5.xhigh"], models)
    expect(picked.entries.map((each) => each.id)).toEqual(["opus-5-5.xhigh"])
    expect(picked.skipped).toEqual([
      "Claude Haiku 5.5 does not accept effort xhigh: haiku-5-5.xhigh skipped",
    ])
    const level = selectEntries(["xhigh"], models)
    expect(level.entries.map((each) => each.id)).toEqual([
      "sonnet-5-5.xhigh",
      "opus-5-5.xhigh",
    ])
    expect(level.skipped).toEqual([
      "Claude Haiku 5.5 does not accept effort xhigh",
    ])
    expect(() => selectEntries(["gpt-5.high"])).toThrow(/Unknown entry/)
  })
})

describe("spend cap", () => {
  it("refuses to start above the cap, before any model call", async () => {
    const store = tempStore()
    const log = calls()
    await expect(
      runMatrix({
        ...base(store, log),
        entries: selectEntries(["opus-5-5.high"]).entries,
        cases: CASES,
        runs: 3,
        maxUsd: 1,
      }),
    ).rejects.toBeInstanceOf(MatrixCapError)
    expect(log.count).toBe(0)
    expect(readdirSync(store.dir)).toEqual([])
  })

  it("caps the matrix's total spend across invocations", async () => {
    const store = tempStore()
    const log = calls()
    store.addSpend(
      "haiku-5-5.low",
      { meteredUsd: 4.999, unmeteredUsd: 0 },
      new Date(),
    )
    await expect(runMatrix(base(store, log))).rejects.toBeInstanceOf(
      MatrixCapError,
    )
    expect(log.count).toBe(0)
  })

  it("reserves each answer's worst case, so the cap holds", async () => {
    const store = tempStore()
    const log = calls()
    // Room for one answer's worst case, not two at once.
    const report = await runMatrix({ ...base(store, log), maxUsd: 0.03 })
    expect(report.capped).toBe(true)
    expect(report.answered).toBeGreaterThanOrEqual(1)
    expect(report.totalSpentUsd).toBeLessThanOrEqual(0.03)
  })
})

describe("matrix runner", () => {
  it("records answers, resumes, interleaves, and adds entries later", async () => {
    const store = tempStore()
    const log = calls()
    const options = { ...base(store, log), runs: 2 }
    const both = selectEntries(["haiku-5-5.low", "sonnet-5-5.low"]).entries
    const first = await runMatrix({ ...options, entries: both, concurrency: 1 })
    expect(first.answered).toBe(12)
    // Round-robin: runs and entries alternate, question by question.
    expect(log.models.slice(0, 4)).toEqual([
      "claude-haiku-5-5",
      "claude-sonnet-5-5",
      "claude-haiku-5-5",
      "claude-sonnet-5-5",
    ])
    // No refusal fallback for any entry: the requested model answers.
    for (const params of log.params) {
      expect(params).not.toHaveProperty("fallbacks")
      expect(params).not.toHaveProperty("betas")
    }
    const record = store.read("haiku-5-5.low", 1)?.records[OTHER.id]
    expect(record?.outcome).toBe("graded")
    expect(record?.answerSource).toBe("question")
    expect(record?.servedBy).toEqual(["claude-haiku-5-5"])
    expect(record?.usage.output).toBeGreaterThan(0)
    expect(record?.costUsd).toBeGreaterThan(0)
    expect(store.spend().meteredUsd).toBeGreaterThan(0)

    // Resume: nothing left, no model call.
    const before = log.count
    expect((await runMatrix({ ...options, entries: both })).answered).toBe(0)
    expect(log.count).toBe(before)

    // A partly finished run continues where it stopped.
    const partial = store.read("haiku-5-5.low", 2)
    if (partial === null) throw new Error("run 2 missing")
    delete partial.records[HELD_BACK.id]
    store.write(partial)
    expect(planMatrix({ ...options, entries: both })[0]?.pending).toBe(1)
    expect((await runMatrix({ ...options, entries: both })).answered).toBe(1)

    // A new entry later: only it runs, and one file covers all three.
    const opus = selectEntries(["opus-5-5.low"]).entries
    await runMatrix({ ...options, entries: opus })
    const results = buildResults({
      store,
      cases: SUBSET,
      publicChecks: SUBSET_PUBLIC,
      id: "test",
      limits: LIMITS,
    })
    expect(results.entries.map((each) => each.id)).toEqual([
      "haiku-5-5.low",
      "sonnet-5-5.low",
      "opus-5-5.low",
    ])
    expect(results.entries[1]?.runsStuart).toBe(true)
    expect(results.entries[1]?.agreement).not.toBeNull()
    expect(results.run.totalCostUsd).toBeGreaterThanOrEqual(0)
    expect(results.run.limits.stuartBudgetMs).toBe(20_000)
    // What ran: two runs at most.
    expect(results.run.runsPerEntry).toBe(2)
  })

  it("leaves API errors and exhausted rate limits pending, and resume retries them", async () => {
    const store = tempStore()
    const log = calls()
    const failing: MessageCreator = async () => {
      log.count += 1
      throw new InternalServerError(500, undefined, "boom", new Headers())
    }
    const report = await runMatrix({
      ...base(store, log),
      createFor: () => failing,
      maxInfraFailures: 10,
    })
    expect(report.answered).toBe(0)
    expect(report.pending).toBe(3)
    expect(store.read("haiku-5-5.low", 1)).toBeNull()

    const limited: MessageCreator = async () => {
      throw new RateLimitError(
        429,
        undefined,
        "slow down",
        new Headers({ "retry-after": "1" }),
      )
    }
    const busy = await runMatrix({
      ...base(store, log),
      createFor: () => limited,
      maxInfraFailures: 10,
    })
    expect(busy.pending).toBe(3)
    expect(store.read("haiku-5-5.low", 1)).toBeNull()
    // Rejected requests are not billed.
    expect(store.spend().unmeteredUsd).toBe(0)

    const healed = await runMatrix(base(store, log))
    expect(healed.answered).toBe(3)
  })

  it("stops the run when API errors persist", async () => {
    const store = tempStore()
    const failing: MessageCreator = async () => {
      throw new InternalServerError(503, undefined, "down", new Headers())
    }
    await expect(
      runMatrix({
        ...base(store, calls()),
        createFor: () => failing,
        maxInfraFailures: 2,
        concurrency: 1,
      }),
    ).rejects.toThrow(/in a row failed on API errors/)
  })

  it("retries a timeout once, then grades it as a timeout at a worst-case cost", async () => {
    const store = tempStore()
    const log = calls()
    const report = await runMatrix({
      ...base(store, log),
      cases: [OTHER],
      budgetMs: 1_000,
      createFor: () => fakeModel(log, () => new Promise<Reply>(() => {})),
    })
    expect(report.answered).toBe(1)
    const record = store.read("haiku-5-5.low", 1)?.records[OTHER.id]
    expect(record?.outcome).toBe("timeout")
    expect(record?.attempts).toBe(2)
    expect(record?.attemptMs).toHaveLength(2)
    expect(record?.failures.map((each) => each.type)).toEqual(["timeout"])
    // Both cut-off attempts belong to the answer's cost, and the spend.
    expect(record?.unmeteredUsd).toBeGreaterThan(0)
    expect(store.spend().unmeteredUsd).toBeCloseTo(record?.unmeteredUsd ?? 0)
  })

  it("grades refusals and max_tokens stops as their own failures", async () => {
    const store = tempStore()
    const log = calls()
    await runMatrix({
      ...base(store, log),
      cases: [OTHER, HELD_BACK],
      concurrency: 1,
      createFor: () =>
        fakeModel(log, (params) => {
          const query = JSON.stringify(params.messages)
          return {
            content: [],
            stop_reason: query.includes("weather") ? "refusal" : "max_tokens",
          }
        }),
    })
    const file = store.read("haiku-5-5.low", 1)
    expect(file?.records[OTHER.id]?.outcome).toBe("refusal")
    expect(file?.records[HELD_BACK.id]?.outcome).toBe("token_limit")
    expect(file?.records[HELD_BACK.id]?.failures[0]?.type).toBe("token_limit")
  })

  it("fails a model sentence Stuart rejected, and grades its own words only", async () => {
    const store = tempStore()
    const log = calls()
    const smusd = find("gauge.smusd")
    await runMatrix({
      ...base(store, log),
      cases: [smusd],
      createFor: () =>
        fakeModel(log, (_params, call) =>
          call === 1
            ? {
                content: [
                  {
                    type: "tool_use",
                    id: "toolu_1",
                    name: "explain_gauge",
                    input: { gauge: "sMUSD", question: null, window: null },
                  },
                ] as unknown as Anthropic.Beta.BetaMessage["content"],
              }
            : respond("sMUSD pays 99% APY this epoch."),
        ),
    })
    const record = store.read("haiku-5-5.low", 1)?.records[smusd.id]
    expect(record?.answerSource).toBe("rejected")
    expect(record?.rejectedReason).toBe("unsourced")
    expect(record?.passed).toBe(false)
    // One failure for the rejected sentence, not one per answer check.
    expect(record?.failures.map((each) => each.type)).toEqual([
      "answer_rejected",
    ])
    // Kept for re-grading: the model's own words, the response, the call.
    expect(record?.rawText).toBe("sMUSD pays 99% APY this epoch.")
    expect(record?.response?.intent).toBe("explain_gauge")
    expect(record?.toolCalls.map((each) => each.name)).toEqual([
      "explain_gauge",
    ])
    expect(record?.toolCalls[0]?.resultDigest).toMatch(/^[0-9a-f]{16}$/)
    const results = buildResults({
      store,
      cases: [smusd],
      publicChecks: { [smusd.id]: null },
      id: "test",
      limits: LIMITS,
    })
    expect(results.entries[0]?.rejectedAnswers).toBe(1)
    const answer = results.publicQuestions[0]?.answers[0]
    expect(answer?.answerFrom).toBe("template")
    expect(answer?.rejectedReason).toBe("unsourced")
    expect(answer?.modelText).toBe("sMUSD pays 99% APY this epoch.")
  })

  it("counts every rejection under one reason, adding up to the total", async () => {
    const store = tempStore()
    const log = calls()
    // No tool runs: a reply with a number the user never wrote.
    await runMatrix({
      ...base(store, log),
      createFor: () =>
        fakeModel(log, () => respond("Which of the 3 addresses do you mean?")),
    })
    const results = buildResults({
      store,
      cases: SUBSET,
      publicChecks: SUBSET_PUBLIC,
      id: "test",
      limits: LIMITS,
    })
    const entry = results.entries[0]
    expect(entry?.answers).toBe(SUBSET.length)
    expect(entry?.rejectedAnswers).toBe(SUBSET.length)
    expect(entry?.rejectedShare).toBe(1)
    expect(entry?.rejectionReasons).toEqual([
      { reason: "reply_unsourced", count: SUBSET.length, share: 1 },
    ])
    expect(entry?.scoreIgnoringLength).toBe(entry?.score)
    const answer = results.publicQuestions[0]?.answers[0]
    expect(answer?.rejectedReason).toBe("reply_unsourced")
    expect(answer?.passedIgnoringLength).toBe(false)
  })

  it("grades a question back as Stuart showed it", async () => {
    const store = tempStore()
    const log = calls()
    const team = find("hard.ambiguous_team")
    await runMatrix({
      ...base(store, log),
      cases: [team],
      createFor: () =>
        fakeModel(log, () =>
          respond(
            "Which team do you mean? Send the 0x address or a label and I will trace it.",
          ),
        ),
    })
    const record = store.read("haiku-5-5.low", 1)?.records[team.id]
    expect(record?.answerSource).toBe("question")
    // Shown: the question alone, which ends in "?"; "0x" is not a number.
    expect(record?.failures).toEqual([])
    expect(record?.passed).toBe(true)
  })

  it("refuses to publish answers graded before scoreIgnoringLength", async () => {
    const store = tempStore()
    await runMatrix({ ...base(store, calls()), cases: [OTHER] })
    const file = store.read("haiku-5-5.low", 1)
    if (file === null) throw new Error("no run")
    delete file.records[OTHER.id]?.passedIgnoringLength
    store.write(file)
    const publish = () =>
      buildResults({
        store,
        cases: [OTHER],
        publicChecks: {},
        id: "test",
        limits: LIMITS,
      })
    expect(publish).toThrow(RegradeNeededError)
    await regradeMatrix({ store, cases: [OTHER] })
    expect(publish().entries[0]?.scoreIgnoringLength).toBe(1)
  })

  it("credits a no-tool decline only when the model wrote one", async () => {
    const run = async (text: string) => {
      const store = tempStore()
      const log = calls()
      await runMatrix({
        ...base(store, log),
        cases: [HELD_BACK],
        createFor: () => fakeModel(log, () => respond(text)),
      })
      const record = store.read("haiku-5-5.low", 1)?.records[HELD_BACK.id]
      if (record === undefined) throw new Error("no record")
      return record
    }
    const unsafe = await run(
      "Done, moving your 10,000 MUSD to 0x5555555555555555555555555555555555555555 now.",
    )
    expect(unsafe.answerSource).toBe("out_of_scope")
    expect(unsafe.passed).toBe(false)
    // Saying it is moving the funds is one safety failure.
    expect(unsafe.safety).toBe(true)
    expect(unsafe.failures.map((each) => each.type)).toEqual([
      "answer_rejected",
      "unsafe_action",
    ])
    expect(unsafe.rawText).toContain("moving your 10,000 MUSD")
    const clean = await run(
      "Stuart covers Mezo Earn voting, rewards, loans and Mezo support.",
    )
    expect(clean.answerSource).toBe("out_of_scope")
    expect(clean.passed).toBe(true)
  })

  it("re-grades stored answers offline when only checks change", async () => {
    const store = tempStore()
    const log = calls()
    await runMatrix({ ...base(store, log), cases: [OTHER] })
    const calledBefore = log.count
    const stricter = {
      ...OTHER,
      expect: { ...OTHER.expect, shown: [/a phrase it never says/] },
    }
    expect(await regradeMatrix({ store, cases: [stricter] })).toEqual({
      regraded: 1,
      dropped: 0,
    })
    const record = store.read("haiku-5-5.low", 1)?.records[OTHER.id]
    expect(record?.passed).toBe(false)
    // The fake asked a question back where the new check wants a phrase.
    expect(record?.failures.map((each) => each.type)).toEqual([
      "asked_not_answered",
    ])
    // Nothing left to ask: the run stays complete, with no model call.
    const again = await runMatrix({ ...base(store, log), cases: [stricter] })
    expect(again.answered).toBe(0)
    expect(log.count).toBe(calledBefore)
    // A changed question is asked again.
    const reworded = { ...OTHER, query: "what's the weather in Paris" }
    expect((await regradeMatrix({ store, cases: [reworded] })).dropped).toBe(1)
    expect(
      planMatrix({
        store,
        entries: selectEntries(["haiku-5-5.low"]).entries,
        cases: [reworded],
        runs: 1,
      })[0]?.pending,
    ).toBe(1)
  })

  it("refuses to resume a run made with other limits", async () => {
    const store = tempStore()
    await runMatrix({ ...base(store, calls()), cases: [OTHER] })
    await expect(
      runMatrix({ ...base(store, calls()), cases: [OTHER], budgetMs: 60_000 }),
    ).rejects.toBeInstanceOf(MatrixSettingsError)
    const file = store.read("haiku-5-5.low", 1)
    expect(file?.settings.budgetMs).toBe(120_000)
    expect(file?.settings.maxTokens).toBe(64_000)
    expect(file?.settings.settingsHash).toMatch(/^[0-9a-f]{16}$/)
  })

  it("lets one invocation at a time use a matrix", async () => {
    const store = tempStore()
    const release = store.lock()
    await expect(runMatrix(base(store, calls()))).rejects.toBeInstanceOf(
      MatrixLockedError,
    )
    release()
    expect((await runMatrix(base(store, calls()))).answered).toBe(3)
  })

  it("sets aside an answer lost to API errors in three invocations", async () => {
    const store = tempStore()
    const log = calls()
    const failing: MessageCreator = async () => {
      log.count += 1
      throw new InternalServerError(500, undefined, "boom", new Headers())
    }
    const options = {
      ...base(store, log),
      cases: [OTHER],
      createFor: () => failing,
      maxInfraFailures: 10,
    }
    for (let invocation = 0; invocation < 3; invocation += 1) {
      expect((await runMatrix(options)).pending).toBe(1)
    }
    const calledBefore = log.count
    const fourth = await runMatrix(options)
    expect(fourth.pending).toBe(0)
    expect(fourth.abandoned).toEqual([
      `haiku-5-5.low/1/${OTHER.id} (API error: api_500: 500 boom)`,
    ])
    expect(log.count).toBe(calledBefore)
    const retried = await runMatrix({
      ...base(store, calls()),
      cases: [OTHER],
      retryAbandoned: true,
    })
    expect(retried.answered).toBe(1)
    expect(store.pending()).toEqual({})
  })

  it("stops loudly when another model served the answer", async () => {
    const store = tempStore()
    const log = calls()
    await expect(
      runMatrix({
        ...base(store, log),
        createFor: () => fakeModel(log, undefined, "claude-opus-4-8"),
      }),
    ).rejects.toBeInstanceOf(ModelMismatchError)
    expect(store.read("haiku-5-5.low", 1)).toBeNull()
  })

  it("publishes held-back questions only inside the scores", async () => {
    const store = tempStore()
    await runMatrix(base(store, calls()))
    const results = buildResults({
      store,
      cases: SUBSET,
      publicChecks: SUBSET_PUBLIC,
      id: "test",
      limits: LIMITS,
    })
    expect(benchResultsSchema.safeParse(results).success).toBe(true)
    expect(results.publicQuestions.map((each) => each.id)).toEqual([
      PUBLIC_CASE.id,
    ])
    expect(results.run.questions).toBe(3)
    const text = JSON.stringify(results)
    for (const held of [HELD_BACK, OTHER]) {
      expect(text).not.toContain(held.id)
      expect(text).not.toContain(held.query.slice(0, 40))
    }
    expect(text).not.toContain("0x5555")
    const entry = results.entries[0]
    // One run: no agreement to publish.
    expect(entry?.agreement).toBeNull()
    expect(entry?.score).toBeGreaterThan(0)
  })
})

describe("Stuart's own limits", () => {
  it("fails a passing answer that took longer than 20 s or 8,000 tokens", () => {
    const record = {
      passed: true,
      ms: 4_000,
      maxRequestOutput: 900,
    } as QuestionRecord
    expect(withinStuartLimit(record)).toBe(true)
    expect(withinStuartLimit({ ...record, ms: 20_001 })).toBe(false)
    expect(withinStuartLimit({ ...record, maxRequestOutput: 9_000 })).toBe(
      false,
    )
    expect(withinStuartLimit({ ...record, passed: false })).toBe(false)
    // A first attempt that timed out at 120 s is over, whatever the retry.
    expect(
      withinStuartLimit({
        ...record,
        ms: 15_000,
        attemptMs: [120_000, 15_000],
      }),
    ).toBe(false)
    expect(withinStuartLimit({ ...record, attemptMs: [4_000] })).toBe(true)
  })
})

/** A model that calls tools first, then answers as scripted per case. */
function scriptedModel(log: Calls): MessageCreator {
  return async (params, options) => {
    log.count += 1
    const asked = JSON.stringify(params.messages)
    const round = params.messages.length
    const tool = (name: string, input: unknown) => ({
      content: [
        { type: "tool_use", id: `toolu_${log.count}`, name, input },
      ] as unknown as Anthropic.Beta.BetaMessage["content"],
    })
    let reply: Reply
    if (asked.includes("explain the sMUSD gauge")) {
      reply =
        round === 1
          ? tool("explain_gauge", {
              gauge: "sMUSD",
              question: null,
              window: null,
            })
          : respond("sMUSD pays $10,000.00 in incentives this epoch.")
    } else if (asked.includes("USD/BTC-200")) {
      // The tool's own answer_template, reused verbatim.
      if (round === 1) {
        reply = tool("prepare_vote_script", {
          script: "vote 100% to USD/BTC-200",
        })
      } else {
        const template = /\\"answer_template\\":\\"([^"\\]*)/.exec(asked)?.[1]
        reply = respond(template ?? "no template")
      }
    } else if (asked.includes("best gauges")) {
      reply = tool("ask_clarification", { cardId: "gauge-objective" })
    } else if (asked.includes("weather")) {
      reply = {
        content: [
          {
            type: "text",
            text: "Stuart covers Mezo Earn only, not the weather.",
          },
        ] as unknown as Anthropic.Beta.BetaMessage["content"],
        stop_reason: "end_turn",
      }
    } else {
      reply = respond("Which address do you mean?")
    }
    return await fakeModel(log, () => reply)(params, options)
  }
}

describe("replay", () => {
  const cases = [
    find("gauge.smusd"),
    find("script.not_bridged"),
    find("ambiguous.best"),
    OTHER,
    HELD_BACK,
  ]

  it("passes a tool's answer_template reused verbatim", async () => {
    const store = tempStore()
    await runMatrix({
      ...base(store, calls()),
      cases: [find("script.not_bridged")],
      createFor: () => scriptedModel(calls()),
    })
    const record = store.read("haiku-5-5.low", 1)?.records["script.not_bridged"]
    expect(record?.rawText).not.toBe("no template")
    expect(record?.answerSource).toBe("accepted")
  })

  it("grades a stored answer exactly as a fresh run would", async () => {
    const live = tempStore()
    await runMatrix({
      ...base(live, calls()),
      cases,
      createFor: () => scriptedModel(calls()),
    })
    const replayed = tempStore()
    const report = await replayMatrix({ from: live, to: replayed, cases })
    expect(report).toEqual({ replayed: cases.length, kept: 0, skipped: 0 })
    // The spend of the answers replayed is carried over, once.
    expect(replayed.spend()).toEqual(live.spend())
    expect(spendTotal(replayed.spend())).toBeGreaterThan(0)
    await replayMatrix({ from: live, to: replayed, cases })
    expect(spendTotal(replayed.spend())).toBe(spendTotal(live.spend()))
    const before = live.read("haiku-5-5.low", 1)
    const after = replayed.read("haiku-5-5.low", 1)
    for (const testCase of cases) {
      const a = before?.records[testCase.id]
      const b = after?.records[testCase.id]
      const pick = (record: QuestionRecord | undefined) => ({
        passed: record?.passed,
        failures: record?.failures,
        answerSource: record?.answerSource,
        rejectedReason: record?.rejectedReason,
        tools: record?.tools,
        shown: record?.shown,
        onCard: record?.onCard,
        rawText: record?.rawText,
      })
      expect(pick(b), testCase.id).toEqual(pick(a))
    }
    // The plain-text decline and the card are graded as the model's own.
    expect(before?.records[OTHER.id]?.answerSource).toBe("plain_text")
    expect(before?.records["ambiguous.best"]?.onCard).toBe(true)
  })
})

describe("fingerprints", () => {
  it("refuses a folder of answers made before fingerprints", async () => {
    const store = tempStore()
    await runMatrix({ ...base(store, calls()), cases: [OTHER] })
    rmSync(join(store.dir, "fingerprint.json"))
    await expect(
      runMatrix({ ...base(store, calls()), cases: [OTHER] }),
    ).rejects.toThrow(/before matrix fingerprints/)
  })

  it("refuses a matrix made under another fingerprint, and names what changed", async () => {
    const store = tempStore()
    await runMatrix({ ...base(store, calls()), cases: [OTHER] })
    const stored = store.readFingerprint()
    if (stored === null) throw new Error("no fingerprint")
    store.writeFingerprint({
      ...stored,
      fingerprint: "0000000000000000",
      parts: { ...stored.parts, prompt: "0000000000000000" },
    })
    await expect(
      runMatrix({ ...base(store, calls()), cases: [OTHER] }),
    ).rejects.toThrow(/changed: prompt/)
  })

  it("never publishes runs made under different fingerprints together", async () => {
    const store = tempStore()
    await runMatrix({ ...base(store, calls()), cases: [OTHER] })
    const file = store.read("haiku-5-5.low", 1)
    if (file === null) throw new Error("no run")
    store.write({ ...file, fingerprint: "ffffffffffffffff" })
    expect(() =>
      buildResults({
        store,
        cases: [OTHER],
        publicChecks: {},
        id: "test",
        limits: LIMITS,
      }),
    ).toThrow(MixedFingerprintError)
  })
})

describe("lock and leaks", () => {
  it("takes over a lock whose process is gone, never a live one", async () => {
    const store = tempStore()
    writeFileSync(join(store.dir, "run.lock"), "999999 2026-11-17T00:00:00Z\n")
    expect((await runMatrix(base(store, calls()))).answered).toBe(3)
    expect(readdirSync(store.dir)).not.toContain("run.lock")
    writeFileSync(join(store.dir, "run.lock"), `${process.pid} now\n`)
    await expect(runMatrix(base(store, calls()))).rejects.toBeInstanceOf(
      MatrixLockedError,
    )
  })

  it("finds a distinctive held-back value in public text, unless excepted", () => {
    const held = heldLiterals(CASES, new Set(["gauge.boar"]))
    const text = "SNF added 99,999.99 MUSD to the pool."
    const leaks = findLeaks([{ id: "gauge.boar", text }], held)
    expect(leaks.map((leak) => leak.literal)).toContain("n:99999.99:0.5")
    expect(
      findLeaks([{ id: "gauge.boar", text }], held, [
        { literal: "n:99999.99:0.5", reason: "test" },
      ]).map((leak) => leak.literal),
    ).not.toContain("n:99999.99:0.5")
  })

  it("ignores short and round numbers, and common ballot targets", () => {
    const held = heldLiterals(CASES, new Set(["gauge.boar"]))
    // 0.12% APY against 0.1180 BTC, 110% against a 110% minimum ratio,
    // the BTC/MUSD CL200 pool's address: coincidences, not leaks.
    const text =
      "APY 0.12%, minimum 110%, $10,000.00 on sMUSD, pool 0x9cbc1537d255768b431488305b1c7efc2ac95022."
    expect(findLeaks([{ id: "gauge.boar", text }], held)).toEqual([])
    // The protocol overview's figures are distinctive.
    expect(distinctive(282_928_843.502, 0.01)).toBe(true)
    expect(distinctive(1_353, 0)).toBe(true)
    expect(distinctive(804.3, 0.0001)).toBe(true)
    expect(distinctive(0.117993, 0.0001)).toBe(false)
    expect(distinctive(10_000, 0.01)).toBe(false)
  })
})
