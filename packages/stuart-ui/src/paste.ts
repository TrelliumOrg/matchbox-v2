// Pasting a governance post ("25% to the BTC/MUSD-200 pool" on one line,
// "20% to the MUSD Savings Vault" on the next) into a one-line input: the
// browser drops the newlines and runs the lines together
// ("...-200 pool20% to..."). Stuart's inputs keep them apart with " | ",
// which its vote script reader splits on.

/** Lines joined by " | ", blank lines dropped; one-line text unchanged. */
export function flattenPaste(text: string): string {
  if (!/[\r\n]/.test(text)) return text
  return text
    .split(/\r?\n|\r/)
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .join(" | ")
}

/**
 * The input's value after pasting multi-line text over the selection, at
 * most `max` characters; null for one-line text (the browser pastes it).
 */
export function pastedValue(input: {
  value: string
  pasted: string
  start: number | null
  end: number | null
  max: number
}): string | null {
  if (!/[\r\n]/.test(input.pasted)) return null
  const start = input.start ?? input.value.length
  const end = input.end ?? start
  return `${input.value.slice(0, start)}${flattenPaste(input.pasted)}${input.value.slice(end)}`.slice(
    0,
    input.max,
  )
}
