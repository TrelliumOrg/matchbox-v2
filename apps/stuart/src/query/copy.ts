// Matchbox copy rules for everything Stuart shows: no em or en dashes, no
// middle dots, no semicolons. Templates are written that way (a test scans
// them); model sentences are normalised here before they are checked.

/** Characters Stuart never shows. */
export const FORBIDDEN_COPY = /[\u2014\u2013\u00b7;]/

/**
 * Rewrites a model sentence to the copy rules: a numeric range dash becomes
 * "to", other dashes, middle dots and semicolons become commas. A semicolon
 * never ends a sentence: it would add one the model did not write.
 */
export function normalizeCopy(text: string): string {
  return text
    .replace(/(\d)\s*[\u2013\u2014]\s*(\d)/g, "$1 to $2")
    .replace(/\s*[\u2014\u2013]\s*/g, ", ")
    .replace(/\s*\u00b7\s*/g, ", ")
    .replace(/\s*;\s*/g, ", ")
    .replace(/,\s*,/g, ",")
    .replace(/\s+/g, " ")
    .trim()
}
