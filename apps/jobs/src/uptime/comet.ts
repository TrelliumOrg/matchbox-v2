import { z } from "zod"
import {
  type Commit,
  consensusAddressOf,
  consensusKeyOf,
  operatorOf,
  type Weighted,
} from "./decode"

// Reading a community CometBFT node: Pathrock's public archive node first,
// Lavender Five's pruned node as the live fallback. Neither has an SLA, so
// every call has a timeout, retries with backoff, and every answer is
// validated. Mezo's own RPCs serve EVM JSON-RPC only (README, "Validator
// uptime").

export const defaultUptimeNodes = {
  rpc: "https://comet.mezo-archive.pathrocknetwork.org",
  rest: "https://rest.mezo-archive.pathrocknetwork.org",
  fallbackRpc: "https://rpc.lavenderfive.com/mezo",
  fallbackRest: "https://rest.lavenderfive.com/mezo",
} as const

export type CometNode = {
  /** 'pathrock', 'lavender', or the host of a configured node. */
  label: string
  rpc: string
  rest: string
}

export function nodeLabel(url: string): string {
  const host = (() => {
    try {
      return new URL(url).host
    } catch {
      return url
    }
  })()
  if (host.includes("pathrock")) return "pathrock"
  if (host.includes("lavenderfive")) return "lavender"
  return host
}

export function cometNode(rpc: string, rest: string): CometNode {
  return {
    label: nodeLabel(rpc),
    rpc: rpc.replace(/\/+$/, ""),
    rest: rest.replace(/\/+$/, ""),
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

const decimal = z.string().regex(/^-?[0-9]+$/)
const hexAddress = z
  .string()
  .regex(/^[0-9A-Fa-f]{40}$/)
  .transform((value) => value.toUpperCase())

const statusSchema = z.object({
  result: z.object({
    sync_info: z.object({
      latest_block_height: decimal,
      latest_block_time: z.string(),
      earliest_block_height: decimal,
      catching_up: z.boolean(),
    }),
  }),
})

/** "2026-11-12T06:32:52.732933668Z" as unix seconds. */
export function secondsOf(time: string): number {
  const ms = Date.parse(time.replace(/(\.\d{1,3})\d*Z$/, "$1Z"))
  if (!Number.isFinite(ms)) throw new Error(`Unreadable block time ${time}`)
  return Math.floor(ms / 1000)
}

export const commitResultSchema = z.object({
  signed_header: z.object({
    header: z.object({
      height: decimal,
      time: z.string(),
      validators_hash: z.string().regex(/^[0-9A-Fa-f]{64}$/),
      proposer_address: hexAddress,
    }),
    commit: z.object({
      height: decimal,
      round: z.number().int().min(0),
      signatures: z.array(
        z.object({
          block_id_flag: z.number().int(),
          // Empty for an absent signer.
          validator_address: z.string().regex(/^([0-9A-Fa-f]{40})?$/),
        }),
      ),
    }),
  }),
  canonical: z.boolean(),
})

export function commitOf(result: z.output<typeof commitResultSchema>): Commit {
  const { header, commit } = result.signed_header
  return {
    height: Number(header.height),
    time: secondsOf(header.time),
    round: commit.round,
    proposer: header.proposer_address,
    validatorsHash: header.validators_hash.toUpperCase(),
    signatures: commit.signatures.map((signature) => ({
      flag: signature.block_id_flag,
      address: signature.validator_address.toUpperCase(),
    })),
  }
}

const batchSchema = z.array(
  z.object({
    id: z.number().int(),
    result: z.unknown().optional(),
    error: z.object({ message: z.string() }).optional(),
  }),
)

export const validatorsResultSchema = z.object({
  result: z.object({
    block_height: decimal,
    validators: z.array(
      z.object({
        address: hexAddress,
        pub_key: z.object({ type: z.string(), value: z.string() }),
        voting_power: decimal,
        proposer_priority: decimal,
      }),
    ),
    count: decimal,
    total: decimal,
  }),
})

export type SetEntry = Weighted & { pubKey: string }

export const poaValidatorsSchema = z.object({
  validators: z.array(
    z.object({
      operator_bech32: z.string(),
      cons_pub_key_bech32: z.string(),
      description: z.object({ moniker: z.string() }).partial().optional(),
    }),
  ),
})

/** A PoA validator: who an ed25519 key belongs to. */
export type PoaValidator = {
  operator: string
  consensus: string
  moniker: string | null
}

export function poaValidatorsOf(
  body: z.output<typeof poaValidatorsSchema>,
): PoaValidator[] {
  return body.validators.flatMap((validator) => {
    const moniker = validator.description?.moniker?.trim() ?? ""
    try {
      return [
        {
          operator: operatorOf(validator.operator_bech32),
          consensus: consensusAddressOf(
            consensusKeyOf(validator.cons_pub_key_bech32),
          ),
          moniker: moniker === "" ? null : moniker,
        },
      ]
    } catch {
      return []
    }
  })
}

export type NodeStatus = {
  height: number
  time: number
  earliest: number
  catchingUp: boolean
}

export type CometReader = {
  status(node: CometNode): Promise<NodeStatus>
  /** Up to 10 heights in one JSON-RPC batch (the nodes' limit), in order. */
  commits(node: CometNode, heights: readonly number[]): Promise<Commit[]>
  /** The set at a height, with its proposer priorities, in commit order. */
  validators(node: CometNode, height: number): Promise<SetEntry[]>
  poaValidators(node: CometNode): Promise<PoaValidator[]>
}

/** The nodes refuse batches over 10 requests. */
export const maxBatch = 10

class NodeError extends Error {}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * A reader over `fetch`, with a timeout per call and up to `attempts`
 * tries, backing off 0.5 s then 1.5 s on a network error, 429 or 5xx.
 */
export function createCometReader(options: {
  fetcher: FetchLike
  timeoutMs?: number
  attempts?: number
  backoffMs?: number
}): CometReader {
  const timeoutMs = options.timeoutMs ?? 8_000
  const attempts = options.attempts ?? 2
  const backoffMs = options.backoffMs ?? 500

  async function json(url: string, init?: RequestInit): Promise<unknown> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        const response = await options.fetcher(url, {
          ...init,
          signal: AbortSignal.timeout(timeoutMs),
        })
        if (response.ok) return await response.json()
        const retry = response.status === 429 || response.status >= 500
        if (!retry || attempt >= attempts) {
          throw new NodeError(`${nodeLabel(url)} answered ${response.status}`)
        }
      } catch (error) {
        if (error instanceof NodeError || attempt >= attempts) throw error
      }
      await wait(backoffMs * 3 ** (attempt - 1))
    }
  }

  return {
    async status(node) {
      const body = statusSchema.parse(await json(`${node.rpc}/status`))
      const info = body.result.sync_info
      return {
        height: Number(info.latest_block_height),
        time: secondsOf(info.latest_block_time),
        earliest: Number(info.earliest_block_height),
        catchingUp: info.catching_up,
      }
    },
    async commits(node, heights) {
      if (heights.length === 0) return []
      if (heights.length > maxBatch) throw new Error("Batch over 10 heights")
      const body = batchSchema.parse(
        await json(`${node.rpc}/`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            heights.map((height, id) => ({
              jsonrpc: "2.0",
              id,
              method: "commit",
              params: { height: String(height) },
            })),
          ),
        }),
      )
      return heights.map((height, id) => {
        const item = body.find((each) => each.id === id)
        if (item === undefined || item.error !== undefined) {
          throw new NodeError(
            `${node.label} commit ${height}: ${item?.error?.message ?? "no answer"}`,
          )
        }
        const result = commitResultSchema.parse(item.result)
        if (!result.canonical) {
          throw new NodeError(`${node.label} commit ${height} not canonical`)
        }
        const commit = commitOf(result)
        if (commit.height !== height) {
          throw new NodeError(`${node.label} answered height ${commit.height}`)
        }
        return commit
      })
    },
    async validators(node, height) {
      const entries: SetEntry[] = []
      for (let page = 1; page <= 5; page += 1) {
        const body = validatorsResultSchema.parse(
          await json(
            `${node.rpc}/validators?height=${height}&page=${page}&per_page=100`,
          ),
        )
        for (const validator of body.result.validators) {
          entries.push({
            address: validator.address,
            power: BigInt(validator.voting_power),
            priority: BigInt(validator.proposer_priority),
            pubKey: validator.pub_key.value,
          })
        }
        if (entries.length >= Number(body.result.total)) return entries
      }
      throw new NodeError(`${node.label} validators ${height}: too many pages`)
    },
    async poaValidators(node) {
      return poaValidatorsOf(
        poaValidatorsSchema.parse(
          await json(`${node.rest}/mezo/poa/v1/validators`),
        ),
      )
    },
  }
}
