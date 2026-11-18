/**
 * Search over gauge names and pool types, apart from the labels so a page
 * that only names gauges does not carry it.
 */

/**
 * Whether a search matches a gauge by name, pool type or both
 * ("btc/musd cl200", "volatile", "cl2000"). Every word must match.
 */
export function matchesGaugeSearch(
  query: string,
  name: string,
  label: string | null,
): boolean {
  return matchesWords(
    query,
    [name, label ?? "", poolTypeWords(label)].join(" "),
  )
}

/**
 * Whether every word of `query` is in `text`, ignoring case. A word is
 * found anywhere in the text ("btc" in "mSolvBTC/MUSD"), except a tick
 * spacing label, which must be a whole word: "cl200" does not find CL2000.
 */
export function matchesWords(query: string, text: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const lower = text.toLowerCase()
  const tokens = new Set(lower.split(/\s+/))
  return words.every((word) =>
    /^cl[0-9]+$/.test(word) ? tokens.has(word) : lower.includes(word),
  )
}

function poolTypeWords(label: string | null): string {
  if (label === null) return ""
  if (label.startsWith("CL")) return "concentrated cl"
  return "basic"
}
