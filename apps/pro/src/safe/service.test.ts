import { getAddress, zeroAddress } from "viem"
import { describe, expect, it, vi } from "vitest"
import { safeTx } from "./safe-tx"
import { nextNonce, proposalBody, readProposal } from "./service"
import { proInSafeUrl, safeQueueUrl, safeTxUrl, txBuilderOpenUrl } from "./urls"

const safe = getAddress("0x5afe000000000000000000000000000000005afe")
const owner = getAddress("0x7c21095156ab25e989c3c084bcb06037c6539e0b")
const hash = `0x${"ab".repeat(32)}` as const

function respond(body: unknown, status = 200): typeof fetch {
  return vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
  )
}

describe("Transaction Service", () => {
  it("posts the proposal with string amounts and checksummed addresses", () => {
    const tx = safeTx({ to: owner, value: 5n, data: "0x", operation: 0 }, 12n)
    expect(
      proposalBody({ tx, safeTxHash: hash, sender: owner, signature: "0x01" }),
    ).toMatchObject({
      to: owner,
      value: "5",
      data: null,
      operation: 0,
      safeTxGas: "0",
      baseGas: "0",
      gasPrice: "0",
      gasToken: zeroAddress,
      refundReceiver: zeroAddress,
      nonce: "12",
      contractTransactionHash: hash,
      sender: owner,
      signature: "0x01",
    })
  })

  it("queues after every pending proposal", async () => {
    const fetcher = respond({ results: [{ nonce: "14" }] })
    expect(await nextNonce(safe, 12n, fetcher)).toBe(15n)
    expect(String(vi.mocked(fetcher).mock.calls[0]?.[0])).toContain(
      `/safes/${safe}/multisig-transactions/?executed=false&nonce__gte=12`,
    )
    expect(await nextNonce(safe, 12n, respond({ results: [] }))).toBe(12n)
    expect(await nextNonce(safe, 12n, respond({}, 500))).toBe(12n)
  })

  it("reads confirmations and execution", async () => {
    const status = await readProposal(
      hash,
      respond({
        safeTxHash: hash,
        nonce: 12,
        confirmationsRequired: 2,
        confirmations: [{ owner }],
        isExecuted: false,
        isSuccessful: null,
        transactionHash: null,
      }),
    )
    expect(status).toEqual({
      confirmations: 1,
      required: 2,
      executed: false,
      successful: null,
      transactionHash: null,
    })
  })
})

describe("Safe links", () => {
  it("deep links into safe.mezo.org", () => {
    expect(safeTxUrl(safe, hash)).toBe(
      `https://safe.mezo.org/transactions/tx?safe=mezo:${safe}&id=multisig_${safe}_${hash}`,
    )
    expect(safeQueueUrl(safe)).toBe(
      `https://safe.mezo.org/transactions/queue?safe=mezo:${safe}`,
    )
    expect(proInSafeUrl(safe)).toBe(
      `https://safe.mezo.org/apps/open?safe=mezo:${safe}&appUrl=https%3A%2F%2Fpro.matchbox.markets`,
    )
    expect(txBuilderOpenUrl(safe)).toBe(
      `https://safe.mezo.org/apps/open?safe=mezo:${safe}&appUrl=https%3A%2F%2Fapps-portal.safe.global%2Ftx-builder`,
    )
  })
})
