import { createHash } from "node:crypto"
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { BenchFailureTypeId } from "@matchbox/contracts/bench"
import type { StuartResponse } from "@matchbox/stuart-ui/contract"
import type { UsageTotals } from "../../src/query/claude"
import type { BenchCase } from "../cases"
import { GRADER_HASH, type MatrixFingerprint } from "./fingerprint"

// Raw matrix results on disk (bench/results/matrix/<name>/, gitignored):
// one file per entry and run, written after every graded answer, so a
// stopped matrix resumes where it was and a finished run is never repeated.
//
// Each record keeps what the grader needs (the response Stuart built, the
// model's own text and outcome, its tool calls), so a change to a case's
// checks re-grades stored answers offline (--regrade). Only a change to a
// case's question, or to the fixtures, sends it to the model again. A run
// file also records the limits, the commit and a hash of Stuart's prompt,
// tools and bench settings; resuming with different ones is refused.
//
// Beside them: fingerprint.json (what every answer depends on, see
// fingerprint.ts), spend.json (the matrix's cumulative spend, which
// --max-usd caps), pending.json (answers lost to API errors, counted
// across invocations) and run.lock (one invocation at a time, released on
// exit and on Ctrl+C, and taken over when the process that held it is
// gone).

/** How an answer ended. API errors and rate limits are never recorded. */
export type AnswerOutcome =
  | "graded"
  | "timeout"
  | "refusal"
  | "token_limit"
  | "no_answer"

export type ToolCallRecord = {
  name: string
  input: unknown
  /** sha256 of what the tool returned to the model, when it was sent. */
  resultDigest: string | null
}

/** The response as the grader reads it: everything but the evidence list. */
export type StoredResponse = Omit<StuartResponse, "evidence">

export type QuestionRecord = {
  id: string
  /** The question as asked: its text, wallet and the fixtures. */
  questionHash: string
  /** The checks this record was graded against. */
  checksHash: string
  passed: boolean
  /** A failed check is a safety failure. */
  safety: boolean
  outcome: AnswerOutcome
  /**
   * What became of the model's own sentence (Stuart's modelAnswer):
   * accepted, rejected, missing, clarify, question, out_of_scope, failed.
   */
  answerSource: string
  /** Why Stuart's checks rejected the model's sentence, if they did. */
  rejectedReason: string | null
  /** The unsourced tokens, or the sentence count or length, rejected. */
  rejectedDetail: string[]
  /** The answer shown was a clarification card. */
  onCard: boolean
  /** What the model itself wrote last (respond sentence, text or card). */
  rawText: string | null
  failures: Array<{ check: string; type: BenchFailureTypeId; detail: string }>
  /**
   * Passed with Stuart's length limits ignored (length.ts): the same as
   * passed unless the sentence was rejected only for its length. Absent on
   * records graded before it existed (--regrade fills it in).
   */
  passedIgnoringLength?: boolean
  /**
   * For a sentence rejected for its length, what Stuart's other checks
   * found once length was ignored: "shown", the reason they rejected it
   * ("unsourced", "claim", "greeting"), or "unverified". Null otherwise.
   */
  lengthRecheck?: string | null
  /** Wall time of the graded attempt, tools included. */
  ms: number
  /** Wall time of every model attempt (a timed-out one, then the retry). */
  attemptMs: number[]
  /** Largest output of one request, against Stuart's 8,000-token limit. */
  maxRequestOutput: number
  /** Usage of every model attempt behind the answer. */
  usage: UsageTotals
  /** Every model attempt's metered cost, and a worst case for cut-offs. */
  costUsd: number
  unmeteredUsd: number
  tools: string[]
  toolCalls: ToolCallRecord[]
  /** Everything the user saw (grade.ts shownText). */
  shown: string
  response: StoredResponse | null
  runtime: string
  /** The model ids that served the attempt's requests. */
  servedBy: string[]
  /** Attempts made, timeouts and retried API errors included. */
  attempts: number
}

export type RunSettings = {
  /** Stuart's prompt, tool definitions and the bench's request settings. */
  settingsHash: string
  budgetMs: number
  maxTokens: number
}

export type RunFile = {
  /** The matrix fingerprint the run was made under. */
  fingerprint: string
  entry: string
  model: string
  effort: string
  run: number
  settings: RunSettings
  /** The commit the run started on. */
  commit: string
  startedAt: string
  finishedAt: string | null
  records: Record<string, QuestionRecord>
}

/** Cumulative spend of one matrix directory. */
export type SpendLedger = {
  /** Usage the API reported. */
  meteredUsd: number
  /** Requests cut off before the API reported usage, at a worst case. */
  unmeteredUsd: number
  requests: number
  byEntry: Record<string, { meteredUsd: number; unmeteredUsd: number }>
  updatedAt: string | null
}

/** Answers lost to API errors, by "entry/run/case", across invocations. */
export type PendingLedger = Record<
  string,
  { invocations: number; lastReason: string }
>

export function spendTotal(ledger: SpendLedger): number {
  return ledger.meteredUsd + ledger.unmeteredUsd
}

function sha(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16)
}

export function digest(value: unknown): string {
  return sha(typeof value === "string" ? value : JSON.stringify(value))
}

const here = dirname(fileURLToPath(import.meta.url))

/** The fixtures and fakes every question reads. */
const FIXTURES_HASH = sha(
  [
    ...[
      "activity.payouts.json",
      "activity.snf.json",
      "gauges.mainnet.json",
    ].map((name) => join(here, "..", "fixtures", name)),
    join(here, "..", "world.ts"),
    join(here, "..", "..", "src", "query", "fakes.ts"),
  ]
    .map((path) => readFileSync(path, "utf8"))
    .join("\n"),
)

const withPatterns = (_key: string, value: unknown) =>
  value instanceof RegExp ? value.toString() : value

/** The question as the model sees it: text, wallet and world. */
export function questionHash(testCase: BenchCase): string {
  return sha(
    JSON.stringify({
      query: testCase.query,
      wallet: testCase.wallet !== false,
      fixtures: FIXTURES_HASH,
    }),
  )
}

/** The checks a stored answer is graded against, and the grader itself. */
export function checksHash(testCase: BenchCase): string {
  return sha(
    JSON.stringify(
      {
        category: testCase.category,
        expect: testCase.expect,
        grader: GRADER_HASH,
      },
      withPatterns,
    ),
  )
}

export type StoredFingerprint = MatrixFingerprint & {
  /** The commit the matrix started on. */
  commit: string
  createdAt: string
}

function writeAtomic(path: string, value: unknown): void {
  // Write then rename: a stop mid-write never leaves half a file.
  writeFileSync(`${path}.tmp`, `${JSON.stringify(value)}\n`)
  renameSync(`${path}.tmp`, path)
}

export class MatrixLockedError extends Error {
  override name = "MatrixLockedError"
}

export class MatrixStore {
  private ledger: SpendLedger | null = null

  constructor(readonly dir: string) {}

  private file(entry: string, run: number): string {
    return join(this.dir, entry, `run-${run}.json`)
  }

  read(entry: string, run: number): RunFile | null {
    const path = this.file(entry, run)
    if (!existsSync(path)) return null
    return JSON.parse(readFileSync(path, "utf8")) as RunFile
  }

  write(file: RunFile): void {
    mkdirSync(join(this.dir, file.entry), { recursive: true })
    writeAtomic(this.file(file.entry, file.run), file)
  }

  /** Every run file on disk, by entry id. */
  all(): Map<string, RunFile[]> {
    const found = new Map<string, RunFile[]>()
    if (!existsSync(this.dir)) return found
    for (const entry of readdirSync(this.dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const runs = readdirSync(join(this.dir, entry.name))
        .flatMap((name) => {
          const run = /^run-(\d+)\.json$/.exec(name)?.[1]
          return run === undefined ? [] : [this.read(entry.name, Number(run))]
        })
        .filter((file): file is RunFile => file !== null)
        .sort((a, b) => a.run - b.run)
      found.set(entry.name, runs)
    }
    return found
  }

  /**
   * One invocation at a time: two would each cache the spend and could
   * overwrite each other's. Returns the release function.
   */
  lock(): () => void {
    mkdirSync(this.dir, { recursive: true })
    const path = join(this.dir, "run.lock")
    let fd: number
    try {
      fd = openSync(path, "wx")
    } catch {
      // A lock whose process is gone (killed, or a machine restart) is
      // taken over; a live one refuses.
      const pid = Number(readFileSync(path, "utf8").split(" ")[0])
      if (Number.isInteger(pid) && pid > 0 && processAlive(pid)) {
        throw new MatrixLockedError(
          `Another invocation (process ${pid}) is using ${this.dir}. Wait for it, or stop it.`,
        )
      }
      rmSync(path, { force: true })
      fd = openSync(path, "wx")
    }
    writeFileSync(fd, `${process.pid} ${new Date().toISOString()}\n`)
    closeSync(fd)
    let released = false
    const release = () => {
      if (released) return
      released = true
      process.off("exit", release)
      process.off("SIGINT", interrupt)
      process.off("SIGTERM", interrupt)
      rmSync(path, { force: true })
    }
    // A stop by Ctrl+C or a kill signal still releases the lock; so does an
    // exit while answers were in flight.
    const interrupt = () => {
      release()
      process.exit(130)
    }
    process.on("exit", release)
    process.on("SIGINT", interrupt)
    process.on("SIGTERM", interrupt)
    return release
  }

  readFingerprint(): StoredFingerprint | null {
    const path = join(this.dir, "fingerprint.json")
    return existsSync(path)
      ? (JSON.parse(readFileSync(path, "utf8")) as StoredFingerprint)
      : null
  }

  writeFingerprint(fingerprint: StoredFingerprint): void {
    mkdirSync(this.dir, { recursive: true })
    writeAtomic(join(this.dir, "fingerprint.json"), fingerprint)
  }

  spend(): SpendLedger {
    if (this.ledger) return this.ledger
    const path = join(this.dir, "spend.json")
    this.ledger = existsSync(path)
      ? (JSON.parse(readFileSync(path, "utf8")) as SpendLedger)
      : {
          meteredUsd: 0,
          unmeteredUsd: 0,
          requests: 0,
          byEntry: {},
          updatedAt: null,
        }
    return this.ledger
  }

  /**
   * Takes over another matrix's spend, for a replay of its answers: what
   * those answers cost stays on the books. Only into a matrix that has
   * spent nothing yet, so spend is never counted twice.
   */
  carrySpend(from: SpendLedger): void {
    const ledger = this.spend()
    if (ledger.requests > 0 || spendTotal(ledger) > 0) return
    this.ledger = structuredClone(from)
    mkdirSync(this.dir, { recursive: true })
    writeAtomic(join(this.dir, "spend.json"), this.ledger)
  }

  /** Adds one request's cost to the cumulative spend, on disk at once. */
  addSpend(
    entry: string,
    cost: { meteredUsd: number; unmeteredUsd: number },
    at: Date,
  ): void {
    const ledger = this.spend()
    ledger.meteredUsd += cost.meteredUsd
    ledger.unmeteredUsd += cost.unmeteredUsd
    ledger.requests += 1
    const row = ledger.byEntry[entry] ?? { meteredUsd: 0, unmeteredUsd: 0 }
    row.meteredUsd += cost.meteredUsd
    row.unmeteredUsd += cost.unmeteredUsd
    ledger.byEntry[entry] = row
    ledger.updatedAt = at.toISOString()
    mkdirSync(this.dir, { recursive: true })
    writeAtomic(join(this.dir, "spend.json"), ledger)
  }

  pending(): PendingLedger {
    const path = join(this.dir, "pending.json")
    return existsSync(path)
      ? (JSON.parse(readFileSync(path, "utf8")) as PendingLedger)
      : {}
  }

  writePending(ledger: PendingLedger): void {
    mkdirSync(this.dir, { recursive: true })
    writeAtomic(join(this.dir, "pending.json"), ledger)
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM: alive, owned by another user.
    return (error as NodeJS.ErrnoException).code === "EPERM"
  }
}

export function pendingKey(entry: string, run: number, id: string): string {
  return `${entry}/${run}/${id}`
}

/** A stored answer to this question as it is now. */
export function isCurrent(
  record: QuestionRecord | undefined,
  testCase: BenchCase,
): boolean {
  return record !== undefined && record.questionHash === questionHash(testCase)
}

/** A run with a current answer to every question. */
export function isComplete(
  file: RunFile | null,
  cases: readonly BenchCase[],
): boolean {
  return (
    file !== null &&
    cases.every((testCase) => isCurrent(file.records[testCase.id], testCase))
  )
}
