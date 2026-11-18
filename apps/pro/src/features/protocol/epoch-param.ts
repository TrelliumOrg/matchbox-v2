/** `/protocol/40`: a whole epoch number, Epoch 0 (Thu 11 Dec 2025) on. */
export function parseEpochParam(value: string): number | null {
  if (!/^\d{1,6}$/.test(value)) return null
  return Number(value)
}
