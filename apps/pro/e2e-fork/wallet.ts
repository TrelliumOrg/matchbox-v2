import type { Page } from "@playwright/test"

/**
 * "Fork Wallet": an EIP-1193 provider announced over EIP-6963 that answers
 * accounts and chain locally and forwards everything else, including
 * eth_sendTransaction, to the Anvil fork, which accepts unsigned sends from
 * impersonated accounts. No key, no signature, nothing leaves the machine.
 * `window.__forkWallet` lets a test reject the next prompt and read what
 * was sent.
 */

type ForkWalletOptions = { address: string; rpcUrl: string }

declare global {
  interface Window {
    __forkWallet: {
      rejectNext: boolean
      sent: { to: string | undefined; data: string | undefined }[]
    }
  }
}

function install({ address, rpcUrl }: ForkWalletOptions): void {
  const listeners = new Map<string, Set<(value: unknown) => void>>()
  let id = 0
  // Like a real wallet: no accounts until the page asks, then remembered.
  const authorizedKey = "fork-wallet-authorized"
  let authorized = sessionStorage.getItem(authorizedKey) === "1"
  function authorize(): void {
    authorized = true
    sessionStorage.setItem(authorizedKey, "1")
  }
  window.__forkWallet = { rejectNext: false, sent: [] }

  async function forward(method: string, params: unknown): Promise<unknown> {
    id += 1
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    })
    const body: {
      result?: unknown
      error?: { code: number; message: string; data?: unknown }
    } = await response.json()
    if (body.error !== undefined) {
      throw Object.assign(new Error(body.error.message), {
        code: body.error.code,
        data: body.error.data,
      })
    }
    return body.result
  }

  function rejection(): Error {
    return Object.assign(new Error("User rejected the request."), {
      code: 4001,
    })
  }

  const provider = {
    async request({ method, params }: { method: string; params?: unknown[] }) {
      switch (method) {
        case "eth_requestAccounts":
          authorize()
          return [address]
        case "eth_accounts":
          return authorized ? [address] : []
        case "eth_chainId":
          return "0x7b7c"
        case "net_version":
          return "31612"
        case "wallet_switchEthereumChain":
        case "wallet_addEthereumChain":
          return null
        case "wallet_requestPermissions":
          authorize()
          return [{ parentCapability: "eth_accounts" }]
        case "wallet_getPermissions":
          return authorized ? [{ parentCapability: "eth_accounts" }] : []
        case "eth_sendTransaction": {
          if (window.__forkWallet.rejectNext) {
            window.__forkWallet.rejectNext = false
            throw rejection()
          }
          const tx = (params?.[0] ?? {}) as { to?: string; data?: string }
          window.__forkWallet.sent.push({ to: tx.to, data: tx.data })
          return forward(method, [{ ...tx, from: address }])
        }
        case "personal_sign":
        case "eth_sign":
        case "eth_signTypedData_v4":
          throw rejection()
        default:
          return forward(method, params ?? [])
      }
    },
    on(event: string, listener: (value: unknown) => void) {
      const set = listeners.get(event) ?? new Set()
      set.add(listener)
      listeners.set(event, set)
    },
    removeListener(event: string, listener: (value: unknown) => void) {
      listeners.get(event)?.delete(listener)
    },
  }

  const info = {
    uuid: "5b0e9a3e-7c1b-4f0e-9d7a-1f0a1f0a1f0a",
    name: "Fork Wallet",
    icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='16' fill='%23F7931A'/%3E%3C/svg%3E",
    rdns: "markets.matchbox.fork",
  }
  function announce(): void {
    window.dispatchEvent(
      new CustomEvent("eip6963:announceProvider", {
        detail: Object.freeze({ info, provider }),
      }),
    )
  }
  window.addEventListener("eip6963:requestProvider", announce)
  announce()
}

export async function installForkWallet(
  page: Page,
  options: ForkWalletOptions,
): Promise<void> {
  await page.addInitScript(install, options)
}
