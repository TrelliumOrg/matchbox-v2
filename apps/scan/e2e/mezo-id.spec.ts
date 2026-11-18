import { expect, type Page, test } from "@playwright/test"

import {
  fixtureAddress as address,
  fixtureWallet as wallet,
} from "../scripts/routes.mjs"

/**
 * Mezo IDs against the fixtures (src/data/scan/fixtures/mezo-ids.ts):
 * "alice.mezo" is the recorded wallet, "kiln.mezo" the recorded address
 * (so "kiln" is a label and an ID), "down.mezo" plays Mezo's API down.
 */

async function openPalette(page: Page, isMobile: boolean): Promise<void> {
  await page.goto("/network/blocks")
  await page.waitForLoadState("networkidle")
  if (isMobile) {
    await page.getByRole("button", { name: "Search", exact: true }).click()
  } else {
    await page.keyboard.press("Control+k")
  }
  await expect(page.getByRole("combobox", { name: "Search" })).toBeFocused()
}

test("a Mezo ID in search opens its wallet, which shows the ID", async ({
  page,
  isMobile,
}) => {
  await openPalette(page, isMobile)
  const input = page.getByRole("combobox", { name: "Search" })
  await input.fill("Alice.mezo")
  const row = page
    .getByRole("group", { name: "Addresses" })
    .getByRole("option", { name: /alice\.mezo/ })
  await expect(row).toBeVisible()
  await expect(row).toContainText(`${wallet.slice(0, 6)}…${wallet.slice(-4)}`)
  await expect(row.getByRole("img", { name: "Mezo ID" })).toBeVisible()
  await input.press("Enter")
  await expect(page).toHaveURL(`/address/${wallet}`)
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    wallet.slice(0, 12),
  )
  await expect(page.getByText("alice.mezo", { exact: true })).toBeVisible()
  await expect(page.getByRole("img", { name: "Mezo ID" })).toBeVisible()
})

test("a bare name offers the label and the Mezo ID", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "same palette; the desktop run covers it")
  await openPalette(page, isMobile)
  const input = page.getByRole("combobox", { name: "Search" })
  await input.fill("kiln")
  await expect(
    page
      .getByRole("group", { name: "Gauges" })
      .getByRole("option", { name: /Kiln Labs/ }),
  ).toBeVisible()
  const id = page
    .getByRole("group", { name: "Addresses" })
    .getByRole("option", { name: /kiln\.mezo/ })
  await expect(id).toBeVisible()
  await id.click()
  await expect(page).toHaveURL(`/address/${address}`)
})

test("Mezo's API down leaves search quiet", async ({ page, isMobile }) => {
  test.skip(isMobile, "same palette; the desktop run covers it")
  await openPalette(page, isMobile)
  const input = page.getByRole("combobox", { name: "Search" })
  await input.fill("down.mezo")
  // The other readings (here Blockscout's quick search) stay, and nothing
  // says the ID lookup failed.
  const addresses = page.getByRole("group", { name: "Addresses" })
  await expect(addresses.getByRole("option").first()).toBeVisible()
  await expect(page.getByRole("option", { name: /down\.mezo/ })).toHaveCount(0)
  await expect(page.getByRole("status")).toHaveText("")
})

test("/address/{Mezo ID} redirects to the wallet's address, keeping the tab", async ({
  baseURL,
}) => {
  const found = await fetch(`${baseURL}/address/Alice.mezo/votes`, {
    redirect: "manual",
  })
  expect(found.status).toBe(302)
  expect(found.headers.get("location")).toBe(`/address/${wallet}/votes`)
  const page = await fetch(`${baseURL}/address/alice.mezo`, {
    redirect: "manual",
  })
  expect(page.headers.get("location")).toBe(`/address/${wallet}`)
  for (const missing of ["nobody.mezo", "a_b.mezo", "down.mezo", "alice"]) {
    const response = await fetch(`${baseURL}/address/${missing}`, {
      redirect: "manual",
    })
    expect(response.status, missing).toBe(404)
  }
})

test("lists name a wallet by its cached Mezo ID, and leave others bare", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "phones hide the transfers' To column")
  // MUSD's recorded transfers went to the recorded wallet (alice.mezo,
  // which the fixtures' cache knows). Hard-loaded: the server names it.
  const response = await page.goto("/tokens/musd?tab=transfers")
  expect(response?.status()).toBe(200)
  const named = page.getByRole("link", { name: "alice.mezo" }).first()
  await expect(named).toBeVisible()
  await expect(named).toHaveAttribute("href", `/address/${wallet}`)
  await expect(named).toHaveAttribute("title", wallet)
  // A sender with no cached ID shows its short address, as before.
  await page.goto("/network/transactions")
  await expect(page.getByText("0xf35c…1c8a").first()).toBeVisible()
  await expect(page.getByText("alice.mezo")).toHaveCount(0)
})

/**
 * Bitcoin addresses (src/data/scan/fixtures/mezo-ids.ts, fixtureBtc):
 * documentation vectors, no one's real address.
 */
const btc = {
  alice: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
  kiln: "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2",
  none: "bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3",
  down: "bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0",
}

test("a Bitcoin address in search opens its EVM account, which shows all three", async ({
  page,
  isMobile,
}) => {
  await openPalette(page, isMobile)
  const input = page.getByRole("combobox", { name: "Search" })
  await input.fill(btc.alice.toUpperCase())
  const row = page
    .getByRole("group", { name: "Addresses" })
    .getByRole("option", { name: /alice\.mezo/ })
  await expect(row).toBeVisible()
  await expect(row).toContainText(`${wallet.slice(0, 6)}…${wallet.slice(-4)}`)
  await input.press("Enter")
  await expect(page).toHaveURL(`/address/${wallet}`)
  await expect(page.getByText("alice.mezo", { exact: true })).toBeVisible()
  const linked = page.getByRole("group", { name: "Bitcoin address" })
  await expect(linked).toBeVisible()
  await expect(linked).toContainText(
    `${btc.alice.slice(0, 8)}…${btc.alice.slice(-6)}`,
  )
  await expect(linked.getByTitle(btc.alice)).toBeVisible()
})

test("a Bitcoin address with no Mezo account says so", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "same palette; the desktop run covers it")
  await openPalette(page, isMobile)
  const input = page.getByRole("combobox", { name: "Search" })
  await input.fill(btc.none)
  await expect(page.getByRole("status")).toHaveText(
    "No Mezo account for this Bitcoin address",
  )
  await expect(
    page.getByRole("group", { name: "Addresses" }).getByRole("option"),
  ).toHaveCount(0)
  // Mezo's API down stays quiet, as for an ID.
  await input.fill(btc.down)
  await expect(page.getByText("No match")).toBeVisible()
  await expect(page.getByRole("status")).toHaveText("")
})

test("/address/{Bitcoin address} redirects to its EVM account, keeping the tab", async ({
  baseURL,
}) => {
  for (const [path, location] of [
    [`/address/${btc.alice}`, `/address/${wallet}`],
    [`/address/${btc.alice.toUpperCase()}/votes`, `/address/${wallet}/votes`],
    [`/address/${btc.kiln}`, `/address/${address}`],
  ]) {
    const response = await fetch(`${baseURL}${path}`, { redirect: "manual" })
    expect(response.status, path).toBe(302)
    expect(response.headers.get("location"), path).toBe(location)
  }
  for (const missing of [
    btc.none,
    btc.down,
    "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx",
    btc.kiln.toLowerCase(),
  ]) {
    const response = await fetch(`${baseURL}/address/${missing}`, {
      redirect: "manual",
    })
    expect(response.status, missing).toBe(404)
  }
})

test("/address/{Bitcoin address} with no Mezo account says so", async ({
  page,
}) => {
  const response = await page.goto(`/address/${btc.none}`)
  expect(response?.status()).toBe(404)
  // Hydrated: the loader's reason survives into the browser.
  await page.waitForLoadState("networkidle")
  await expect(
    page.getByRole("heading", { name: "No Mezo account" }),
  ).toBeVisible()
  await expect(page.getByText("None", { exact: true })).toBeVisible()
  await page.goto(`/address/${btc.down}`)
  await expect(
    page.getByRole("heading", { name: "Mezo unavailable" }),
  ).toBeVisible()
})
