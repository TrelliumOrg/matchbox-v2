import { PGlite } from "@electric-sql/pglite"
import { ESCROW_MAXTIME, ESCROW_MAXTIME_SLOT } from "@matchbox/chain"
import { toHex } from "viem"
import { z } from "zod"
import { RpcClient } from "../src/ingest/rpc"
import { applyMigrations } from "./row-seq/pglite"

// A Mezo RPC that answers eth_blockNumber (HEAD) and eth_getStorageAt for
// the escrows' MAXTIME slot, and a PGlite warehouse migrated up to a given
// file, for the Worker's /health and tick checks.

export const HEAD = 13_000_000n

export const CONFIG = {
  network: "mezo" as const,
  chainId: 31612,
  startBlock: 5_000_000n,
  confirmations: 2n,
  windowSize: 10_000n,
  endpoints: [
    { url: "https://recorded.test", maxAddresses: 100, maxBlockRange: 10_000 },
  ],
}

const EXPECTED = new Map<string, bigint>(Object.entries(ESCROW_MAXTIME))

const requestSchema = z.object({
  id: z.number(),
  method: z.string(),
  params: z.array(z.unknown()),
})

type RpcRequest = z.output<typeof requestSchema>

function answer(request: RpcRequest, maxTime: Record<string, bigint>) {
  if (request.method === "eth_blockNumber") return toHex(HEAD)
  if (request.method === "eth_getStorageAt") {
    const escrow = z.string().parse(request.params[0])
    if (request.params[1] !== toHex(ESCROW_MAXTIME_SLOT)) {
      throw new Error(`Unexpected slot ${String(request.params[1])}`)
    }
    return toHex(maxTime[escrow] ?? EXPECTED.get(escrow) ?? 0n)
  }
  throw new Error(`Unexpected ${request.method}`)
}

/** `maxTime` overrides an escrow's MAXTIME slot. */
export function fakeRpc(maxTime: Record<string, bigint> = {}): RpcClient {
  return new RpcClient({
    network: "mezo",
    endpoints: CONFIG.endpoints,
    sleep: async () => {},
    async fetch(_input, init) {
      const parsed = z
        .union([requestSchema, z.array(requestSchema)])
        .parse(JSON.parse(String(init?.body)))
      const reply = (request: RpcRequest) => ({
        jsonrpc: "2.0",
        id: request.id,
        result: answer(request, maxTime),
      })
      return Response.json(
        Array.isArray(parsed) ? parsed.map(reply) : reply(parsed),
      )
    },
  })
}

/** Migrations up to and including `last` (all when null), ingest near head. */
export async function migratedThrough(last: string | null): Promise<PGlite> {
  const db = new PGlite()
  await applyMigrations(db, (name) => last === null || name <= last)
  await db.query(
    `INSERT INTO matchbox.indexer_checkpoints (network, stream, last_block)
     VALUES ('mezo', 'logs', $1)`,
    [(HEAD - 100n).toString()],
  )
  return db
}
