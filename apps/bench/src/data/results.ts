import {
  entries,
  failureTypes,
  kinds,
  rejectionTypes,
  run,
  version,
} from "../../data/results.json"
import type { SiteResults } from "./schema"

/**
 * The results the site renders, read at build time, without the published
 * answers: those are most of the file, so they load from ./questions only
 * when a reader asks for them, and the question list comes from
 * virtual:bench-question-index. With nothing in the page importing the
 * file's publicQuestions, the build leaves it out of the first load.
 *
 * A deliberate exception to the rule that JSON goes through zod before it
 * is typed: zod and the contract would add a validator to every page's
 * first load for a file that never changes after the build. The file is
 * validated with zod instead before any page can ship: the Worker parses
 * it before the prerender's first render (src/server.ts), so a bad file
 * fails the build, and the unit tests parse it from disk. The page renders
 * exactly those bytes, so the type here is the one zod confirmed.
 */
const results = {
  version,
  run,
  kinds,
  failureTypes,
  rejectionTypes,
  entries,
} as unknown as SiteResults

export default results
