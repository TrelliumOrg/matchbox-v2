import { expect, test } from "@playwright/test"

// A transaction sent a moment ago (the fixtures' hashes on their way in,
// src/data/scan/fixtures/entities.ts): drawn from the chain at once, then
// upgraded in place to the indexed page, with no reload. Each test takes
// fresh hashes, since the fixtures move each one on from its first read.

const fresh = (prefix: string): string =>
  `${prefix}${Array.from({ length: 60 }, () =>
    Math.floor(Math.random() * 16).toString(16),
  ).join("")}`

test("a mined transaction the explorer lacks opens at once, then upgrades", async ({
  page,
}) => {
  const hash = fresh("0x11ce")
  const response = await page.goto(`/tx/${hash}`)
  expect(response?.status()).toBe(200)
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Voted /)
  const note = page
    .getByRole("status")
    .filter({ hasText: "Live from the chain" })
  await expect(note).toBeVisible()
  await expect(page.getByText("Success").first()).toBeVisible()
  // No reload: a marker set now survives the upgrade.
  await page.evaluate(() => {
    ;(window as unknown as { marker: number }).marker = 1
  })
  await expect(note).toBeHidden({ timeout: 25_000 })
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Voted /)
  expect(
    await page.evaluate(
      () => (window as unknown as { marker?: number }).marker,
    ),
  ).toBe(1)
})

test("a pending transaction waits for its block, then for the index", async ({
  page,
}) => {
  const hash = fresh("0x9e9d")
  await page.goto(`/tx/${hash}`)
  await expect(
    page.getByRole("status").filter({ hasText: "waiting for a block" }),
  ).toBeVisible()
  await expect(page.getByText("Pending").first()).toBeVisible()
  await expect(
    page.getByRole("status").filter({ hasText: "Live from the chain" }),
  ).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText("Success").first()).toBeVisible()
  await expect(page.getByText("Live from the chain")).toHaveCount(0, {
    timeout: 30_000,
  })
})

test("a hash nobody has seen waits for the network, then is not found", async ({
  page,
}) => {
  // The page waits a minute for the network, re-reading meanwhile.
  test.slow()
  const hash = fresh("0x5ee0")
  const response = await page.goto(`/tx/${hash}`)
  expect(response?.status()).toBe(404)
  await expect(
    page.getByRole("heading", { name: "Waiting for the network" }),
  ).toBeVisible()
  await expect(page.getByText("Not seen yet")).toBeVisible()
  await expect(page.getByRole("heading", { name: "Not found" })).toBeVisible({
    timeout: 80_000,
  })
  await expect(page.getByText("Not seen", { exact: true })).toBeVisible()
})
