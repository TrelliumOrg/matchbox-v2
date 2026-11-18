import { describe, expect, it } from "vitest"
import {
  connectError,
  groupWallets,
  injectedWalletName,
  inWalletBrowser,
  isUserRejection,
  readRecent,
  recentStorageKey,
  rememberRecent,
  type WalletConnector,
} from "./wallets"

const rabby: WalletConnector = {
  uid: "u-rabby",
  id: "io.rabby",
  name: "Rabby Wallet",
  type: "injected",
  icon: "data:rabby",
}
const okx: WalletConnector = {
  uid: "u-okx",
  id: "com.okex.wallet",
  name: "OKX Wallet",
  type: "injected",
  icon: "data:okx",
}
const generic: WalletConnector = {
  uid: "u-injected",
  id: "injected",
  name: "Injected",
  type: "injected",
}
const walletConnect: WalletConnector = {
  uid: "u-wc",
  id: "walletConnect",
  name: "WalletConnect",
  type: "walletConnect",
}

function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: () => null,
    removeItem: (key) => void map.delete(key),
    setItem: (key, value) => void map.set(key, value),
  }
}

describe("groupWallets", () => {
  it("lists announced wallets as detected and offers the rest", () => {
    const groups = groupWallets([rabby, okx, generic], [], {
      injectedProvider: true,
    })
    expect(groups.detected.map((entry) => entry.name)).toEqual([
      "Rabby Wallet",
      "OKX Wallet",
    ])
    expect(groups.more.map((entry) => entry.name)).toEqual([
      "MetaMask",
      "Coinbase Wallet",
      "Taho",
    ])
    expect(groups.more.every((entry) => entry.downloadUrl !== null)).toBe(true)
    expect(groups.walletConnect).toBeNull()
  })

  it("falls back to the browser wallet only when nothing announced", () => {
    expect(
      groupWallets([generic], [], { injectedProvider: true }).detected,
    ).toMatchObject([{ name: "Browser wallet", connectorUid: "u-injected" }])
    expect(
      groupWallets([generic], [], { injectedProvider: false }).detected,
    ).toEqual([])
  })

  it("pulls recent wallets up, newest first, without repeating them", () => {
    const groups = groupWallets(
      [rabby, okx, walletConnect],
      ["walletConnect", "com.okex.wallet", "io.gone"],
      { injectedProvider: true },
    )
    expect(groups.recent.map((entry) => entry.key)).toEqual([
      "walletConnect",
      "com.okex.wallet",
    ])
    expect(groups.detected.map((entry) => entry.key)).toEqual(["io.rabby"])
    expect(groups.walletConnect).toBeNull()
  })

  it("shows WalletConnect when a project id configured it", () => {
    const groups = groupWallets([walletConnect], [], {
      injectedProvider: false,
    })
    expect(groups.walletConnect).toMatchObject({
      name: "WalletConnect",
      installed: true,
    })
  })
})

describe("recent wallets", () => {
  it("keeps the last three, newest first", () => {
    const storage = memoryStorage()
    for (const key of ["a.one", "b.two", "a.one", "c.three", "d.four"]) {
      rememberRecent(storage, key)
    }
    expect(readRecent(storage)).toEqual(["d.four", "c.three", "a.one"])
  })

  it("ignores junk in storage", () => {
    const storage = memoryStorage()
    storage.setItem(recentStorageKey, "io.rabby,<script>,")
    expect(readRecent(storage)).toEqual(["io.rabby"])
    expect(readRecent(null)).toEqual([])
  })
})

describe("wallet errors", () => {
  it("finds a rejection anywhere in the cause chain", () => {
    expect(isUserRejection({ cause: { cause: { code: 4001 } } })).toBe(true)
    expect(isUserRejection({ name: "UserRejectedRequestError" })).toBe(true)
    expect(isUserRejection(new Error("boom"))).toBe(false)
  })

  it("says why a connection failed", () => {
    expect(connectError({ code: 4001 })).toBe("Declined in wallet")
    expect(connectError(new Error("Request already pending"))).toBe(
      "Request already open in wallet",
    )
    expect(connectError(new Error("Provider not found"))).toBe(
      "Wallet not found",
    )
    expect(connectError("nope")).toBe("Connection failed")
  })
})

describe("inside a wallet's built-in browser", () => {
  it("is a touch device with an injected provider", () => {
    expect(
      inWalletBrowser({ injectedProvider: true, coarsePointer: true }),
    ).toBe(true)
    // A desktop extension, and mobile Safari or Chrome.
    expect(
      inWalletBrowser({ injectedProvider: true, coarsePointer: false }),
    ).toBe(false)
    expect(
      inWalletBrowser({ injectedProvider: false, coarsePointer: true }),
    ).toBe(false)
  })

  it("names the wallet from its provider flags", () => {
    expect(injectedWalletName({ isMetaMask: true }, {})).toBe("OKX Wallet")
    expect(injectedWalletName({ isOkxWallet: true })).toBe("OKX Wallet")
    expect(injectedWalletName({ isOKExWallet: true })).toBe("OKX Wallet")
    // Several wallets also claim isMetaMask: their own flag wins.
    expect(injectedWalletName({ isMetaMask: true, isRabby: true })).toBe(
      "Rabby",
    )
    expect(
      injectedWalletName({ isMetaMask: true, isCoinbaseWallet: true }),
    ).toBe("Coinbase Wallet")
    expect(injectedWalletName({ isTrust: true })).toBe("Trust Wallet")
    expect(injectedWalletName({ isBitKeep: true })).toBe("Bitget Wallet")
    expect(injectedWalletName({ isMetaMask: true })).toBe("MetaMask")
    expect(injectedWalletName({})).toBeNull()
    expect(injectedWalletName(undefined)).toBeNull()
  })

  it("offers that wallet alone: no WalletConnect, no download rows", () => {
    const announced = groupWallets([generic, okx, walletConnect], [], {
      injectedProvider: true,
      inWallet: true,
    })
    expect(announced.detected.map((entry) => entry.name)).toEqual([
      "OKX Wallet",
    ])
    expect(announced.walletConnect).toBeNull()
    expect(announced.more).toEqual([])
  })

  it("names the generic connector when the wallet did not announce itself", () => {
    const silent = groupWallets([generic, walletConnect], [], {
      injectedProvider: true,
      inWallet: true,
      injectedName: "OKX Wallet",
    })
    expect(silent.detected).toHaveLength(1)
    expect(silent.detected[0]).toMatchObject({
      name: "OKX Wallet",
      key: "injected",
      installed: true,
    })
    expect(silent.walletConnect).toBeNull()
    expect(silent.more).toEqual([])
    const unnamed = groupWallets([generic], [], {
      injectedProvider: true,
      inWallet: true,
    })
    expect(unnamed.detected[0]?.name).toBe("Browser wallet")
  })

  it("keeps the full list everywhere else", () => {
    const desktop = groupWallets([generic, okx, walletConnect], [], {
      injectedProvider: true,
      inWallet: false,
    })
    expect(desktop.walletConnect).not.toBeNull()
    expect(desktop.more.length).toBeGreaterThan(0)
    // A phone browser with no wallet: WalletConnect is the way in.
    const phone = groupWallets([generic, walletConnect], [], {
      injectedProvider: false,
      inWallet: false,
    })
    expect(phone.detected).toEqual([])
    expect(phone.walletConnect).not.toBeNull()
  })
})

describe("WalletConnect before its code is loaded", () => {
  it("is offered as a row without a connector", () => {
    const groups = groupWallets([generic, okx], [], {
      injectedProvider: true,
      walletConnectOffered: true,
    })
    expect(groups.walletConnect).toMatchObject({
      key: "walletConnect",
      installed: true,
      connectorUid: null,
    })
  })

  it("uses the loaded connector once there is one", () => {
    const groups = groupWallets([generic, walletConnect], [], {
      injectedProvider: false,
      walletConnectOffered: true,
    })
    expect(groups.walletConnect?.connectorUid).toBe("u-wc")
  })

  it("is not offered inside a wallet's browser, or when not configured", () => {
    expect(
      groupWallets([generic, okx], [], {
        injectedProvider: true,
        inWallet: true,
        walletConnectOffered: true,
      }).walletConnect,
    ).toBeNull()
    expect(
      groupWallets([generic, okx], [], { injectedProvider: true })
        .walletConnect,
    ).toBeNull()
  })

  it("moves to Recent like any wallet used before", () => {
    const groups = groupWallets([generic], ["walletConnect"], {
      injectedProvider: false,
      walletConnectOffered: true,
    })
    expect(groups.recent.map((entry) => entry.key)).toEqual(["walletConnect"])
    expect(groups.walletConnect).toBeNull()
  })
})
