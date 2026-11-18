import { REWARD_OPTIMIZER_VERSION } from "@matchbox/domain/voteOptimization"

// Calculation versions shown in source chips. Bump when the math or its
// inputs change so old answers stay attributable. The optimizer's version is
// @matchbox/domain's, shared with the Vote page and the MCP.
export const OPTIMIZER_CALC_VERSION = REWARD_OPTIMIZER_VERSION
export const LOAN_CALC_VERSION = "1.0.0"
export const ZAP_CALC_VERSION = "1.0.0"
export const CLAIM_CALC_VERSION = "1.0.0"

/** "Calc v1.0.0" for semver versions, "Calc optimizer-live-v2" otherwise. */
export function calcChip(version: string): string {
  return /^\d/.test(version) ? `Calc v${version}` : `Calc ${version}`
}

// Epoch numbers come from the one app-wide definition, so Stuart's answers
// match the pages.
export { epochNumberFor } from "@matchbox/domain/epoch"
