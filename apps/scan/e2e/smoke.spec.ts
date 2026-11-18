import { expect, type Page, test } from "@playwright/test"

import {
  fixtureAddress as address,
  fixtureBlock,
  fixtureTx as hash,
  scanRoutes,
  fixtureWallet as wallet,
} from "../scripts/routes.mjs"

/** The address whose every proxy read answers 429 in fixtures mode. */
const busyAddress = `0x${"0b".repeat(20)}`

/** Fails the test on any console error or uncaught exception. */
function watchErrors(page: Page): string[] {
  const errors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text())
  })
  page.on("pageerror", (error) => errors.push(error.message))
  return errors
}

const routes = [
  { path: "/", heading: "Explore Mezo" },
  { path: "/network/transactions", heading: "Network" },
  { path: "/network/blocks", heading: "Network" },
  { path: "/borrow", heading: "Borrow" },
  { path: "/gauges", heading: "Gauges" },
  { path: "/validators", heading: "Validators" },
  { path: "/locks", heading: "Locks" },
  { path: "/epochs", heading: "Epochs" },
  { path: "/tokens", heading: "Tokens" },
  { path: `/tx/${hash}`, heading: "Swapped 5.00 mUSDC in mUSDC/MUSD" },
  { path: `/block/${fixtureBlock}`, heading: "Block 13,118,064" },
  { path: `/address/${address}`, heading: address },
  { path: `/address/${address}/transfers`, heading: address },
  { path: `/address/${wallet}`, heading: wallet },
  { path: `/address/${wallet}/votes`, heading: wallet },
  { path: `/address/${wallet}/activity`, heading: wallet },
  { path: `/address/${wallet}/loans`, heading: wallet },
  { path: `/address/${wallet}/transactions`, heading: wallet },
  { path: "/epochs/47", heading: "Epoch 47" },
  { path: "/locks/vebtc/604", heading: "veBTC #604" },
  { path: "/locks/vemezo/604", heading: "veMEZO #604" },
]

for (const route of routes) {
  test(`${route.path} renders without console errors`, async ({ page }) => {
    const errors = watchErrors(page)
    const response = await page.goto(route.path)
    expect(response?.status()).toBe(200)
    await expect(
      page.getByRole("heading", { level: 1, name: route.heading }),
    ).toBeVisible()
    await page.waitForLoadState("networkidle")
    expect(errors).toEqual([])
  })
}

const tabRows = [
  ["/gauges", "Gauge types"],
  ["/locks", "Escrows"],
  ["/network", "Network"],
  ["/network/transactions", "Transaction types"],
  ["/borrow", "Borrow"],
  ["/tokens/musd", "Token"],
  [`/address/${wallet}`, "Address"],
  ["/pools", "Chain"],
  ["/pools", "Token"],
] as const

for (const [path, name] of tabRows) {
  test(`${path}: the ${name} row never scrolls vertically or shows a scrollbar`, async ({
    page,
  }) => {
    await page.goto(path)
    const row = page.getByRole("navigation", { name, exact: true })
    // The element that scrolls sideways: the list, or the nav itself.
    const sizes = await row.evaluate((nav: HTMLElement) => {
      const list = nav.querySelector("ul") ?? nav
      const scroller =
        getComputedStyle(list).overflowX === "visible" ? nav : list
      const style = getComputedStyle(scroller)
      return {
        overflowY: style.overflowY,
        scrollHeight: scroller.scrollHeight,
        clientHeight: scroller.clientHeight,
        bar: scroller.offsetHeight - scroller.clientHeight,
      }
    })
    expect(sizes.scrollHeight).toBeLessThanOrEqual(sizes.clientHeight)
    expect(["hidden", "visible"]).toContain(sizes.overflowY)
    expect(sizes.bar).toBe(0)
  })
}

test("unknown pages are not found", async ({ page }) => {
  for (const path of ["/nope", "/locks/604", "/locks/vebtc/0"]) {
    const response = await page.goto(path)
    expect(response?.status(), path).toBe(404)
    await expect(
      page.getByRole("heading", { name: "Page not found" }),
    ).toBeVisible()
  }
})

test("malformed entities get their own not-found page", async ({ page }) => {
  for (const path of ["/tx/0x1234", "/address/0xzz", "/block/abc"]) {
    const response = await page.goto(path)
    expect(response?.status(), path).toBe(404)
    await expect(page.getByText("Not found").first(), path).toBeVisible()
  }
})

test("well-formed entities the chain lacks are 404s", async ({ page }) => {
  for (const path of [`/tx/0x${"1".repeat(64)}`, "/block/99999999"]) {
    const response = await page.goto(path)
    expect(response?.status(), path).toBe(404)
    await expect(
      page.getByText(/^(Not found|Not produced yet)$/).first(),
      path,
    ).toBeVisible()
  }
})

test("search routes a transaction hash by its shape", async ({
  page,
  isMobile,
}) => {
  const errors = watchErrors(page)
  await page.goto("/network/blocks")
  await page.waitForLoadState("networkidle")
  if (isMobile) {
    await page.getByRole("button", { name: "Search", exact: true }).click()
  } else {
    await page.keyboard.press("Control+k")
  }
  const input = page.getByRole("combobox", { name: "Search" })
  await expect(input).toBeFocused()
  await input.fill(hash)
  await expect(page.getByRole("option", { name: /Transaction/ })).toBeVisible()
  await input.press("Enter")
  await expect(page).toHaveURL(`/tx/${hash}`)
  await expect(
    page.getByRole("heading", { level: 1, name: /Swapped/ }),
  ).toBeVisible()
  expect(errors).toEqual([])
})

test("a bare number offers every reading, Escape closes", async ({ page }) => {
  await page.goto("/")
  await page.waitForLoadState("networkidle")
  await page
    .getByRole("button", { name: /Search/ })
    .first()
    .click()
  const input = page.getByRole("combobox", { name: "Search" })
  await input.fill("47")
  await expect(page.getByRole("option")).toHaveCount(4)
  await input.press("ArrowDown")
  await input.press("Enter")
  await expect(page).toHaveURL("/locks/vebtc/47")
  await page.keyboard.press("Control+k")
  await page.keyboard.press("Escape")
  await expect(page.getByRole("combobox", { name: "Search" })).toHaveCount(0)
})

test("no wallet code loads until Connect is wanted", async ({
  page,
  isMobile,
}) => {
  const wallet: string[] = []
  const walletConnect: string[] = []
  page.on("request", (request) => {
    if (/wallet-(host|runtime)|connect-drawer/.test(request.url())) {
      wallet.push(request.url())
    }
    if (/walletconnect|appkit|reown/i.test(request.url())) {
      walletConnect.push(request.url())
    }
  })
  await page.goto("/")
  await page.waitForLoadState("networkidle")
  expect(wallet).toEqual([])
  // WalletConnect (Matchbox's project, shared with Pro) is never first paint.
  expect(walletConnect).toEqual([])
  const connect = page.getByRole("button", { name: /^Connect/ })
  if (isMobile) await connect.tap()
  else await connect.click()
  const drawer = page.getByRole("dialog")
  await expect(drawer.getByText("Connect wallet").first()).toBeVisible()
  await expect(drawer.getByText("WalletConnect").first()).toBeVisible()
  expect(wallet.length).toBeGreaterThan(0)
})

test("phones reach every section through the tabs and More", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "phone layout")
  await page.goto("/")
  const tabs = page.getByRole("navigation", { name: "Matchscan tabs" })
  await tabs.getByRole("link", { name: "Gauges" }).tap()
  await expect(page).toHaveURL("/gauges")
  await tabs.getByRole("button", { name: "More" }).tap()
  // The More popover's link, not the gauges page's Validators tab.
  await page
    .getByRole("navigation", { name: "More" })
    .getByRole("link", { name: "Validators" })
    .tap()
  await expect(page).toHaveURL("/validators")
  await expect(
    page.getByRole("heading", { level: 1, name: "Validators" }),
  ).toBeVisible()
})

test("no page scrolls sideways", async ({ page }) => {
  for (const path of [
    "/",
    "/network/transactions",
    "/network/blocks",
    `/tx/${hash}`,
    `/block/${fixtureBlock}`,
    `/address/${address}`,
    `/address/${address}/transfers`,
    `/address/${wallet}`,
    `/address/${wallet}/votes`,
    `/address/${wallet}/loans`,
  ]) {
    await page.goto(path)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    )
    expect(overflow, path).toBeLessThanOrEqual(0)
  }
})

test("home shows the live tiles and the epoch's gauges", async ({ page }) => {
  await page.goto("/")
  const tiles = page.getByRole("region", { name: "Mezo at a glance" })
  await expect(tiles.getByText("Borrowed")).toBeVisible()
  await expect(tiles.getByText("723,361 MUSD")).toBeVisible()
  await expect(tiles.getByText("BTC collateral")).toBeVisible()
  await expect(tiles.getByText("Open positions")).toBeVisible()
  await expect(tiles.getByText(/^1 Enclave, \d+ Morpho$/)).toBeVisible()
  await expect(tiles.getByText("veBTC locked")).toBeVisible()
  await expect(tiles.getByText("Validators")).toBeVisible()
  await expect(tiles.getByText("Epoch 47 incentives")).toBeVisible()
  await expect(
    page.getByRole("heading", { name: "Epoch 47 gauges" }),
  ).toBeVisible()
  await expect(
    page.getByRole("link", { name: "Vote on Matchbox" }).first(),
  ).toHaveAttribute("href", "https://pro.matchbox.markets/vote")
})

test("chain pages show what the proxy recorded", async ({ page }) => {
  await page.goto("/")
  await expect(
    page.getByRole("heading", { name: "Latest blocks" }),
  ).toBeVisible()
  await expect(page.getByRole("link", { name: "13,118,577" })).toBeVisible()
  await page.goto(`/block/${fixtureBlock}`)
  await expect(
    page.getByRole("heading", { name: "Transactions in this block" }),
  ).toBeVisible()
  await expect(
    page.getByRole("link", { name: /0x45e0962d/ }).first(),
  ).toBeVisible()
  await page.goto(`/tx/${hash}`)
  await expect(page.getByText("execute").first()).toBeVisible()
  await page.goto(`/address/${address}`)
  // Our label names it; Blockscout's name was TransparentUpgradeableProxy.
  await expect(page.getByText("BoostVoter").first()).toBeVisible()
  await expect(page.getByText("MUSD", { exact: true })).toBeVisible()
  // A full first page of balances, and more after it.
  await expect(
    page.getByText(
      "4 of the first 50 balances shown. This address holds more.",
    ),
  ).toBeVisible()
})

test("a busy proxy degrades its sections, not the page", async ({
  baseURL,
  page,
}) => {
  const response = await fetch(`${baseURL}/address/${busyAddress}`)
  expect(response.status).toBe(200)
  expect(response.headers.get("cache-control")).toBe("no-store")
  await page.goto(`/address/${busyAddress}`)
  await expect(page.getByText("Busy, try again").first()).toBeVisible()
  // The shell still renders around it.
  await expect(
    page.getByRole("link", { name: "Matchscan" }).first(),
  ).toBeVisible()
})

test("each page has its cache class; errors are never stored", async ({
  baseURL,
}) => {
  const cases = [
    ["/", "s-maxage=4,"],
    ["/network/transactions", "s-maxage=4,"],
    ["/network/blocks", "s-maxage=4,"],
    [`/tx/${hash}`, "s-maxage=86400,"],
    [`/block/${fixtureBlock}`, "s-maxage=86400,"],
    [`/address/${address}`, "s-maxage=15,"],
    ["/nope", "no-store"],
    [`/tx/0x${"1".repeat(64)}`, "no-store"],
  ] as const
  for (const [path, policy] of cases) {
    const response = await fetch(`${baseURL}${path}`)
    expect(response.headers.get("cache-control"), path).toContain(policy)
    expect(response.headers.get("set-cookie"), path).toBeNull()
  }
})

test("a cached page is served with this response's nonce", async ({
  baseURL,
}) => {
  const path = `${baseURL}/block/${fixtureBlock}?nonce-check=1`
  const first = await fetch(path)
  await first.text()
  const second = await fetch(path)
  expect(second.headers.get("x-scan-page-cache")).toBe("hit")
  const nonce =
    /'nonce-([^']+)'/.exec(
      second.headers.get("content-security-policy") ?? "",
    )?.[1] ?? ""
  expect(nonce).not.toBe("")
  const html = await second.text()
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>/g)].map((m) => m[0])
  expect(scripts.length).toBeGreaterThan(0)
  for (const script of scripts) expect(script).toContain(`nonce="${nonce}"`)
})

test("lists page forward with a cursor", async ({ page }) => {
  await page.goto("/network/transactions")
  await page.waitForLoadState("networkidle")
  await page
    .getByRole("link", { name: /Next|Older/ })
    .first()
    .click()
  await expect(page).toHaveURL(/\/network\/transactions\?.+/)
  await expect(
    page.getByRole("heading", { level: 1, name: "Network" }),
  ).toBeVisible()
})

test("search names gauges and labels first, Blockscout on a miss", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "same palette; the desktop run covers it")
  await page.goto("/network/blocks")
  await page.waitForLoadState("networkidle")
  await page.keyboard.press("Control+k")
  const input = page.getByRole("combobox", { name: "Search" })
  // Our labels and gauge names.
  await input.fill("kiln")
  const gauges = page.getByRole("group", { name: "Gauges" })
  await expect(gauges.getByRole("option", { name: /Kiln Labs/ })).toBeVisible()
  // Nothing of ours: Blockscout's quick search, under Addresses.
  await input.fill("Mezo")
  const addresses = page.getByRole("group", { name: "Addresses" })
  await expect(
    addresses.getByRole("option", { name: /Mezo USD/ }).first(),
  ).toBeVisible()
  await addresses
    .getByRole("option", { name: /Mezo USD/ })
    .first()
    .click()
  await expect(page).toHaveURL(/\/address\/0x[0-9a-f]{40}$/)
})

test("transactions are titled in plain words", async ({ page }) => {
  await page.goto(`/tx/${hash}`)
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Swapped 5.00 mUSDC in mUSDC/MUSD",
    }),
  ).toBeVisible()
  await expect(
    page.getByRole("link", { name: "mUSDC/MUSD" }).first(),
  ).toBeVisible()
})

test("an address shows its positions, votes and loans", async ({ page }) => {
  await page.goto(`/address/${wallet}`)
  await expect(page.getByText("Loan health")).toBeVisible()
  await expect(
    page.getByRole("link", { name: "View lock" }).first(),
  ).toBeVisible()
  await expect(page.getByText("200.2%").first()).toBeVisible()
  // Balances from the document's tokens part, MUSD at an assumed $1.
  await expect(page.getByText("$1,250, $1 assumed")).toBeVisible()
  await expect(page.getByText("$3,386", { exact: true })).toBeVisible()
  await page.goto(`/address/${wallet}/votes`)
  await expect(
    page.getByRole("link", { name: "Epoch 47", exact: true }),
  ).toBeVisible()
  await expect(page.getByText("12,000 veMEZO")).toBeVisible()
  await page.goto(`/address/${wallet}/loans`)
  await expect(page.getByText("Borrowed, MUSD loan")).toBeVisible()
})

test("old ?tab= links move to the tab's path", async ({ baseURL }) => {
  const response = await fetch(`${baseURL}/address/${address}?tab=transfers`, {
    redirect: "manual",
  })
  expect(response.status).toBe(301)
  expect(response.headers.get("location")).toBe(`/address/${address}/transfers`)
})

test.describe("while the API's database is not bound (503)", () => {
  test.use({ extraHTTPHeaders: { "x-scan-fixture": "disabled" } })

  test("entity pages keep Blockscout's data, ours is not available yet", async ({
    page,
  }) => {
    const response = await page.goto(`/tx/${hash}`)
    expect(response?.status()).toBe(200)
    expect(response?.headers()["cache-control"]).toBe("no-store")
    await expect(
      page.getByRole("heading", { level: 1, name: "Transaction" }),
    ).toBeVisible()
    await expect(page.getByText("Not available yet").first()).toBeVisible()
    await page.goto(`/address/${address}`)
    await expect(page.getByText("Not available yet").first()).toBeVisible()
    await expect(page.getByText("Wallet", { exact: true })).toBeVisible()
  })
})

test("keys typed straight after Ctrl K reach the palette", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "keyboard shortcut")
  await page.goto("/gauges")
  // The shortcut listener attaches on hydration.
  await page.waitForLoadState("networkidle")
  await page.keyboard.press("Control+k")
  await page.keyboard.type("47")
  await expect(page.getByRole("combobox", { name: "Search" })).toHaveValue("47")
  await expect(page.getByRole("option")).toHaveCount(4)
})

test("entity URLs redirect to one canonical form", async ({ page }) => {
  const cases = [
    ["/block/0013078795", "/block/13078795"],
    ["/epochs/007", "/epochs/7"],
    [`/tx/${hash.toUpperCase().replace("0X", "0x")}`, `/tx/${hash}`],
    [`/tx/${hash.slice(2)}`, `/tx/${hash}`],
    [
      `/address/${address.toUpperCase().replace("0X", "0x")}`,
      `/address/${address}`,
    ],
    [
      "/address/0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
      "/address/0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed",
    ],
    ["/locks/veBTC/0604", "/locks/vebtc/604"],
  ] as const
  for (const [from, to] of cases) {
    const response = await page.request.get(from, { maxRedirects: 0 })
    expect(response.status(), from).toBe(301)
    expect(
      new URL(response.headers().location ?? "", "http://x").pathname,
      from,
    ).toBe(to)
  }
})

test("no request redirects off this site", async ({ baseURL }) => {
  // The router answers //evil.com// with 308 Location: http://evil.com/
  // on its own; the Worker's final-Location guard must turn that into /.
  for (const path of ["//evil.com//", "///evil.com//"]) {
    const response = await fetch(`${baseURL}${path}`, { redirect: "manual" })
    expect(response.status, path).toBeGreaterThanOrEqual(300)
    expect(response.status, path).toBeLessThan(400)
    expect(response.headers.get("location"), path).toBe("/")
  }
  // fetch keeps the doubled slashes; a browser or page.request would not.
  const paths = [
    "//evil.com",
    "//evil.com/x/",
    "///evil.com",
    "//evil.com/block/0001",
    "/%2F%2Fevil.com",
    "//block/0001",
    "/block//0001",
  ]
  for (const path of paths) {
    const response = await fetch(`${baseURL}${path}`, { redirect: "manual" })
    const location = response.headers.get("location")
    if (location === null) continue
    expect(location, path).toMatch(/^\/(?![/\\])/)
    expect(new URL(location, baseURL).origin, path).toBe(
      new URL(baseURL ?? "").origin,
    )
  }
})

test("pages run only nonced scripts, with a fresh nonce each time", async ({
  baseURL,
}) => {
  const nonceOf = (csp: string | null): string =>
    /'nonce-([^']+)'/.exec(csp ?? "")?.[1] ?? ""
  const first = await fetch(`${baseURL}/network/blocks?fresh=1`)
  const second = await fetch(`${baseURL}/network/blocks?fresh=1`)
  const nonce = nonceOf(first.headers.get("content-security-policy"))
  expect(nonce).not.toBe("")
  expect(nonceOf(second.headers.get("content-security-policy"))).not.toBe(nonce)
  const csp = first.headers.get("content-security-policy") ?? ""
  expect(csp).not.toContain("unsafe-eval")
  expect(csp).toContain(`script-src 'nonce-${nonce}' 'strict-dynamic'`)
  const html = await first.text()
  const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0])
  expect(scripts.length).toBeGreaterThan(0)
  for (const script of scripts) expect(script).toContain(`nonce="${nonce}"`)
  expect(html.match(/name="theme-color"/g)).toHaveLength(2)
  for (const name of [
    "x-content-type-options",
    "referrer-policy",
    "strict-transport-security",
    "permissions-policy",
  ]) {
    expect(first.headers.get(name), name).not.toBeNull()
  }
  // HEAD, a 404 and a redirect carry them too.
  for (const [path, method] of [
    ["/network/blocks", "HEAD"],
    ["/nope", "GET"],
    ["/block/0001", "GET"],
  ] as const) {
    const response = await fetch(`${baseURL}${path}`, {
      method,
      redirect: "manual",
    })
    expect(response.headers.get("x-content-type-options"), path).toBe("nosniff")
    expect(response.headers.get("content-security-policy"), path).toContain(
      "'strict-dynamic'",
    )
  }
})

// A part React suspends on mid-render streams in later and is swapped in
// by script, so the first paint misses it; every lazily loaded part
// renders on the server directly, even on a route's first request. One
// test per route: all 43 in one test, each a full server render, ran past
// the 30 s test timeout under a full parallel run.
for (const path of scanRoutes) {
  test(`pages arrive whole: no part streams in after the rest (${path})`, async ({
    request,
  }) => {
    const response = await request.get(path)
    expect(response.status(), path).toBeLessThan(400)
    const html = await response.text()
    expect(html.includes("<!--$?-->"), path).toBe(false)
  })
}
