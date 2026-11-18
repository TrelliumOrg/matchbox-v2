/** The gauge card's view-transition name, shared with the profile picture. */
export function gaugeTransitionName(address: string): string {
  return `gauge-${address.toLowerCase()}`
}
