import { z } from "zod"
import type { QueryRunner } from "./reader"

// A recorded SQL fixture: each query (text and parameters) with the rows
// Neon returned. Tests replay it, so the warehouse snapshot is exercised on
// real projection rows without a database. Record with
// `pnpm --filter @matchbox/jobs record:warehouse`.

export const recordingSchema = z.object({
  recordedAt: z.number().int(),
  /** The snapshot clock the recording was taken for (unix seconds). */
  nowSeconds: z.number().int(),
  branch: z.string(),
  entries: z.array(
    z.object({
      text: z.string(),
      params: z.array(z.unknown()),
      rows: z.array(z.unknown()),
    }),
  ),
})

export type Recording = z.infer<typeof recordingSchema>

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

export function queryKey(text: string, params: unknown[]): string {
  return `${normalize(text)}\u0000${JSON.stringify(params)}`
}

/** Replays a recording; an unrecorded query fails loudly. */
export function recordedQueryRunner(recording: Recording): QueryRunner {
  const answers = new Map(
    recording.entries.map((entry) => [
      queryKey(entry.text, entry.params),
      entry.rows,
    ]),
  )
  return async function replay(queries) {
    return queries.map((query) => {
      const rows = answers.get(queryKey(query.text, query.params))
      if (rows === undefined) {
        throw new Error(
          `Query not in the recording: ${normalize(query.text).slice(0, 120)}`,
        )
      }
      return rows
    })
  }
}

/** Wraps a live runner and keeps every query it answers. */
export function recordingQueryRunner(live: QueryRunner): {
  run: QueryRunner
  entries: Recording["entries"]
} {
  const entries: Recording["entries"] = []
  return {
    entries,
    async run(queries) {
      const results = await live(queries)
      queries.forEach((query, index) => {
        entries.push({
          text: normalize(query.text),
          params: query.params,
          rows: results[index] ?? [],
        })
      })
      return results
    },
  }
}
