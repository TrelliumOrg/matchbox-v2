import { describe, expect, it } from "vitest"
import type { BlockscoutReader } from "./blockscout"
import {
  ACTIVITY_LIMITS,
  apiScanReader,
  createChainActivity,
  normalizeTransfers,
} from "./chainActivity"
import type { ApiFetcher } from "./readModels"

const SAFE = "0xf36593cd2e5eb2cc8ccbe5ad3b5bb2353cf98bc4"
const ENCLAVE = "0x147379A0174780570D07d70a14FB244EE5f2D786"

function ref(hash: string, name: string | null, implementation?: string) {
  return {
    hash,
    name,
    is_contract: true,
    is_verified: false,
    implementations: implementation
      ? [{ address_hash: hash, name: implementation }]
      : [],
  }
}

function item(input: {
  block: number
  timestamp: string
  type?: string
  value?: string | null
}) {
  return {
    transaction_hash: `0x${input.block.toString(16).padStart(64, "0")}`,
    block_number: input.block,
    log_index: 3,
    timestamp: input.timestamp,
    type: "token_transfer",
    method: "0xe38335e5",
    from: ref(ENCLAVE, "TransparentUpgradeableProxy", "Enclave"),
    to: ref(SAFE, null, "GnosisSafeL2"),
    token: {
      address_hash: "0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186",
      name: "Mezo USD",
      symbol: "MUSD",
      decimals: "18",
      type: input.type ?? "ERC-20",
      icon_url: null,
    },
    total: {
      value: input.value === undefined ? "5000000000000000000" : input.value,
      decimals: "18",
      token_id: null,
    },
  }
}

describe("normalizeTransfers", () => {
  it("keeps ERC-20 amounts, lower-cases addresses and names proxies by implementation", () => {
    const [transfer, ...rest] = normalizeTransfers({
      items: [
        item({ block: 10, timestamp: "2026-11-09T09:07:00.000000Z" }),
        item({
          block: 9,
          timestamp: "2026-11-09T09:00:00.000000Z",
          type: "ERC-721",
        }),
        item({
          block: 8,
          timestamp: "2026-11-09T08:00:00.000000Z",
          value: null,
        }),
      ],
      next_page_params: null,
    })
    expect(rest).toEqual([])
    expect(transfer).toMatchObject({
      from: ENCLAVE.toLowerCase(),
      to: SAFE,
      token: "0xdd468a1ddc392dcdbef6db6e34e89aa338f9f186",
      symbol: "MUSD",
      amount: 5n * 10n ** 18n,
      fromName: "Enclave",
      toName: "GnosisSafeL2",
      at: Date.parse("2026-11-09T09:07:00Z") / 1000,
    })
  })
})

describe("createChainActivity transfers", () => {
  function reader(pages: number, paths: string[]): BlockscoutReader {
    return async (path, schema) => {
      paths.push(path)
      const page = paths.length
      const body = {
        items: [
          item({
            block: 100 - page,
            timestamp: new Date(Date.UTC(2026, 10, 10 - page)).toISOString(),
          }),
        ],
        next_page_params:
          page < pages ? { block_number: 100 - page, index: 3 } : null,
      }
      const parsed = schema.safeParse(body)
      return parsed.success
        ? { status: "ok", data: parsed.data }
        : { status: "unavailable" }
    }
  }

  it("pages through the proxy with Blockscout's cursor until the period starts", async () => {
    const paths: string[] = []
    const chain = createChainActivity({
      blockscout: reader(10, paths),
      scan: async () => ({ status: "unavailable" }),
      rpc: null,
    })
    const since = Date.UTC(2026, 10, 7) / 1000
    const read = await chain.transfers(SAFE, since, 6)
    expect(paths[0]).toBe(
      `api/v2/addresses/${SAFE}/token-transfers?type=ERC-20`,
    )
    expect(paths[1]).toBe(
      `api/v2/addresses/${SAFE}/token-transfers?type=ERC-20&block_number=99&index=3`,
    )
    // Page 4 reached 6 Nov, before the period: the read stops there.
    expect(paths).toHaveLength(4)
    expect(read?.complete).toBe(true)
    expect(read?.transfers.every((each) => each.at >= since)).toBe(true)
  })

  it("stops at the per-address page cap and says the history is partial", async () => {
    const paths: string[] = []
    const chain = createChainActivity({
      blockscout: reader(50, paths),
      scan: async () => ({ status: "unavailable" }),
      rpc: null,
    })
    const read = await chain.transfers(SAFE, 0, 40)
    expect(paths).toHaveLength(ACTIVITY_LIMITS.pagesPerAddress)
    expect(read?.complete).toBe(false)
  })

  it("answers null when the proxy cannot be read", async () => {
    const chain = createChainActivity({
      blockscout: async () => ({ status: "unavailable" }),
      scan: async () => ({ status: "unavailable" }),
      rpc: null,
    })
    expect(await chain.transfers(SAFE, 0, 2)).toBeNull()
  })
})

describe("scan reads", () => {
  function api(routes: Record<string, unknown>, seen: string[]): ApiFetcher {
    return {
      fetch: async (request) => {
        const url = new URL(request.url)
        seen.push(`${url.pathname}${url.search}`)
        const body = routes[`${url.pathname}${url.search}`]
        return body === undefined
          ? new Response("{}", { status: 404 })
          : Response.json(body)
      },
    }
  }

  it("reads labels, locks and votes from /internal/scan", async () => {
    const seen: string[] = []
    const label = {
      address: "0x0453820c89084e20658068a27ebb90824f1a6c6d",
      name: "Fees vAMM BTC/MUSD",
      kind: "feeVotingReward",
      tags: ["rewards"],
      source: "contracts",
      pool: null,
      gauge: null,
      updated_at: 1_790_000_000,
    }
    const chain = createChainActivity({
      blockscout: async () => ({ status: "unavailable" }),
      scan: apiScanReader(
        api(
          {
            "/internal/scan/labels?address=0x0453820c89084e20658068a27ebb90824f1a6c6d":
              { data: { [label.address]: label } },
            [`/internal/scan/owners/${SAFE}/locks?limit=100`]: {
              data: [
                {
                  escrow: "0xb90fdad3dfd180458d62cc6acedc983d78e20122",
                  token_id: "1172",
                  owner: SAFE,
                  amount: "9988214507837747330738297",
                  unlock_at: null,
                  created_at: null,
                  last_extended_at: null,
                  withdrawn_at: null,
                  is_permanent: true,
                  is_withdrawn: false,
                  is_merged: false,
                  merged_into_token_id: null,
                  merged_at: null,
                  boost: null,
                  activity_count: 3,
                  updated_at: 1_790_000_000,
                },
              ],
              nextCursor: null,
            },
          },
          seen,
        ),
      ),
      rpc: null,
    })
    const labels = await chain.labels([
      "0x0453820C89084E20658068A27EbB90824F1A6C6d",
    ])
    expect(labels.get(label.address)?.kind).toBe("feeVotingReward")
    expect(await chain.ownerLocks(SAFE)).toEqual([
      {
        asset: "veMEZO",
        tokenId: "1172",
        owner: SAFE,
        amount: 9988214507837747330738297n,
        isPermanent: true,
        unlockAt: null,
      },
    ])
    // Unknown routes and failures are "unavailable", never a guess.
    expect(await chain.ownerVotes(SAFE)).toBeNull()
    expect(await chain.topLocks("veBTC", 10)).toBeNull()
    expect(seen).toContain(
      `/internal/scan/locks?escrow=vebtc&order=amount&limit=10`,
    )
  })

  it("skips the RPC reads without a client", async () => {
    const chain = createChainActivity({
      blockscout: async () => ({ status: "unavailable" }),
      scan: apiScanReader(null),
      rpc: null,
    })
    expect(await chain.safeOwners([SAFE])).toEqual(new Map())
    expect(await chain.rewardPayers([SAFE])).toEqual(new Map())
    expect(await chain.labelSearch("SNF")).toEqual([])
  })
})
