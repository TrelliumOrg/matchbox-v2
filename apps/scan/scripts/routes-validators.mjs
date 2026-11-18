// Validators routes for measure and Lighthouse, on ids the fixtures hold
// (src/data/scan/fixtures/validators.ts).
/** Harbor Stake's operator: the proposer of recorded block 13,118,576. */
export const fixtureOperator = "0x41b1a7f633eb9dac1fc19adae41aa7562c620971"
/** Proposer of recorded block 13,118,577, in no validator's gauge. */
export const fixtureOutsideProposer =
  "0xd056656123bea72fe9139bac0539b8f53d850247"

export const validatorsRoutes = [
  "/validators?epoch=46",
  `/validators/${fixtureOperator}`,
]

export const validatorsLighthouseRoutes = [
  "/validators",
  `/validators/${fixtureOperator}`,
]
