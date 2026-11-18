import * as z from "zod/mini"

/**
 * "Ask about this page": the docs panel's contract with Stuart's public
 * docs endpoint. Stuart answers from its reviewed notes only, with no model,
 * wallet, chain read or tool behind it, and ranks the notes written on the
 * reader's page first. Both sides parse with these schemas. zod/mini keeps
 * the docs panel's lazy chunk small.
 */

/** POST, JSON, on Stuart's origin. */
export const docsAskPath = "/docs/ask"

export const docsAskLimits = {
  /** Characters in a question, after trimming. */
  question: 300,
  /** Bytes in a request body: the question, the page and the JSON around them. */
  body: 2048,
  /** Notes in one answer. */
  notes: 3,
} as const

/** A docs page path as the site serves it, such as /concepts/borrow. */
export const docsPagePattern = /^\/[a-z0-9-]+(?:\/[a-z0-9-]+){0,5}$/

export const docsAskRequestSchema = z.strictObject({
  question: z
    .string()
    .check(z.trim(), z.minLength(1), z.maxLength(docsAskLimits.question)),
  page: z.nullable(
    z.string().check(z.maxLength(120), z.regex(docsPagePattern)),
  ),
})

export type DocsAskRequest = z.infer<typeof docsAskRequestSchema>

const sourceSchema = z.object({
  label: z.string(),
  url: z.string().check(z.regex(/^https:\/\//)),
})

export const docsAskNoteSchema = z.object({
  id: z.string(),
  title: z.string(),
  answer: z.string(),
  detail: z.array(z.string()),
  sources: z.array(sourceSchema),
  /** Written on the page the reader sent. */
  onPage: z.boolean(),
})

export type DocsAskNote = z.infer<typeof docsAskNoteSchema>

export const docsAskResponseSchema = z.object({
  /** The knowledge bundle the notes came from. */
  version: z.string(),
  notes: z.array(docsAskNoteSchema).check(z.maxLength(docsAskLimits.notes)),
})

export type DocsAskResponse = z.infer<typeof docsAskResponseSchema>
