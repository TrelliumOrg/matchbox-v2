// A whole number of at least 1, or an error naming the flag. parseInt would
// turn "x" into NaN and "0" into no workers, which then fetch nothing.
export function parsePositiveInteger(flag: string, value: string): number {
  const trimmed = value.trim()
  if (
    !/^[1-9][0-9]*$/.test(trimmed) ||
    !Number.isSafeInteger(Number(trimmed))
  ) {
    throw new Error(
      `${flag} must be a whole number of at least 1, got "${value}"`,
    )
  }
  return Number(trimmed)
}
