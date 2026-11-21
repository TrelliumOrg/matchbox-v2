import type { Page } from "@playwright/test"

/**
 * "Test Wallet": an EIP-1193 provider announced over EIP-6963 that knows
 * one account on Mezo and nothing else. It signs nothing and sends
 * nothing (every other request is refused), so the fixtures build never
 * leaves the machine. Like a real extension it shares no accounts until
 * the page asks, then remembers for the tab, so the next load reconnects.
 *
 * - `authorized`: already connected to this site (a reconnect finds it).
 * - `locked`: never shares an account, like a locked extension or an
 *   expired WalletConnect session.
 * - `answers`: when it answers `eth_accounts` (how a reconnect asks),
 *   "never" (a hung extension) or this many milliseconds after it is first
 *   asked. Every other request answers at once.
 */
type FakeWalletOptions = {
  address: string
  authorized?: boolean
  locked?: boolean
  answers?: "never" | number
}

function install({
  address,
  authorized,
  locked,
  answers,
}: FakeWalletOptions): void {
  let answerAt: number | null = null
  const accountsAnswer = (): Promise<void> => {
    if (answers === undefined) return Promise.resolve()
    if (answers === "never") return new Promise(() => undefined)
    answerAt ??= Date.now() + answers
    const wait = answerAt - Date.now()
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, wait)))
  }
  const key = "test-wallet-authorized"
  if (authorized === true) sessionStorage.setItem(key, "1")
  const shared = (): boolean =>
    locked !== true && sessionStorage.getItem(key) === "1"
  const refused = (code: number, message: string): Error =>
    Object.assign(new Error(message), { code })

  const provider = {
    async request({ method }: { method: string; params?: unknown[] }) {
      switch (method) {
        case "eth_requestAccounts":
        case "wallet_requestPermissions":
          if (locked === true) throw refused(4001, "User rejected the request.")
          sessionStorage.setItem(key, "1")
          return method === "eth_requestAccounts"
            ? [address]
            : [{ parentCapability: "eth_accounts" }]
        case "eth_accounts":
          await accountsAnswer()
          return shared() ? [address] : []
        case "wallet_getPermissions":
          return shared() ? [{ parentCapability: "eth_accounts" }] : []
        case "wallet_revokePermissions":
          sessionStorage.removeItem(key)
          return null
        case "eth_chainId":
          return "0x7b7c"
        case "net_version":
          return "31612"
        case "wallet_switchEthereumChain":
        case "wallet_addEthereumChain":
          return null
        default:
          throw refused(4200, `${method} is not supported`)
      }
    },
    on() {},
    removeListener() {},
  }

  const info = {
    uuid: "0b6b2f1c-5d1e-4c2a-9f53-7a3c1e0d9b42",
    name: "Test Wallet",
    icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='16' fill='%23888'/%3E%3C/svg%3E",
    rdns: "markets.matchbox.test",
  }
  const announce = (): void => {
    window.dispatchEvent(
      new CustomEvent("eip6963:announceProvider", {
        detail: Object.freeze({ info, provider }),
      }),
    )
  }
  window.addEventListener("eip6963:requestProvider", announce)
  announce()
}

export async function installFakeWallet(
  page: Page,
  options: FakeWalletOptions,
): Promise<void> {
  await page.addInitScript(install, options)
}

/**
 * As if this browser had connected before: Pro reconnects on load (the
 * flag `reconnectIfRemembered` reads), and plain paths are this wallet
 * (the own-wallet cookie, which the server reads too).
 */
export async function rememberConnected(
  page: Page,
  baseURL: string | undefined,
  own: string,
): Promise<void> {
  await page
    .context()
    .addCookies([
      { name: "mbx-wallet", value: own.toLowerCase(), url: baseURL ?? "" },
    ])
  await page.addInitScript(() => {
    window.localStorage.setItem("mbx-wallet", "1")
  })
}

/** Saves `safe` in Signing (Multisig mode), as the account panel does. */
export async function saveSafe(page: Page, safe: string): Promise<void> {
  await page.addInitScript((saved: string) => {
    window.localStorage.setItem(
      "mbx-settings",
      JSON.stringify({
        network: { mode: "matchbox" },
        signing: { mode: "multisig", safe: saved },
      }),
    )
  }, safe)
}
