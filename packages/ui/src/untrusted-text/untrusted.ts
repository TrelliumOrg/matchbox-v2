/**
 * Strings the chain supplies (token names and symbols, contract and method
 * names, decoded values, labels) are untrusted: anyone can deploy a token
 * named with a right-to-left override that flips the text around it, or
 * hide characters with zero-width ones, a known explorer spoofing trick.
 * Such characters are shown as visible escapes ("U+202E"), never applied.
 */

/**
 * Code point ranges never rendered as themselves, as numbers so this
 * source holds no invisible characters: C0 and C1 controls and DEL, the
 * Arabic letter mark, Hangul and Khmer fillers, the Mongolian vowel
 * separator, zero-width spaces and joiners, bidi marks, embeddings,
 * overrides and isolates, invisible operators, variation selectors, the
 * byte order mark and interlinear annotation controls.
 */
const hiddenRanges: readonly (readonly [number, number])[] = [
  [0x0000, 0x001f],
  [0x007f, 0x009f],
  [0x061c, 0x061c],
  [0x115f, 0x1160],
  [0x17b4, 0x17b5],
  [0x180e, 0x180e],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x2064],
  [0x2066, 0x206f],
  [0x3164, 0x3164],
  [0xfe00, 0xfe0f],
  [0xfeff, 0xfeff],
  [0xffa0, 0xffa0],
  [0xfff9, 0xfffb],
]

function isHidden(point: number): boolean {
  return hiddenRanges.some(([start, end]) => point >= start && point <= end)
}

export type Segment =
  | { kind: "text"; text: string }
  /** A character shown as its code point instead of applied: "U+202E". */
  | { kind: "escape"; code: string }

export type CleanText = {
  segments: Segment[]
  /** The value was longer than the limit; `segments` hold its start. */
  truncated: boolean
}

function codeOf(point: number): string {
  return `U+${point.toString(16).toUpperCase().padStart(4, "0")}`
}

/**
 * The value as text and escapes, at most `limit` characters of it. One pass
 * over the string, so its time is linear in the limit.
 */
export function cleanUntrusted(value: string, limit = 200): CleanText {
  const truncated = value.length > limit
  const visible = truncated ? value.slice(0, limit) : value
  const segments: Segment[] = []
  let text = ""
  for (const char of visible) {
    const point = char.codePointAt(0) ?? 0
    if (isHidden(point)) {
      if (text !== "") segments.push({ kind: "text", text })
      text = ""
      segments.push({ kind: "escape", code: codeOf(point) })
    } else {
      text += char
    }
  }
  if (text !== "") segments.push({ kind: "text", text })
  return { segments, truncated }
}

/** The same, as one plain string, for attributes (title, aria-label). */
export function plainUntrusted(value: string, limit = 200): string {
  const { segments, truncated } = cleanUntrusted(value, limit)
  const text = segments
    .map((segment) =>
      segment.kind === "text" ? segment.text : `[${segment.code}]`,
    )
    .join("")
  return truncated ? `${text}…` : text
}
