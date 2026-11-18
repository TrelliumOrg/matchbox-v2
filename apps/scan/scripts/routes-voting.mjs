// Voting and Locks routes (gauges, epochs, locks) for measure and Lighthouse,
// on ids the /internal/scan fixtures hold (src/data/scan/fixtures/voting.ts).
/** Kiln Labs, a veBTC gauge with a profile, votes and deposits. */
export const fixtureGauge = "0x4da4c05483324ea9cfc951510a5e77cc79541159"
/** BTC/MUSD (CL), a pool gauge: its pool's series. */
export const fixturePoolGauge = "0x21d7f14f42c560edd409b815d2c6e9be1b0f209e"

export const votingRoutes = [
  `/gauges/${fixtureGauge}`,
  `/gauges/${fixturePoolGauge}`,
  "/epochs/47",
  "/epochs/45",
  "/locks/vebtc/604",
  "/locks/vemezo/2207",
]

export const votingLighthouseRoutes = [
  "/epochs",
  "/locks",
  `/gauges/${fixtureGauge}`,
  "/epochs/47",
  "/locks/vemezo/2207",
]
