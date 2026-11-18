/**
 * Mezo IDs ("alice.mezo"), as Mezo's accounts API takes them
 * (`/accounts/{id}`), probed 13 Nov 2026:
 *
 * - Exact match only, no prefix search: "alic.mezo" is simply not found.
 * - Case-sensitive, and claimed IDs are stored lower case: "ALICE.mezo" is
 *   not found and "Alice.Mezo" is refused as invalid (422). So a typed ID
 *   is lower-cased before the lookup.
 * - The name before ".mezo" takes letters, digits and hyphens. An
 *   underscore, a space, a dot or anything non-ASCII is refused (422).
 * - The API sets no length limit; we keep to 63 characters, a DNS label,
 *   so a long typed string never becomes an upstream request.
 * - A bare name ("alice") is not an ID upstream (404): the ".mezo" is
 *   added here.
 *
 * Pure and tiny: route loaders that ship in every page's entry chunk
 * import it.
 */

const label = /^[a-z0-9-]{1,63}$/
const letter = /[a-z]/
const suffix = ".mezo"

/**
 * A Mezo ID typed or linked in full ("Alice.mezo", " alice.mezo "), as
 * the lower-case ID to look up, or null when it is not one.
 */
export function canonicalMezoId(raw: string): string | null {
  const value = raw.trim().toLowerCase()
  if (!value.endsWith(suffix)) return null
  const name = value.slice(0, -suffix.length)
  return label.test(name) ? `${name}${suffix}` : null
}

/**
 * What a search query could be as a Mezo ID: "alice.mezo" always, and a
 * bare word ("alice") as "alice.mezo" when it has two characters or more
 * and at least one letter (a bare number is an epoch, a lock or a block).
 */
export function mezoIdFromQuery(raw: string): string | null {
  const value = raw.trim().toLowerCase()
  if (value.endsWith(suffix)) return canonicalMezoId(value)
  if (value.length < 2 || !label.test(value) || !letter.test(value)) {
    return null
  }
  return `${value}${suffix}`
}
