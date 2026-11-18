import { expect, test } from "@playwright/test"

import { enclaveLoanTx, troveLoanTx } from "../scripts/routes-borrow.mjs"

/**
 * Home's Latest borrowing and loan transactions (`h3WlmUZS7N`): the title
 * in words, "What changed" and the position card, read through the
 * position's own routes. Against the fixtures.
 */

test("home lists every venue's latest borrowing", async ({ page }) => {
  await page.goto("/")
  await expect(
    page.getByRole("heading", { name: "Latest borrowing" }),
  ).toBeVisible()
  const rows = page.getByRole("list", { name: "Latest borrowing" })
  await expect(rows.getByRole("listitem")).toHaveCount(5)
  await expect(rows.getByText("MUSD trove").first()).toBeVisible()
})

test("a trove borrowing reads in words with what changed", async ({ page }) => {
  await page.goto(`/tx/${troveLoanTx}`)
  await expect(
    page.getByRole("heading", { level: 1, name: "Borrowed 4,000.00 MUSD" }),
  ).toBeVisible()
  const changed = page.getByRole("region", { name: "What changed" })
  await expect(changed.getByText("10,012.50 MUSD")).toBeVisible()
  await expect(changed.getByText("From 6,012.50 MUSD")).toBeVisible()
  const card = page.getByRole("region", { name: "MUSD loan" })
  await expect(card.getByText("This transaction")).toBeVisible()
  await expect(
    card.getByRole("link", { name: "Full position history" }),
  ).toHaveAttribute("href", /\/borrow\/troves\/0x/)
})

test("an Enclave opening says what is not available yet", async ({ page }) => {
  await page.goto(`/tx/${enclaveLoanTx}`)
  await expect(
    page.getByRole("heading", { level: 1, name: "Opened 25,000.00 MUSD" }),
  ).toBeVisible()
  await expect(page.getByText("against veBTC #604")).toBeVisible()
  const changed = page.getByRole("region", { name: "What changed" })
  await expect(changed.getByText("New position at 1.00% APR")).toBeVisible()
  await expect(changed.getByText("Not available yet")).toHaveCount(2)
})
