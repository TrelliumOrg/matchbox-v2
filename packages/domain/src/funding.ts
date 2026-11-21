/**
 * When a gauge counts as funded, and when its APY is worth a headline.
 * Stuart and Pro both decide funding here.
 *
 * A token counts by registry address, never by symbol: anyone can post a
 * token named "MUSD" on a gauge. So:
 *
 * - A registry token with a USD value counts for that value. Less than a
 *   cent of those is dust, not funding.
 * - A registry token without a USD value counts as funding of unknown
 *   size: it is a real token, and its size cannot be judged.
 * - An unregistered token never counts as funding, whatever its amount.
 *
 * Above that, an APY worked out from a few cents, or from a handful of
 * votes, says nothing about what a vote earns: $0.28 over $0.39 of votes
 * read as "3,648% APY" (19 Nov 2026). Such a gauge shows its dollars and
 * no APY.
 *
 * The API rounds each token's USD half up to cents, so "funded from
 * $0.01" means funded from about $0.005 of a token.
 *
 * Exact decimal arithmetic in micro-USD and wei, no floating point, and
 * no imports, so any chunk can carry it.
 */

/** Less than a cent of incentives is dust, not funding. */
export const FUNDED_MIN_MICRO_USD = 10_000n

/** Below a dollar of incentives an APY is not shown. */
export const APY_MIN_INCENTIVES_MICRO_USD = 1_000_000n

/**
 * Below these votes (wei) an APY is not shown: 0.001 veBTC and 10,000
 * veMEZO, each a few tens of dollars at November 2026 prices.
 */
export const APY_MIN_VOTES_WEI = {
  veBTC: 10n ** 15n,
  veMEZO: 10n ** 22n,
} as const

export type ApyVoteUnit = keyof typeof APY_MIN_VOTES_WEI

const decimal = /^(\d+)(?:\.(\d*))?$/

/** A non-negative USD decimal ("0.28") in micro-USD, rounded down; 0n when not a number. */
export function usdTextToMicro(usd: string): bigint {
  const match = decimal.exec(usd.trim())
  if (match === null) return 0n
  const fraction = (match[2] ?? "").padEnd(6, "0").slice(0, 6)
  return BigInt(match[1] ?? "0") * 1_000_000n + BigInt(fraction)
}

/** One incentive token a gauge holds, with an amount above zero. */
export type FundingToken = {
  address: string
  /** In the token registry (`@matchbox/chain` `getTokenPriceType`). */
  registered: boolean
  /** Its USD value in micro-USD, or null when the read model has none. */
  usdMicro: bigint | null
}

export type Funding = {
  /**
   * `funded`: counts as funding. `unfunded`: holds tokens, but only dust
   * or unregistered tokens. `none`: holds no tokens.
   */
  status: "funded" | "unfunded" | "none"
  /** The registry tokens' USD values, micro-USD. */
  pricedMicro: bigint
  /**
   * Tokens held whose value is not counted: registry tokens without a USD
   * value, and every unregistered token.
   */
  unpriced: number
}

/** Whether, and by how much, a gauge's incentive tokens fund it. */
export function funding(tokens: readonly FundingToken[]): Funding {
  let pricedMicro = 0n
  let unknownSize = false
  const unpriced = new Set<string>()
  for (const token of tokens) {
    if (!token.registered) {
      unpriced.add(token.address.toLowerCase())
    } else if (token.usdMicro === null) {
      unknownSize = true
      unpriced.add(token.address.toLowerCase())
    } else {
      pricedMicro += token.usdMicro
    }
  }
  const status =
    tokens.length === 0
      ? "none"
      : unknownSize || pricedMicro >= FUNDED_MIN_MICRO_USD
        ? "funded"
        : "unfunded"
  return { status, pricedMicro, unpriced: unpriced.size }
}

/**
 * The votes (wei) a gauge needs before its APY shows, or null when no
 * APY can show however it is voted: not funded, or under a dollar of
 * incentives. Pro's server sends it, so the browser checks votes it
 * changes against a number and carries none of these floors.
 */
export function apyMinVotes(input: {
  funded: boolean
  incentivesUsd: string
  unit: ApyVoteUnit
}): bigint | null {
  if (!input.funded) return null
  if (usdTextToMicro(input.incentivesUsd) < APY_MIN_INCENTIVES_MICRO_USD) {
    return null
  }
  return APY_MIN_VOTES_WEI[input.unit]
}

/**
 * Which floor keeps a gauge's APY from showing, or null when it shows:
 * `incentives` under a dollar, else `votes` under the unit's floor.
 * Stuart's APY ranking leaves such gauges out by this, as Pro does.
 */
export function apyFloorMissed(input: {
  incentivesMicro: bigint
  votesWei: bigint
  unit: ApyVoteUnit
}): "incentives" | "votes" | null {
  if (input.incentivesMicro < APY_MIN_INCENTIVES_MICRO_USD) return "incentives"
  if (input.votesWei < APY_MIN_VOTES_WEI[input.unit]) return "votes"
  return null
}

/**
 * Whether a gauge's APY is worth showing: at least a dollar of incentives
 * and the floor of votes in its unit.
 */
export function apyIsMeaningful(input: {
  incentivesUsd: string
  votesWei: string | bigint
  unit: ApyVoteUnit
}): boolean {
  const votes =
    typeof input.votesWei === "bigint"
      ? input.votesWei
      : /^\d+$/.test(input.votesWei)
        ? BigInt(input.votesWei)
        : 0n
  return (
    apyFloorMissed({
      incentivesMicro: usdTextToMicro(input.incentivesUsd),
      votesWei: votes,
      unit: input.unit,
    }) === null
  )
}
