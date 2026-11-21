// Secrets out of the logs and support reports. Workers observability keeps
// every request, so no log line may carry a key or a recovery phrase a
// user pasted, or one the model repeated (a rejected answer logs its
// unsourced items); a support report is stored in Supabase.
//
// Every Stuart log call goes through `redactLogEvent`: the app's logger
// and the orchestrator's runtime both wrap it. The secret is replaced by
// a marker and the line gains a count and the reasons.
//
// Redaction is conservative (secretShapes.ts): when unsure, redact. Every
// 64-hex string goes unless one of this turn's tools returned it from a
// chain read (`verified`), whatever the words around it or the link it sits in say;
// so does every run of 12 or more short words in a log line. Ordinary
// error text, 40-hex addresses and lock ids stay readable.

import {
  phraseSpans,
  type SecretKind,
  type SecretOptions,
  secretSpans,
} from "./secretShapes"

export type RedactionReason = SecretKind

export type Redacted = {
  text: string
  count: number
  reasons: RedactionReason[]
}

/** The marker a secret is replaced by. */
const MARKER = /\[redacted:[a-z_]+\]/g

/** The text with every key or phrase replaced by a marker. */
export function redactSecrets(
  text: string,
  options: SecretOptions = {},
): Redacted {
  const reasons = new Set<RedactionReason>()
  const spans = secretSpans(text, options)
  let out = ""
  let at = 0
  for (const span of spans) {
    out += `${text.slice(at, span.start)}[redacted:${span.kind}]`
    reasons.add(span.kind)
    at = span.end
  }
  out += text.slice(at)
  let count = spans.length
  // A secret the replacements left (they should not: the spans are read
  // once): the whole text goes.
  const left = secretSpans(out, options)[0]
  if (left !== undefined) {
    count += 1
    reasons.add(left.kind)
    out = "[redacted:text]"
  }
  return { text: out, count, reasons: [...reasons] }
}

/**
 * The text redacted, then cut to `max` characters. Redacting first keeps
 * a key that crosses the cut from staying partly visible; a marker the
 * cut would split is dropped whole.
 */
export function redactAndClip(
  text: string,
  max: number,
  options: SecretOptions = {},
): string {
  const redacted = redactSecrets(text, options).text
  const markers = [...redacted.matchAll(MARKER)].map((marker) => ({
    start: marker.index,
    end: marker.index + marker[0].length,
  }))
  return clipOutside(redacted, max, markers)
}

/** The text cut to `max`, never inside one of `spans`. */
function clipOutside(
  text: string,
  max: number,
  spans: ReadonlyArray<{ start: number; end: number }>,
): string {
  if (text.length <= max) return text
  let cut = max
  for (const span of spans) {
    if (span.start < cut && span.end > cut) cut = span.start
  }
  return text.slice(0, cut)
}

/**
 * The text cut to `max` characters, unredacted, never inside a secret: a
 * key or phrase the cut would split is dropped whole. For text a tool
 * redacts itself once it knows what it verified (the support report).
 */
export function clipOutsideSecrets(text: string, max: number): string {
  return clipOutside(text, max, secretSpans(text))
}

type Tally = { count: number; reasons: Set<RedactionReason> }

/** Every string inside a log value, redacted; the total and reasons. */
function redactValue(
  value: unknown,
  tally: Tally,
  depth: number,
  options: SecretOptions,
): unknown {
  if (typeof value === "string") {
    const redacted = redactSecrets(value, options)
    tally.count += redacted.count
    for (const reason of redacted.reasons) tally.reasons.add(reason)
    return redacted.text
  }
  if (depth > 6 || value === null || typeof value !== "object") return value
  if (Array.isArray(value)) {
    const items = value.map((each) =>
      redactValue(each, tally, depth + 1, options),
    )
    // A phrase split across items ("not a warning: abandon ability ...",
    // six words each) is read across them: the strings go together.
    const strings = items.filter((each) => typeof each === "string")
    if (strings.length > 1 && phraseSpans(strings.join(" ")).length > 0) {
      tally.count += 1
      tally.reasons.add("word_phrase")
      return items.map((each) =>
        typeof each === "string" ? "[redacted:word_phrase]" : each,
      )
    }
    return items
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, each]) => [
      key,
      redactValue(each, tally, depth + 1, options),
    ]),
  )
}

/**
 * A log event with every string field redacted. When anything was taken
 * out, the event says how many and why (`redacted`, `redactedReasons`).
 * `verified` holds the 64-hex ids a provider returned this turn: kept.
 */
export function redactLogEvent<T extends Record<string, unknown>>(
  event: T,
  verified?: ReadonlySet<string>,
): T {
  const tally: Tally = { count: 0, reasons: new Set<RedactionReason>() }
  const options: SecretOptions = verified === undefined ? {} : { verified }
  const out = redactValue(event, tally, 0, options) as T
  if (tally.count === 0) return out
  return {
    ...out,
    redacted: tally.count,
    redactedReasons: [...tally.reasons],
  }
}

/**
 * A logger that redacts every event before it is written. `verified` may
 * grow during the turn, as tools return ids.
 */
export function redactingLog<T extends Record<string, unknown>>(
  log: (event: T) => void,
  verified?: ReadonlySet<string>,
): (event: T) => void {
  return (event) => log(redactLogEvent(event, verified))
}
