// Two virtual modules built from data/results.json, so the published
// answers (most of the file) stay out of every page's first load:
//
// - virtual:bench-question-index: the published questions without their
//   answers, and the first question in full. Every page can list the
//   questions, and the front page can show its first card.
// - virtual:bench-answers: every published question with every entry's
//   answer. Only src/data/questions.ts imports it, and pages load that
//   module when a reader steps to another question or opens one.
//
// They are separate modules because the bundler places a module whole: had
// the answers come from the JSON file itself, the file (answers and all)
// would sit in the chunk every page loads.
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const indexId = "virtual:bench-question-index"
const answersId = "virtual:bench-answers"
const file = fileURLToPath(new URL("../data/results.json", import.meta.url))

/** The question index module's source, from the parsed results file. */
export function questionIndexSource(results) {
  const questions = results.publicQuestions ?? []
  const index = questions.map((question) => ({
    id: question.id,
    kind: question.kind,
    question: question.question,
    checks: question.checks,
    answers: question.answers.length,
    passed: question.answers.filter((answer) => answer.passed).length,
  }))
  return [
    `export const questionIndex = ${JSON.stringify(index)}`,
    `export const firstQuestion = ${JSON.stringify(questions[0] ?? null)}`,
    "",
  ].join("\n")
}

/** The answers module's source: one JSON.parse, which parses fastest. */
export function answersSource(results) {
  const text = JSON.stringify(results.publicQuestions ?? [])
  return `export default JSON.parse(${JSON.stringify(text)})\n`
}

export default function questionIndex() {
  return {
    name: "bench-question-index",
    resolveId(source) {
      return source === indexId || source === answersId
        ? `\0${source}`
        : undefined
    },
    load(module) {
      if (module !== `\0${indexId}` && module !== `\0${answersId}`)
        return undefined
      this.addWatchFile(file)
      const results = JSON.parse(readFileSync(file, "utf8"))
      return module === `\0${indexId}`
        ? questionIndexSource(results)
        : answersSource(results)
    },
  }
}
