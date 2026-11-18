import { type BenchEffort, benchEffortSchema } from "@matchbox/contracts/bench"
import { DEFAULT_STUART_MODEL } from "../../src/query/env"

// The models and reasoning effort levels Matchbench compares.
//
// Effort levels each model accepts, from Anthropic's effort documentation
// (https://platform.claude.com/docs/en/build-with-claude/effort, read on
// 17 Nov 2026): Claude Haiku 5.5, Claude Sonnet 5.5 and Claude Opus 5.5
// each support all five levels, low, medium, high, xhigh and max. Opus 5.5
// and Haiku 5.5 default to medium, Sonnet 5.5 to high; the bench always
// sends the level explicitly. A pair this table does not list is skipped
// with a message, never run at another level.

export const EFFORTS = benchEffortSchema.options

export type BenchModel = {
  /** API model id. */
  model: string
  /** Short id used in entry ids: "sonnet-5-5". */
  slug: string
  label: string
  efforts: readonly BenchEffort[]
}

export const MODELS: readonly BenchModel[] = [
  {
    model: "claude-haiku-5-5",
    slug: "haiku-5-5",
    label: "Claude Haiku 5.5",
    efforts: ["low", "medium", "high", "xhigh", "max"],
  },
  {
    model: "claude-sonnet-5-5",
    slug: "sonnet-5-5",
    label: "Claude Sonnet 5.5",
    efforts: ["low", "medium", "high", "xhigh", "max"],
  },
  {
    model: "claude-opus-5-5",
    slug: "opus-5-5",
    label: "Claude Opus 5.5",
    efforts: ["low", "medium", "high", "xhigh", "max"],
  },
]

/** What production Stuart answers with (wrangler.jsonc STUART_EFFORT). */
export const PRODUCTION = {
  model: DEFAULT_STUART_MODEL,
  effort: "low" as BenchEffort,
}

export type MatrixEntry = {
  id: string
  model: string
  slug: string
  label: string
  effort: BenchEffort
}

export function entryId(slug: string, effort: BenchEffort): string {
  return `${slug}.${effort}`
}

/** Every supported pair, in model then effort order. */
export function allEntries(
  models: readonly BenchModel[] = MODELS,
): MatrixEntry[] {
  return models.flatMap((each) =>
    EFFORTS.filter((effort) => each.efforts.includes(effort)).map((effort) => ({
      id: entryId(each.slug, effort),
      model: each.model,
      slug: each.slug,
      label: each.label,
      effort,
    })),
  )
}

/** Effort levels up to and including `effort`. */
export function upTo(effort: BenchEffort): BenchEffort[] {
  return EFFORTS.slice(0, EFFORTS.indexOf(effort) + 1)
}

export type Selection = { entries: MatrixEntry[]; skipped: string[] }

/**
 * Entries named by `--only`: entry ids ("opus-5-5.high"), a model slug
 * ("opus-5-5", every level it accepts), an effort ("high", every model),
 * or "<=high" (every level up to high). Unsupported pairs are skipped with
 * a reason; an unknown name is an error.
 */
export function selectEntries(
  only: readonly string[],
  models: readonly BenchModel[] = MODELS,
): Selection {
  const supported = allEntries(models)
  if (only.length === 0) return { entries: supported, skipped: [] }
  const wanted = new Set<string>()
  const skipped: string[] = []
  for (const raw of only) {
    const name = raw.trim()
    const ceiling = /^<=(\w+)$/.exec(name)?.[1]
    if (ceiling !== undefined) {
      const level = benchEffortSchema.safeParse(ceiling)
      if (!level.success) throw new Error(`Unknown effort level ${ceiling}`)
      const levels = upTo(level.data)
      for (const entry of supported) {
        if (levels.includes(entry.effort)) wanted.add(entry.id)
      }
      continue
    }
    const effort = benchEffortSchema.safeParse(name)
    if (effort.success) {
      for (const each of models) {
        if (each.efforts.includes(effort.data)) {
          wanted.add(entryId(each.slug, effort.data))
        } else {
          skipped.push(`${each.label} does not accept effort ${effort.data}`)
        }
      }
      continue
    }
    const model = models.find((each) => each.slug === name)
    if (model) {
      for (const entry of supported) {
        if (entry.slug === model.slug) wanted.add(entry.id)
      }
      continue
    }
    const [slug, level] = name.split(".")
    const pair = models.find((each) => each.slug === slug)
    const parsed = benchEffortSchema.safeParse(level)
    if (pair === undefined || !parsed.success) {
      throw new Error(`Unknown entry ${name}`)
    }
    if (!pair.efforts.includes(parsed.data)) {
      skipped.push(
        `${pair.label} does not accept effort ${parsed.data}: ${name} skipped`,
      )
      continue
    }
    wanted.add(name)
  }
  return {
    entries: supported.filter((entry) => wanted.has(entry.id)),
    skipped,
  }
}
