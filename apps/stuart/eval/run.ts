import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { z } from "zod"
import { proposalSchema, searchCheck, verifyClaimAmounts } from "./actions.ts"
import {
  type Category,
  type Expectation,
  QUESTIONS,
  type Question,
  WALLETS,
} from "./questions.ts"
import { type GroundTruth, loadGroundTruth } from "./truth.ts"

// Live correctness eval for Stuart. Asks every question in questions.ts on
// the Stuart preview, computes the expected numbers from the preview API and
// Mezo RPC (truth.ts), and scores intent, numbers, terms and copy hygiene.
//
//   node apps/stuart/eval/run.ts [--label before] [--only rank.,gauge.]
//
// Model answers are counted; at most MAX_MODEL_ANSWERS per run keeps the
// spend to a few dollars (Sonnet 5.5 at low effort costs about 4 cents per
// answer, tool rounds included; Haiku 5.5 about a twentieth of that).

const STUART =
  process.env.STUART_URL ??
  "https://matchbox-stuart-preview.mallard.workers.dev"
const ORIGIN = "https://matchbox-pro-v2-preview.mallard.workers.dev"
const MAX_MODEL_ANSWERS = 60
// Upper bound per model answer on Sonnet 5.5 (several rounds with tool
// results).
const COST_PER_MODEL_ANSWER_USD = 0.04
// The chat route allows 20 requests a minute per IP.
const PAUSE_MS = 3_200

const FORBIDDEN_COPY = /[·—–]/

const evidenceSchema = z.object({
  kind: z.string(),
  label: z.string(),
  source: z.string(),
})
const responseSchema = z.object({
  intent: z.string(),
  title: z.string(),
  snapshot: z.object({ label: z.string() }),
  answer: z.object({ text: z.string(), origin: z.string() }),
  why: z.object({ items: z.array(z.object({ text: z.string() })) }).nullable(),
  facts: z.array(z.object({ label: z.string(), display: z.string() })),
  evidence: z.array(evidenceSchema),
  uiBlocks: z.array(z.looseObject({ type: z.string() })),
  followups: z.array(z.object({ label: z.string() })),
  service: z.object({ runtime: z.string(), model: z.string().nullable() }),
  proposedActions: z.array(proposalSchema).default([]),
})
type StuartAnswer = z.infer<typeof responseSchema>

const eventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("status"), text: z.string() }),
  z.object({ type: z.literal("answer"), response: z.unknown() }),
  z.object({
    type: z.literal("busy"),
    reason: z.string(),
    retryAfterSeconds: z.number().nullable(),
  }),
  z.object({ type: z.literal("error"), code: z.string(), message: z.string() }),
  z.object({ type: z.literal("done") }),
])

type Asked =
  | { kind: "answer"; response: StuartAnswer; trace: string[] }
  | { kind: "failed"; reason: string; trace: string[] }

function parseFrames(text: string): z.infer<typeof eventSchema>[] {
  const events: z.infer<typeof eventSchema>[] = []
  for (const frame of text.split("\n\n")) {
    const data = /^data: (.*)$/m.exec(frame)?.[1]
    if (data === undefined) continue
    let value: unknown
    try {
      value = JSON.parse(data)
    } catch {
      continue
    }
    const parsed = eventSchema.safeParse(value)
    if (parsed.success) events.push(parsed.data)
  }
  return events
}

async function ask(query: string, wallet: string | null): Promise<Asked> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(`${STUART}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({
        version: 1,
        query,
        sessionId: crypto.randomUUID(),
        turn: 0,
        surface: "palette",
        chainId: 31_612,
        ...(wallet === null
          ? {}
          : { wallet: { address: wallet, mode: "watching" } }),
      }),
    })
    if (response.status === 429) {
      await sleep(15_000)
      continue
    }
    const events = parseFrames(await response.text())
    const trace = events.flatMap((event) =>
      event.type === "status" ? [event.text] : [],
    )
    const busy = events.find((event) => event.type === "busy")
    if (busy?.type === "busy") {
      await sleep(Math.max(5, busy.retryAfterSeconds ?? 10) * 1000)
      continue
    }
    const answer = events.find((event) => event.type === "answer")
    if (answer?.type === "answer") {
      const parsed = responseSchema.safeParse(answer.response)
      if (parsed.success)
        return { kind: "answer", response: parsed.data, trace }
      return { kind: "failed", reason: "schema", trace }
    }
    const error = events.find((event) => event.type === "error")
    return {
      kind: "failed",
      reason: error?.type === "error" ? error.code : `http ${response.status}`,
      trace,
    }
  }
  return { kind: "failed", reason: "busy", trace: [] }
}

const SUFFIX: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9 }

/** Numbers in display text: "1,389.03", "$20.31", "294.12M", "5.00x". */
export function numbersIn(text: string): number[] {
  const withoutAddresses = text.replace(/0x[0-9a-fA-F…]+/g, " ")
  return [
    ...withoutAddresses.matchAll(/(\d[\d,]*(?:\.\d+)?)\s?([kKmMbB])?\b/g),
  ].map((match) => {
    const value = Number((match[1] ?? "0").replace(/,/g, ""))
    const suffix = match[2]?.toLowerCase()
    return suffix === undefined ? value : value * (SUFFIX[suffix] ?? 1)
  })
}

type Score = {
  intent: boolean
  numbers: number | null
  terms: number | null
  hygiene: boolean
  noNumbers: boolean | null
  docs: boolean | null
  pass: boolean
  value: number
  notes: string[]
}

function copyStrings(response: StuartAnswer, trace: string[]): string[] {
  return [
    response.answer.text,
    response.title,
    response.snapshot.label,
    ...response.evidence.map((item) => item.label),
    ...response.facts.map((fact) => `${fact.label} ${fact.display}`),
    ...(response.why?.items.map((item) => item.text) ?? []),
    ...response.followups.map((item) => item.label),
    ...trace,
  ]
}

function score(
  asked: Asked,
  expected: Expectation,
  exact: { ok: boolean; note: string } | null = null,
): Score {
  if (asked.kind === "failed") {
    return {
      intent: false,
      numbers: expected.numbers?.length ? 0 : null,
      terms: expected.terms?.length ? 0 : null,
      hygiene: true,
      noNumbers: null,
      docs: null,
      pass: false,
      value: 0,
      notes: [`failed: ${asked.reason}`],
    }
  }
  const { response } = asked
  const text = response.answer.text
  const lower = text.toLowerCase()
  const notes: string[] = []
  const intent = expected.intents.includes(response.intent)
  if (!intent) notes.push(`intent ${response.intent}`)
  let numbers: number | null = null
  if (expected.numbers?.length) {
    const found = numbersIn(text)
    const hits = expected.numbers.filter((want) => {
      const tolerance = Math.max(want.abs ?? 0, Math.abs(want.value) * want.rel)
      const hit = found.some(
        (value) => Math.abs(value - want.value) <= tolerance + 1e-9,
      )
      if (!hit) notes.push(`missing ${want.label} ${want.value}`)
      return hit
    })
    numbers = hits.length / expected.numbers.length
  }
  let terms: number | null = null
  if (expected.terms?.length) {
    const hits = expected.terms.filter((group) => {
      const hit = group.some((term) => lower.includes(term.toLowerCase()))
      if (!hit) notes.push(`missing term ${group.join("|")}`)
      return hit
    })
    terms = hits.length / expected.terms.length
  }
  for (const term of expected.forbid ?? []) {
    if (lower.includes(term.toLowerCase())) {
      notes.push(`forbidden "${term}"`)
      terms = 0
    }
  }
  const bad = copyStrings(response, asked.trace).filter(
    (value) => FORBIDDEN_COPY.test(value) || /;\s/.test(value),
  )
  const hygiene = bad.length === 0
  if (!hygiene) notes.push(`copy: ${bad.slice(0, 2).join(" | ")}`)
  const noNumbers = expected.noNumbers ? !/\d/.test(text) : null
  if (noNumbers === false) notes.push("numbers in a decline")
  const docs = expected.docs
    ? response.evidence.some((item) => item.kind === "docs")
    : null
  if (docs === false) notes.push("no docs evidence")
  let action: boolean | null = null
  if (expected.proposal !== undefined) {
    const proposal = response.proposedActions.find(
      (item) => item.kind === expected.proposal?.kind,
    )
    const actionOk =
      expected.proposal.action === undefined ||
      proposal?.content.action === expected.proposal.action
    action = proposal !== undefined && actionOk && (exact?.ok ?? true)
    if (proposal === undefined)
      notes.push(`no ${expected.proposal.kind} proposal`)
    else if (!actionOk) notes.push(`action ${String(proposal.content.action)}`)
    if (exact !== null) notes.push(exact.note)
  }
  let ranking: boolean | null = null
  if (expected.objective !== undefined || expected.rowKind !== undefined) {
    const block = response.uiBlocks.find(
      (item) => item.type === "gauge_ranking",
    )
    const objective = block?.objective
    const rows = Array.isArray(block?.rows) ? block.rows : []
    const first: unknown = rows[0]
    const kind =
      typeof first === "object" && first !== null && "kind" in first
        ? first.kind
        : undefined
    ranking =
      block !== undefined &&
      (expected.objective === undefined || objective === expected.objective) &&
      (expected.rowKind === undefined || kind === expected.rowKind)
    if (!ranking) notes.push(`ranking ${String(objective)} ${String(kind)}`)
  }
  const parts = [
    intent ? 1 : 0,
    ...(numbers === null ? [] : [numbers]),
    ...(terms === null ? [] : [terms]),
    ...(noNumbers === null ? [] : [noNumbers ? 1 : 0]),
    ...(docs === null ? [] : [docs ? 1 : 0]),
    ...(action === null ? [] : [action ? 1 : 0]),
    ...(ranking === null ? [] : [ranking ? 1 : 0]),
  ]
  const value = parts.reduce((sum, part) => sum + part, 0) / parts.length
  return {
    intent,
    numbers,
    terms,
    hygiene,
    noNumbers,
    docs,
    pass: value === 1 && hygiene,
    value,
    notes,
  }
}

function argument(name: string): string | null {
  const index = process.argv.indexOf(name)
  return index === -1 ? null : (process.argv[index + 1] ?? null)
}

async function main(): Promise<void> {
  const label = argument("--label") ?? "run"
  const only = argument("--only")?.split(",") ?? null
  const questions = QUESTIONS.filter(
    (question) =>
      only === null || only.some((prefix) => question.id.startsWith(prefix)),
  )
  const truth: GroundTruth = await loadGroundTruth(Object.values(WALLETS))
  console.log(
    `truth at block ${truth.block}, epoch ${truth.epoch.number}, trove owner ${truth.trove?.owner ?? "none"}`,
  )
  let modelAnswers = 0
  const results: Array<{
    question: Question
    expected: Expectation
    asked: Asked
    score: Score
  }> = []
  for (const question of questions) {
    if (modelAnswers >= MAX_MODEL_ANSWERS) {
      console.log("model answer cap reached, stopping")
      break
    }
    const wallet =
      question.wallet === "trove"
        ? (truth.trove?.owner ?? null)
        : question.wallet
    const expected = question.expect(truth)
    const asked = await ask(question.query, wallet)
    if (
      asked.kind === "answer" &&
      asked.response.service.runtime === "claude"
    ) {
      modelAnswers += 1
    }
    const proposal =
      asked.kind === "answer"
        ? asked.response.proposedActions.find((item) => item.kind === "claim")
        : undefined
    const exact =
      expected.proposal?.exact === true && proposal !== undefined
        ? await verifyClaimAmounts(proposal).catch((error: unknown) => ({
            ok: false,
            note: `earned() read failed: ${String(error).slice(0, 80)}`,
          }))
        : null
    const result = score(asked, expected, exact)
    results.push({ question, expected, asked, score: result })
    const text =
      asked.kind === "answer" ? asked.response.answer.text : asked.reason
    console.log(
      `${result.pass ? "PASS" : "FAIL"} ${result.value.toFixed(2)} ${question.id}: ${text}${result.notes.length ? `\n      ${result.notes.join("; ")}` : ""}`,
    )
    await sleep(PAUSE_MS)
  }
  // The Ctrl K bar's search route (no model).
  if (only === null || only.some((prefix) => prefix.startsWith("search"))) {
    const searches: Array<{
      id: string
      query: string
      expect: (results: Array<Record<string, unknown>>) => string | null
    }> = [
      {
        id: "search.gauge_name",
        query: "SNF",
        expect: (results) =>
          results.some((item) => item.type === "gauge" && item.kind === "vebtc")
            ? null
            : "no SNF veBTC gauge",
      },
      {
        id: "search.wallet",
        query: WALLETS.multiLock,
        expect: (results) =>
          results[0]?.type === "wallet" ? null : "no wallet row first",
      },
      {
        id: "search.tx",
        query:
          "0xcfeab7e5d722b0458331e4269e8d86d1b0a31d5eaeed6b764b500889cf931a6b",
        expect: (results) =>
          results[0]?.type === "transaction" ? null : "no transaction row",
      },
    ]
    for (const item of searches) {
      const checked = await searchCheck({
        base: STUART,
        origin: ORIGIN,
        query: item.query,
        expect: item.expect,
      })
      const question: Question = {
        id: item.id,
        category: "search",
        query: item.query,
        wallet: null,
        expect: () => ({ intents: [] }),
      }
      results.push({
        question,
        expected: { intents: [] },
        asked: { kind: "failed", reason: checked.note, trace: [] },
        score: {
          intent: checked.ok,
          numbers: null,
          terms: null,
          hygiene: true,
          noNumbers: null,
          docs: null,
          pass: checked.ok,
          value: checked.ok ? 1 : 0,
          notes: [checked.note],
        },
      })
      console.log(`${checked.ok ? "PASS" : "FAIL"} ${item.id}: ${checked.note}`)
    }
  }
  const byCategory = new Map<
    Category,
    { n: number; pass: number; value: number }
  >()
  for (const { question, score: result } of results) {
    const entry = byCategory.get(question.category) ?? {
      n: 0,
      pass: 0,
      value: 0,
    }
    entry.n += 1
    entry.pass += result.pass ? 1 : 0
    entry.value += result.value
    byCategory.set(question.category, entry)
  }
  console.log("\ncategory      n  pass  score")
  for (const [category, entry] of byCategory) {
    console.log(
      `${category.padEnd(13)} ${String(entry.n).padStart(2)}  ${String(entry.pass).padStart(4)}  ${(entry.value / entry.n).toFixed(2)}`,
    )
  }
  const passed = results.filter((result) => result.score.pass).length
  const mean =
    results.reduce((sum, result) => sum + result.score.value, 0) /
    Math.max(1, results.length)
  console.log(
    `total ${results.length}  pass ${passed}  score ${mean.toFixed(2)}  model answers ${modelAnswers} (<= $${(modelAnswers * COST_PER_MODEL_ANSWER_USD).toFixed(3)})`,
  )
  const directory = join(import.meta.dirname, "results")
  mkdirSync(directory, { recursive: true })
  writeFileSync(
    join(directory, `${label}.json`),
    JSON.stringify(
      {
        label,
        block: truth.block,
        modelAnswers,
        results: results.map((result) => ({
          id: result.question.id,
          category: result.question.category,
          query: result.question.query,
          expected: result.expected,
          answer: result.asked.kind === "answer" ? result.asked.response : null,
          trace: result.asked.trace,
          score: result.score,
        })),
      },
      null,
      2,
    ),
  )
}

await main()
