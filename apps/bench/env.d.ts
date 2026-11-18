declare namespace Cloudflare {
  interface Env {
    /** The static assets: every page, chunk and file the build wrote. */
    ASSETS: Fetcher
  }
}

/** Built from data/results.json by scripts/question-index.mjs. */
declare module "virtual:bench-question-index" {
  import type { PublicQuestion, QuestionSummary } from "./src/data/schema"
  export const questionIndex: readonly QuestionSummary[]
  export const firstQuestion: PublicQuestion | null
}

/** Every published answer, built by scripts/question-index.mjs. */
declare module "virtual:bench-answers" {
  const questions: unknown
  export default questions
}

/** Set per build by vite.config.ts: the prerender crawler's token. */
declare const __BENCH_PRERENDER_TOKEN__: string
