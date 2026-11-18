import {
  createPublicClient,
  decodeFunctionData,
  type Hex,
  http,
  parseAbi,
} from "viem"
import { z } from "zod"
import { RPC } from "./truth.ts"

// Checks for the action cases, independent of Stuart's code: a claim's
// calldata is decoded and every (reward contract, token, lock) is read with
// earned() on Mezo RPC at the head, and must equal what the proposal shows.
// The Ctrl K search route is asked directly.

const CLAIM_ABI = parseAbi([
  "function claimBribes(address[] _bribes, address[][] _tokens, uint256 _tokenId)",
  "function claimFeesAndBribes(address[] rewards, address[][] tokens, uint256 tokenId)",
])
const EARNED_ABI = parseAbi([
  "function earned(address token, uint256 tokenId) view returns (uint256)",
])

export const proposalSchema = z.looseObject({
  kind: z.string(),
  calls: z.array(
    z.looseObject({ to: z.string(), data: z.string(), kind: z.string() }),
  ),
  content: z.looseObject({
    kind: z.string(),
    rows: z
      .array(
        z.looseObject({
          tokenId: z.string().nullable(),
          rewards: z.array(
            z.object({
              token: z.string(),
              amount: z.object({ raw: z.string() }),
            }),
          ),
        }),
      )
      .optional(),
  }),
})

export type EvalProposal = z.infer<typeof proposalSchema>

/**
 * True when every claimed amount equals earned() on chain. Rewards can only
 * grow between Stuart's block and this read, so an amount within one epoch
 * of accrual (never above the chain) passes.
 */
export async function verifyClaimAmounts(
  proposal: EvalProposal,
): Promise<{ ok: boolean; note: string }> {
  const client = createPublicClient({ transport: http(RPC) })
  const shown = new Map<string, bigint>()
  for (const row of proposal.content.rows ?? []) {
    for (const reward of row.rewards) {
      const key = `${row.tokenId}:${reward.token.toLowerCase()}`
      shown.set(key, (shown.get(key) ?? 0n) + BigInt(reward.amount.raw))
    }
  }
  const chain = new Map<string, bigint>()
  for (const call of proposal.calls) {
    if (call.kind !== "claim") continue
    const decoded = decodeFunctionData({
      abi: CLAIM_ABI,
      data: call.data as Hex,
    })
    const [contracts, tokens, tokenId] = decoded.args
    for (const [index, contract] of contracts.entries()) {
      for (const token of tokens[index] ?? []) {
        const earned = await client.readContract({
          address: contract,
          abi: EARNED_ABI,
          functionName: "earned",
          args: [token, tokenId],
        })
        const key = `${tokenId}:${token.toLowerCase()}`
        chain.set(key, (chain.get(key) ?? 0n) + earned)
      }
    }
  }
  if (shown.size === 0) return { ok: false, note: "no claim rows" }
  for (const [key, amount] of shown) {
    const onChain = chain.get(key)
    if (onChain === undefined) return { ok: false, note: `no call for ${key}` }
    if (amount !== onChain) {
      return { ok: false, note: `${key} shown ${amount}, chain ${onChain}` }
    }
  }
  return { ok: true, note: `${shown.size} amounts equal earned()` }
}

const searchSchema = z.object({
  query: z.string(),
  results: z.array(z.looseObject({ type: z.string() })),
})

export async function searchCheck(input: {
  base: string
  origin: string
  query: string
  expect: (results: Array<Record<string, unknown>>) => string | null
}): Promise<{ ok: boolean; note: string; results: unknown[] }> {
  const response = await fetch(
    `${input.base}/search?q=${encodeURIComponent(input.query)}`,
    { headers: { origin: input.origin } },
  )
  if (!response.ok) {
    return { ok: false, note: `http ${response.status}`, results: [] }
  }
  const parsed = searchSchema.safeParse(await response.json())
  if (!parsed.success) return { ok: false, note: "schema", results: [] }
  const problem = input.expect(parsed.data.results)
  return {
    ok: problem === null,
    note: problem ?? `${parsed.data.results.length} results`,
    results: parsed.data.results,
  }
}
