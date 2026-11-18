import { getAddress } from "viem"
import { describe, expect, it } from "vitest"
import { balanceOfData, readWalletTokens } from "./balances"
import { netWorth, sumUsd } from "./net-worth"
import { qrPath } from "./qr"
import { parseRecipient } from "./recipient"
import { type Fetcher, rpcTestLabel, testRpc } from "./rpc-test"
import { btcFeeReserve, maxSendable, sendBlocked } from "./send-rules"
import {
  networkLabel,
  networkToSave,
  signingLabel,
  signingToSave,
} from "./settings-drafts"

const owner = "0x7c21095156ab25e989c3c084bcb06037c6539e0b"

function jsonRpc(results: Record<string, string>): Fetcher {
  return async (_url, init) => {
    const body: unknown = JSON.parse(String(init.body))
    const method =
      typeof body === "object" && body !== null
        ? String(Reflect.get(body, "method"))
        : ""
    const params: unknown =
      typeof body === "object" && body !== null
        ? Reflect.get(body, "params")
        : []
    const to = Array.isArray(params)
      ? Reflect.get(Object(params[0]), "to")
      : undefined
    const key =
      typeof to === "string" ? `${method}:${to.toLowerCase()}` : method
    const result = results[key] ?? results[method]
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), {
      status: 200,
    })
  }
}

describe("net worth", () => {
  it("sums decimal strings exactly, at the longest precision", () => {
    expect(sumUsd(["412.1", "868.40", "3.9"])).toBe("1284.40")
    expect(sumUsd(["0.1", "0.2"])).toBe("0.3")
    expect(sumUsd(["105710.123456789", "0.000000001"])).toBe("105710.123456790")
    expect(sumUsd([])).toBe("0")
    expect(sumUsd(["5", "-7.25"])).toBe("-2.25")
    expect(sumUsd(["not a number", "", "1."])).toBe("1")
  })

  it("adds the wallet, locks and claimable, skipping unpriced tokens", () => {
    expect(
      netWorth({
        walletUsd: ["210.00", null, "91.07", "77.29"],
        locks: [{ usd: "620.4" }, { usd: "248" }],
        claimableUsd: "3.90",
      }),
    ).toEqual({
      total: "1250.66",
      wallet: "378.36",
      locks: "868.4",
      claimable: "3.90",
    })
  })
})

describe("recipient", () => {
  it("accepts addresses in any case and checksums them", () => {
    expect(parseRecipient(` ${owner} `)).toEqual({
      kind: "address",
      address: getAddress(owner),
    })
    const parsed = parseRecipient(owner.toUpperCase().replace("0X", "0x"))
    expect(parsed.kind).toBe("address")
  })

  it("rejects bad addresses and a wrong checksum", () => {
    expect(parseRecipient("0x1234")).toEqual({
      kind: "invalid",
      reason: "Not a valid address",
    })
    expect(
      parseRecipient("0x7C21095156AB25e989c3c084bcb06037c6539e0b").kind,
    ).toBe("invalid")
    expect(
      parseRecipient("0x0000000000000000000000000000000000000000"),
    ).toEqual({ kind: "invalid", reason: "Cannot send to the zero address" })
  })

  it("reads a Mezo ID only when typed in full", () => {
    expect(parseRecipient("Alice.mezo")).toEqual({
      kind: "mezo-id",
      name: "alice.mezo",
    })
    expect(parseRecipient("my-wallet-2.MEZO")).toEqual({
      kind: "mezo-id",
      name: "my-wallet-2.mezo",
    })
    // An ID that starts like an address is still an ID.
    for (const id of ["0xabc.mezo", "0X1234.Mezo", "0x.mezo"]) {
      expect(parseRecipient(id), id).toEqual({
        kind: "mezo-id",
        name: id.toLowerCase(),
      })
    }
    expect(parseRecipient("   ")).toEqual({ kind: "empty" })
  })

  it("never reads bare text as a Mezo ID, and says what is wrong", () => {
    // Each of these would otherwise have been looked up as "<text>.mezo".
    expect(parseRecipient("pyke")).toEqual({
      kind: "invalid",
      reason: "Add .mezo for a Mezo ID, or use a 0x address",
    })
    expect(parseRecipient("7c21095156ab25e989c3c084bcb06037c6539e0b")).toEqual({
      kind: "invalid",
      reason: "Add 0x to the start of the address",
    })
    for (const bitcoin of [
      "bc1qexampleexampleexampleexampleexample0",
      "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx",
      "1BoatSLRHtKNngkdXEeobR76b53LETtpyT",
      "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy",
    ]) {
      expect(parseRecipient(bitcoin), bitcoin).toEqual({
        kind: "invalid",
        reason: "Bitcoin address. Send to a 0x address on Mezo",
      })
    }
  })

  it("reads Mezo IDs by Mezo's rules, as Matchscan does", () => {
    // Mezo refuses an underscore, a dot inside the name, anything
    // non-ASCII and a name over 63 characters.
    for (const input of [
      "pyke_1.mezo",
      "a.b.mezo",
      "café.mezo",
      `${"a".repeat(64)}.mezo`,
      ".mezo",
    ]) {
      expect(parseRecipient(input), input).toEqual({
        kind: "invalid",
        reason: "Not a Mezo ID",
      })
    }
  })
})

describe("custom RPC test", () => {
  it("passes Mezo mainnet with its block and latency", async () => {
    let clock = 1000
    const result = await testRpc(
      "https://rpc.mezo.example/v1",
      jsonRpc({ eth_chainId: "0x7b7c", eth_blockNumber: "0xc80b40" }),
      () => {
        clock += 91
        return clock
      },
    )
    expect(result).toEqual({ kind: "ok", block: 13_110_080n, ms: 91 })
    expect(rpcTestLabel(result)).toBe("Mezo mainnet, block 13,110,080, 91 ms")
  })

  it("rejects another chain", async () => {
    const result = await testRpc(
      "https://eth.example",
      jsonRpc({ eth_chainId: "0x1", eth_blockNumber: "0x10" }),
    )
    expect(result).toEqual({ kind: "wrong-chain", chainId: 1 })
    expect(rpcTestLabel(result)).toBe("Chain 1, not Mezo mainnet")
  })

  it("names unreachable, malformed and invalid endpoints", async () => {
    expect(await testRpc("ftp://nope")).toEqual({ kind: "invalid-url" })
    expect(
      await testRpc("https://down.example", async () => {
        throw new TypeError("Failed to fetch")
      }),
    ).toEqual({ kind: "unreachable" })
    expect(
      await testRpc(
        "https://html.example",
        async () => new Response(JSON.stringify({ hello: "world" })),
      ),
    ).toEqual({ kind: "bad-response" })
    expect(
      await testRpc(
        "https://error.example",
        async () => new Response("no", { status: 503 }),
      ),
    ).toEqual({ kind: "bad-response" })
  })
})

describe("settings drafts", () => {
  const ok = { kind: "ok", block: 1n, ms: 5 } as const

  it("saves a custom RPC only after it passed Test as typed", () => {
    const draft = { mode: "custom", rpcUrl: " https://rpc.example " } as const
    expect(networkToSave(draft, null)).toBeNull()
    expect(
      networkToSave(draft, { url: "https://other.example", result: ok }),
    ).toBeNull()
    expect(
      networkToSave(draft, {
        url: "https://rpc.example",
        result: { kind: "wrong-chain", chainId: 1 },
      }),
    ).toBeNull()
    expect(
      networkToSave(draft, { url: "https://rpc.example", result: ok }),
    ).toEqual({ mode: "custom", rpcUrl: "https://rpc.example" })
    expect(networkToSave({ mode: "matchbox", rpcUrl: "x" }, null)).toEqual({
      mode: "matchbox",
    })
  })

  it("needs a Safe address for multisig", () => {
    expect(signingToSave({ mode: "multisig", safe: "0x12" })).toBeNull()
    expect(signingToSave({ mode: "multisig", safe: owner })).toEqual({
      mode: "multisig",
      safe: owner,
    })
    expect(signingToSave({ mode: "wallet", safe: "" })).toEqual({
      mode: "wallet",
    })
  })

  it("labels the panel rows", () => {
    expect(networkLabel({ mode: "matchbox" })).toBe("Matchbox")
    expect(networkLabel({ mode: "custom", rpcUrl: "https://x" })).toBe(
      "Custom RPC",
    )
    expect(signingLabel({ mode: "multisig", safe: null })).toBe("Multisig")
    expect(signingLabel({ mode: "wallet" })).toBe("Wallet")
  })
})

describe("send rules", () => {
  const oneBtc = 10n ** 18n

  it("keeps a fee reserve of BTC only", () => {
    expect(maxSendable("BTC", oneBtc)).toBe(oneBtc - btcFeeReserve)
    expect(maxSendable("BTC", 1n)).toBe(0n)
    expect(maxSendable("MUSD", oneBtc)).toBe(oneBtc)
  })

  it("blocks more than the balance, the reserve and sending to yourself", () => {
    const base = { symbol: "BTC", to: null, from: owner } as const
    expect(sendBlocked({ ...base, amount: oneBtc + 1n, balance: oneBtc })).toBe(
      "More than your balance",
    )
    expect(sendBlocked({ ...base, amount: oneBtc, balance: oneBtc })).toBe(
      "Keep 0.00001 BTC for fees",
    )
    expect(
      sendBlocked({ ...base, symbol: "MEZO", amount: oneBtc, balance: oneBtc }),
    ).toBeNull()
    expect(sendBlocked({ ...base, amount: 1n, balance: null })).toBeNull()
    expect(
      sendBlocked({
        ...base,
        amount: 1n,
        balance: oneBtc,
        to: owner.toUpperCase(),
      }),
    ).toBe("Same as this wallet")
  })
})

describe("wallet tokens", () => {
  it("reads native BTC and the ERC-20s through the given RPC, priced", async () => {
    const urls: string[] = []
    const fetcher = jsonRpc({
      eth_getBalance: "0x44cb3a6044fc000", // 0.30982 BTC
      "eth_call:0xdd468a1ddc392dcdbef6db6e34e89aa338f9f186":
        "0x00000000000000000000000000000000000000000000000b63b924d7ad920000", // 210.1 MUSD
      "eth_call:0x7b7c000000000000000000000000000000000001": "0x",
    })
    const tokens = await readWalletTokens({
      rpcUrl: "https://custom.example",
      owner,
      prices: {
        btc: { usd: "100000", change24hBps: 180 },
        mezo: { usd: "0.0042", change24hBps: null },
      },
      fetcher: (url, init) => {
        urls.push(url)
        return fetcher(url, init)
      },
    })
    expect(new Set(urls)).toEqual(new Set(["https://custom.example"]))
    expect(tokens.map((token) => [token.symbol, token.usd])).toEqual([
      ["MUSD", "210.100000"],
      ["BTC", "30982.000000"],
      ["MEZO", "0.000000"],
    ])
    expect(tokens.find((token) => token.symbol === "BTC")?.changeBps).toBe(180)
    expect(
      tokens.find((token) => token.symbol === "MEZO")?.changeBps,
    ).toBeNull()
  })

  it("encodes balanceOf", () => {
    expect(balanceOfData(owner)).toBe(
      `0x70a08231000000000000000000000000${owner.slice(2)}`,
    )
  })
})

describe("qr", () => {
  it("draws a square code with finder patterns in three corners", () => {
    const { size, d } = qrPath(owner)
    expect(size).toBeGreaterThanOrEqual(21)
    expect((size - 17) % 4).toBe(0)
    expect(d.startsWith("M0 0h1v1h-1z")).toBe(true)
    expect(d).toContain(`M${size - 1} 0h1v1h-1z`)
    expect(d).toContain(`M0 ${size - 1}h1v1h-1z`)
    expect(d).not.toContain("M7 0h1v1h-1z")
  })
})
