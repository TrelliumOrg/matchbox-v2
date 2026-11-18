import publicQuestions from "virtual:bench-answers"
import type { PublicQuestion } from "./schema"

/**
 * Every published question with every entry's answer: most of the results
 * file. Pages load this module with a dynamic import (src/ui/answers.ts)
 * when a reader steps to another question or opens one, never on first
 * load. Validated with the rest of the file (see ./results).
 */
const questions = publicQuestions as readonly PublicQuestion[]

export default questions
