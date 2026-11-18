import { CONTRACTS } from "@matchbox/chain"
import type { BoostTotals } from "@matchbox/domain"

/**
 * The two escrow totals the boost formula needs, read from Mezo through
 * the Network setting's RPC: veBTC `unboostedTotalVotingPower()` and
 * veMEZO `totalVotingPower()`, both at one block. The same two reads as
 * Matchbox Classic's calculator.
 *
 * Plain fetch with hand-checked JSON, like the Network setting's Test, so
 * the calculator works signed out without loading the wallet code.
 *
 * A failed read throws. There are no placeholder totals: Classic fell back
 * to made-up ones (400 veBTC, 500M veMEZO) without saying so, and every
 * figure on the page was then wrong.
 */

export type BoostTotalsRead = BoostTotals & {
  block: number
  /** The block's time, unix seconds. */
  readAt: number
}

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>

const timeoutMs = 8_000

/** `unboostedTotalVotingPower()` and `totalVotingPower()`. */
const selectors = {
  veBtcTotal: "0xdbfeca50",
  veMezoTotal: "0x671b3793",
} as const

function hex(value: unknown): bigint {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) {
    throw new Error("Unexpected RPC result")
  }
  return BigInt(value)
}

async function post(
  fetcher: Fetcher,
  url: string,
  body: unknown,
): Promise<unknown> {
  const response = await fetcher(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) throw new Error(`RPC answered ${response.status}`)
  return response.json()
}

function resultOf(body: unknown): unknown {
  if (typeof body !== "object" || body === null) {
    throw new Error("Unexpected RPC response")
  }
  const result: unknown = Reflect.get(body, "result")
  if (result === undefined || result === null) {
    throw new Error("RPC returned an error")
  }
  return result
}

export async function readBoostTotals(
  rpcUrl: string,
  fetcher: Fetcher = (url, init) => fetch(url, init),
): Promise<BoostTotalsRead> {
  const head = resultOf(
    await post(fetcher, rpcUrl, {
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getBlockByNumber",
      params: ["latest", false],
    }),
  )
  if (typeof head !== "object" || head === null) {
    throw new Error("Unexpected block")
  }
  const number: unknown = Reflect.get(head, "number")
  const block = hex(number)
  const readAt = hex(Reflect.get(head, "timestamp"))
  const call = (id: number, to: string, data: string) => ({
    jsonrpc: "2.0",
    id,
    method: "eth_call",
    params: [{ to, data }, number],
  })
  const answers = await post(fetcher, rpcUrl, [
    call(1, CONTRACTS.mainnet.veBTC, selectors.veBtcTotal),
    call(2, CONTRACTS.mainnet.veMEZO, selectors.veMezoTotal),
  ])
  if (!Array.isArray(answers)) throw new Error("Unexpected RPC response")
  const byId = (id: number): bigint =>
    hex(
      resultOf(
        answers.find(
          (answer: unknown) =>
            typeof answer === "object" &&
            answer !== null &&
            Reflect.get(answer, "id") === id,
        ),
      ),
    )
  const veBtc = byId(1)
  const veMezo = byId(2)
  // An escrow with no voting power is not a state Mezo is in: treat it as
  // a bad answer, not as totals to divide by.
  if (veBtc === 0n || veMezo === 0n) throw new Error("Empty totals")
  return { veBtc, veMezo, block: Number(block), readAt: Number(readAt) }
}

/** How old a read may be before the open sheet reads again. */
export const refreshSeconds = 60

// The last good read of this visit, kept across opens of the sheet.
let last: BoostTotalsRead | null = null

export function lastBoostTotals(): BoostTotalsRead | null {
  return last
}

export function rememberBoostTotals(read: BoostTotalsRead): void {
  last = read
}

/** Test helper. */
export function forgetBoostTotals(): void {
  last = null
}
