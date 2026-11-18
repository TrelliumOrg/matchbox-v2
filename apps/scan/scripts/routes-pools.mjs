// Pools routes for measure and Lighthouse, on the /internal/scan/crosschain
// fixtures (src/data/scan/fixtures/crosschain.ts): the list, a pool on
// Ethereum and a pool on Mezo.
export const curvePool = "0xb5571e76693ba60110b5811dd650ffefce1c955f"
export const tigrisPool = "0xcc372b7e15535ab225fe17c1075831d38ef7ac1a"

export const poolsRoutes = [
  "/pools",
  `/pools/ethereum/${curvePool}`,
  `/pools/${tigrisPool}`,
]

export const poolsLighthouseRoutes = ["/pools"]
