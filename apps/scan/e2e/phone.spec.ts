import { expect, test } from "@playwright/test"

import {
  fixtureAddress as address,
  fixtureBlock,
  fixtureTx as hash,
  fixtureWallet as wallet,
} from "../scripts/routes.mjs"
import { fixtureOperator } from "../scripts/routes-validators.mjs"

/**
 * Phones and wallet browsers: the narrowest common phone (360 wide), the
 * WalletConnect screen under the CSP, and what touch can reach that a
 * title or a key cap used to hold.
 */

test.describe("at 360 wide", () => {
  test.skip(({ isMobile }) => !isMobile, "phone layout")
  test.use({ viewport: { width: 360, height: 780 } })

  test("no page scrolls sideways", async ({ page }) => {
    for (const path of [
      "/",
      "/network/transactions",
      "/network/blocks",
      "/gauges",
      "/validators",
      `/validators/${fixtureOperator}`,
      "/locks",
      "/epochs",
      "/tokens",
      "/borrow",
      `/tx/${hash}`,
      `/block/${fixtureBlock}`,
      `/address/${address}`,
      `/address/${wallet}`,
      `/address/${wallet}/votes`,
      "/epochs/47",
      "/locks/vebtc/604",
    ]) {
      await page.goto(path)
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      )
      expect(overflow, path).toBeLessThanOrEqual(0)
    }
  })

  test("Connect stays inside the screen", async ({ page }) => {
    await page.goto("/")
    const box = await page
      .getByRole("button", { name: /^Connect/ })
      .boundingBox()
    expect(box).not.toBeNull()
    if (box !== null) expect(box.x + box.width).toBeLessThanOrEqual(360)
  })
})

test("the CSP lets the WalletConnect screen load", async ({ page }) => {
  // On a phone with no wallet installed WalletConnect is the only way in.
  // Its screen calls api.web3modal.org and Reown, embeds the verify frame
  // and draws wallet icons from blob: URLs (the set Matchbox ID allows).
  const response = await page.goto("/")
  const csp = response?.headers()["content-security-policy"] ?? ""
  const directive = (name: string): string[] =>
    csp
      .split("; ")
      .find((part) => part.startsWith(`${name} `))
      ?.split(" ")
      .slice(1) ?? []
  expect(directive("connect-src")).toEqual(
    expect.arrayContaining([
      "https://*.walletconnect.org",
      "wss://relay.walletconnect.org",
      "https://*.web3modal.org",
      "https://*.reown.com",
      "wss://*.reown.com",
    ]),
  )
  expect(directive("connect-src")).not.toContain("wss:")
  expect(directive("frame-src")).toEqual(
    expect.arrayContaining([
      "https://verify.walletconnect.org",
      "https://secure.walletconnect.org",
    ]),
  )
  expect(directive("img-src")).toContain("blob:")
})

test("a tap shows a block's full time and hash", async ({ page, isMobile }) => {
  test.skip(!isMobile, "touch")
  await page.goto("/network/blocks")
  await page.waitForLoadState("networkidle")
  const age = page.locator("main time").first()
  await age.tap()
  await expect(page.getByRole("tooltip")).toContainText("UTC")
  const shortHash = page
    .locator("main span[tabindex='0']")
    .filter({ hasText: "…" })
    .first()
  await shortHash.tap()
  await expect(page.getByRole("tooltip").filter({ hasText: /^0x/ })).toHaveText(
    /^0x[0-9a-f]{64}$/,
  )
})

test("the search palette shows no key caps on touch", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "touch")
  await page.goto("/")
  await page.waitForLoadState("networkidle")
  await page.getByRole("button", { name: "Search", exact: true }).tap()
  const close = page.getByRole("button", { name: "Close search" })
  await expect(close).toBeVisible()
  await expect(close.locator("kbd").first()).toBeHidden()
  const box = await close.boundingBox()
  expect(box).not.toBeNull()
})
